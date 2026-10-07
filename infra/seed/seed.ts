/**
 * Seeds Honcho with the demo dataset, waits for the deriver and verifies the memory is usable.
 * Run through `infra/stack.sh seed` (or `pnpm exec tsx infra/seed/seed.ts` with the BADGE_* variables set).
 *
 * Idempotent: notes already stored are skipped, so it can be rerun at will. After switching LLM profile, run
 * `infra/stack.sh reset` first: embeddings from two profiles are not comparable even at the same size.
 *
 * Fails (exit 1) when:
 *  - the deriver logged a WARNING or ERROR since the seed started (Honcho reports a rejected json_schema, a
 *    runaway generation or zero observations only there, while the API keeps answering 200 with empty memory);
 *  - an owner ends up with an empty representation;
 *  - a recall check does not find an expected note, or finds a forbidden one.
 * Output lists note ids and scores only, never note contents.
 */
import { spawnSync } from "node:child_process";
import {
  createLlmClient,
  describeLlmProfile,
  HonchoBackend,
  HonchoMemory,
  loadHonchoConfig,
  loadLlmProfile,
  loadSeedDataset,
  type SeedDataset,
} from "../../apps/enclave/src";

const QUEUE_POLL_MS = 3_000;
const QUEUE_TIMEOUT_MS = 15 * 60_000;
/** The queue must read idle this many times in a row: work units are enqueued shortly after ingestion. */
const IDLE_POLLS_REQUIRED = 3;
const DERIVER_CONTAINER = process.env["BADGE_DERIVER_CONTAINER"] || "badge-deriver-1";
const DERIVER_ALERT = /\b(WARNING|ERROR|CRITICAL)\b|Traceback/;
const SCORE_DECIMALS = 3;
const LOG_BUFFER_BYTES = 16 * 1024 * 1024;

class SeedCheckError extends Error {
  override readonly name = "SeedCheckError";
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const dataset = loadSeedDataset(process.env["BADGE_SEED_FILE"] || undefined);
  const profile = loadLlmProfile();
  const backend = new HonchoBackend(loadHonchoConfig());
  const memory = new HonchoMemory(backend, createLlmClient(profile));
  console.log(`profile: ${describeLlmProfile(profile)}`);

  await backend.configureWorkspace();
  let created = 0;
  for (const note of dataset.notes) {
    const result = await memory.ingest(note);
    if (result.created) created++;
  }
  console.log(`notes: ${created} ingested, ${dataset.notes.length - created} already present`);

  await waitForDeriver(backend);
  checkDeriverLogs(startedAt);
  await checkRepresentations(backend, dataset);
  await checkRecall(memory, dataset);
  console.log("seed OK");
}

async function waitForDeriver(backend: HonchoBackend): Promise<void> {
  const deadline = Date.now() + QUEUE_TIMEOUT_MS;
  let idlePolls = 0;
  while (idlePolls < IDLE_POLLS_REQUIRED) {
    if (Date.now() > deadline) throw new SeedCheckError("deriver queue did not drain in time");
    const queue = await backend.deriverQueue();
    idlePolls = queue.pending === 0 && queue.inProgress === 0 ? idlePolls + 1 : 0;
    process.stdout.write(
      `\rderiver: ${queue.completed}/${queue.total} done, ${queue.pending} pending, ${queue.inProgress} running   `,
    );
    await new Promise((resolve) => setTimeout(resolve, QUEUE_POLL_MS));
  }
  process.stdout.write("\n");
}

function checkDeriverLogs(since: Date): void {
  const result = spawnSync("docker", ["logs", "--since", since.toISOString(), DERIVER_CONTAINER], {
    encoding: "utf8",
    maxBuffer: LOG_BUFFER_BYTES,
  });
  if (result.error || result.status !== 0) {
    throw new SeedCheckError(
      `cannot read the deriver logs (container ${DERIVER_CONTAINER}): ${result.stderr}`,
      {
        cause: result.error,
      },
    );
  }
  // docker logs replays the container's stderr on its own stderr: Python logging goes there.
  const lines = `${result.stdout}\n${result.stderr}`.split("\n");
  const alerts = lines.filter((line) => DERIVER_ALERT.test(line));
  if (alerts.length > 0) {
    throw new SeedCheckError(
      `deriver reported ${alerts.length} problem(s):\n${alerts.slice(0, 20).join("\n")}`,
    );
  }
  console.log("deriver logs: no warning");
}

async function checkRepresentations(backend: HonchoBackend, dataset: SeedDataset): Promise<void> {
  const owners = [...new Set(dataset.notes.map((note) => note.ownerId))];
  const empty: string[] = [];
  for (const owner of owners) {
    const count = await backend.conclusionCount(owner);
    console.log(`representation ${owner}: ${count} conclusions`);
    if (count === 0) empty.push(owner);
  }
  if (empty.length > 0) throw new SeedCheckError(`empty representation for: ${empty.join(", ")}`);
}

async function checkRecall(memory: HonchoMemory, dataset: SeedDataset): Promise<void> {
  const failures: string[] = [];
  for (const check of dataset.recallChecks) {
    const candidates = await memory.findCandidates(check.task, { requesterId: check.requesterId });
    console.log(`\nrecall "${check.task}" (for ${check.requesterId}):`);
    for (const c of candidates) {
      console.log(
        `  ${c.score.toFixed(SCORE_DECIMALS)}  ${c.scope.padEnd(8)}  ${c.ownerId.padEnd(8)}  ${c.source.id}`,
      );
    }
    const found = new Set(candidates.map((c) => c.source.id));
    for (const id of check.mustInclude) if (!found.has(id)) failures.push(`"${check.task}": missing ${id}`);
    for (const id of check.mustExclude)
      if (found.has(id)) failures.push(`"${check.task}": must not return ${id}`);
  }
  if (failures.length > 0) throw new SeedCheckError(`recall check failed:\n${failures.join("\n")}`);
}

main().catch((error: unknown) => {
  console.error(`\nseed FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
