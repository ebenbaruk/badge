/**
 * Plumbing of the live demo (scripts/demo.ts): the dstack simulator, the enclave child process, the five Speculos
 * Ledgers driven automatically, and the narration. Nothing here knows the scenario.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createDstackClient } from "@badge/attest/server";
import type { BadgeMessageKind, BadgeMessages } from "@badge/consent";
import { autoRespond, LedgerSigner, SpeculosDevice, UserRejectedError } from "@badge/ledger";
import { isAddressEqual, type Address, type Hex } from "viem";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DSTACK_SIMULATOR_ENDPOINT = process.env["DSTACK_SIMULATOR_ENDPOINT"] ?? "http://127.0.0.1:8090";
const DEMO_ENCLAVE_PORT = Number(process.env["BADGE_DEMO_ENCLAVE_PORT"] ?? "8787");
const ENCLAVE_BOOT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
/** The "rejected" status screen dismisses itself after a few seconds; wait for home before the next review. */
const HOME_SCREEN = /this app enables signing/i;
const HOME_SCREEN_TIMEOUT_MS = 20_000;
const LOG_TAIL_LINES = 30;

/** Speculos Flex of each demo employee (infra/speculos.sh). */
export const DEVICE_URLS = {
  alice: process.env["BADGE_SPECULOS_ALICE"] ?? "http://localhost:5001",
  bob: process.env["BADGE_SPECULOS_BOB"] ?? "http://localhost:5002",
  chloe: process.env["BADGE_SPECULOS_CHLOE"] ?? "http://localhost:5003",
  david: process.env["BADGE_SPECULOS_DAVID"] ?? "http://localhost:5004",
  emma: process.env["BADGE_SPECULOS_EMMA"] ?? "http://localhost:5005",
} as const;
export type DemoEmployee = keyof typeof DEVICE_URLS;

// ---- Narration ----

const ANSI = { bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", reset: "\x1b[0m" };
const useColor = process.stdout.isTTY;
const paint = (style: keyof typeof ANSI, text: string) =>
  useColor ? `${ANSI[style]}${text}${ANSI.reset}` : text;

/** A failed expectation of the scenario: the demo stops and exits non-zero. */
export class DemoAssertionError extends Error {
  override readonly name = "DemoAssertionError";
}

/** Fails the demo with `message` unless `condition` holds. */
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DemoAssertionError(message);
}

export interface StepResult {
  readonly title: string;
  readonly ms: number;
}

/** Prints the scenario as numbered steps with their outcome, and keeps a summary. */
export class Narrator {
  readonly steps: StepResult[] = [];

  async step<T>(title: string, run: () => Promise<T>): Promise<T> {
    const index = this.steps.length + 1;
    console.log(`\n${paint("bold", `${String(index).padStart(2, " ")}. ${title}`)}`);
    const started = Date.now();
    const result = await run();
    const ms = Date.now() - started;
    this.steps.push({ title, ms });
    console.log(paint("green", `    [OK] ${(ms / 1000).toFixed(1)} s`));
    return result;
  }

  /** One line of narration inside a step. */
  say(text: string): void {
    console.log(`    ${text}`);
  }

  /** A secondary detail (ids, sizes). */
  detail(text: string): void {
    console.log(paint("dim", `      ${text}`));
  }

  fail(error: unknown): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(paint("red", `\n[FAILED] ${message}`));
  }

  summary(): void {
    const total = this.steps.reduce((sum, step) => sum + step.ms, 0);
    console.log(`\n${paint("bold", "Summary")}`);
    for (const [index, step] of this.steps.entries()) {
      console.log(
        `  [OK] ${String(index + 1).padStart(2, " ")}. ${step.title} (${(step.ms / 1000).toFixed(1)} s)`,
      );
    }
    console.log(paint("bold", `\n${this.steps.length} steps passed in ${(total / 1000).toFixed(0)} s.`));
  }
}

// ---- dstack simulator ----

/** Makes sure the local dstack simulator answers, starting it with infra/dstack-sim.sh when needed. */
export async function ensureDstackSimulator(): Promise<"running" | "started"> {
  const dstack = createDstackClient(DSTACK_SIMULATOR_ENDPOINT);
  if (await dstack.isReachable()) return "running";
  execFileSync(join(REPO_ROOT, "infra/dstack-sim.sh"), ["start"], { stdio: "ignore" });
  if (!(await dstack.isReachable())) {
    throw new Error(
      `dstack simulator still unreachable at ${DSTACK_SIMULATOR_ENDPOINT} after infra/dstack-sim.sh start`,
    );
  }
  return "started";
}

// ---- Enclave ----

export interface EnclaveHandle {
  readonly url: string;
  /** null when the demo uses an enclave it did not start (BADGE_ENCLAVE_URL). */
  readonly logFile: string | null;
  stop(): Promise<void>;
  /** Last lines of the enclave log (secrets never reach it), for failure reports. */
  logTail(): string;
}

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + ENCLAVE_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the enclave exited during boot (code ${child.exitCode})`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet: keep polling until the deadline.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`the enclave did not answer ${url}/health within ${ENCLAVE_BOOT_TIMEOUT_MS / 1000} s`);
}

/**
 * The enclave under demo: BADGE_ENCLAVE_URL when given, else a child process on a fresh data directory (a demo run
 * never depends on, nor pollutes, the state of a previous one).
 */
export async function startEnclave(): Promise<EnclaveHandle> {
  const external = process.env["BADGE_ENCLAVE_URL"];
  if (external) {
    return {
      url: external.replace(/\/+$/, ""),
      logFile: null,
      stop: async () => undefined,
      logTail: () => "",
    };
  }
  const url = `http://127.0.0.1:${DEMO_ENCLAVE_PORT}`;
  const busy = await fetch(`${url}/health`).then(
    () => true,
    () => false,
  );
  if (busy) {
    throw new Error(`${url} is already in use: stop that enclave or set BADGE_ENCLAVE_URL=${url}`);
  }
  const dataDir = mkdtempSync(join(tmpdir(), "badge-demo-"));
  const logFile = join(dataDir, "enclave.log");
  const log = createWriteStream(logFile);
  const child = spawn("pnpm", ["--silent", "--filter", "@badge/enclave", "start"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BADGE_DATA_DIR: dataDir,
      BADGE_ENCLAVE_PORT: String(DEMO_ENCLAVE_PORT),
      BADGE_ENCLAVE_HOST: "127.0.0.1",
      BADGE_REQUIRE_CHANNEL: "true",
      DSTACK_SIMULATOR_ENDPOINT,
    },
    // Own process group: stopping the demo stops pnpm, tsx and node together.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const stop = async () => {
    if (child.exitCode === null && child.pid !== undefined) {
      process.kill(-child.pid, "SIGTERM");
      await new Promise((done) => child.once("exit", done));
    }
    log.end();
    rmSync(dataDir, { recursive: true, force: true });
  };
  const logTail = () => {
    try {
      return readFileSync(logFile, "utf8").trim().split("\n").slice(-LOG_TAIL_LINES).join("\n");
    } catch {
      return "(no enclave log)";
    }
  };
  try {
    await waitForHealth(url, child);
  } catch (error) {
    const tail = logTail();
    await stop();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${tail}`, { cause: error });
  }
  return { url, logFile, stop, logTail };
}

// ---- Ledgers ----

/** One employee's Speculos Ledger, with every review answered automatically (approve, or reject when asked). */
export class DemoLedger {
  private constructor(
    readonly who: DemoEmployee,
    readonly address: Address,
    private readonly signer: LedgerSigner,
    private readonly device: SpeculosDevice,
  ) {}

  /** Connects and checks the device holds the Ledger address the directory expects for `who`. */
  static async connect(who: DemoEmployee, expected: Address): Promise<DemoLedger> {
    const url = DEVICE_URLS[who];
    const signer = await LedgerSigner.connect(url);
    const address = await signer.getAddress();
    if (!isAddressEqual(address, expected)) {
      await signer.close();
      throw new Error(`the Ledger at ${url} is ${address}, the directory expects ${expected} for ${who}`);
    }
    return new DemoLedger(who, address, signer, new SpeculosDevice(url));
  }

  /** Clear-signs a Badge EIP-712 message; the holder approves on the device. Returns the pages shown. */
  async sign<K extends BadgeMessageKind>(
    kind: K,
    message: BadgeMessages[K],
  ): Promise<{ signature: Hex; screens: string[] }> {
    const responder = autoRespond(this.device);
    const signature = await this.signer.signBadgeMessage(kind, message, { onProgress: responder.onProgress });
    const pages = await responder.done();
    return { signature, screens: pages.flatMap((page) => page.texts) };
  }

  /** Signs an EIP-191 personal message shown verbatim on the device. */
  async signPersonal(text: string): Promise<Hex> {
    const responder = autoRespond(this.device);
    const signature = await this.signer.signPersonalMessage(text, { onProgress: responder.onProgress });
    await responder.done();
    return signature;
  }

  /** Shows the message on the device and refuses it there. Resolves once the device is back home. */
  async refuse<K extends BadgeMessageKind>(kind: K, message: BadgeMessages[K]): Promise<void> {
    const responder = autoRespond(this.device, { decision: "reject" });
    const outcome = await this.signer
      .signBadgeMessage(kind, message, { onProgress: responder.onProgress })
      .then(
        () => "signed" as const,
        (error: unknown) =>
          error instanceof UserRejectedError ? ("rejected" as const) : Promise.reject(error),
      );
    await responder.done();
    check(outcome === "rejected", `the ${kind} was signed although the holder refused it`);
    await this.device.waitForText(HOME_SCREEN, HOME_SCREEN_TIMEOUT_MS);
  }

  close(): Promise<void> {
    return this.signer.close();
  }
}
