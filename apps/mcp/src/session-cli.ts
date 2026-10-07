/**
 * Session CLI for the MCP server (`pnpm --filter @badge/mcp session <command>`):
 *
 *   create --employee <0x...> --out <file> [--agent <name>] [--ttl-hours <h>] [--force]
 *     Generates the agent's session key, writes it owner-only to <file> and prints the AgentSession to sign.
 *   open --file <file> (--signature <0x...> | --ledger <speculos url>)
 *     Checks the owner's Ledger signature (given, or requested now on a Speculos device), opens the session on
 *     the enclave and records the signature in the file.
 *
 * The enclave is configured with the same variables as the server (BADGE_ENCLAVE_URL, BADGE_ATTESTATION_MODE...).
 * The private key is never printed.
 */
import { parseArgs } from "node:util";
import { createAgentSession, ENCLAVE_MAX_SESSION_TTL_SECONDS } from "@badge/client";
import {
  encodeBadgeMessage,
  hashBadgeMessage,
  signatureSchema,
  verifyBadgeSignature,
  type AgentSession,
} from "@badge/consent";
import { isAddress, type Address, type Hex } from "viem";
import { loadEnclaveConfig, type EnclaveConfig } from "./config";
import { createEnclaveClient } from "./enclave";
import { McpSetupError } from "./errors";
import { readSessionFile, writeSessionFile } from "./session-file";

const DEFAULT_AGENT_NAME = "Claude Code";
const DEFAULT_TTL_HOURS = 8;
const SECONDS_PER_HOUR = 3600;
const MILLIS_PER_SECOND = 1000;
const MAX_TTL_HOURS = Number(ENCLAVE_MAX_SESSION_TTL_SECONDS) / SECONDS_PER_HOUR;

const USAGE = `Usage :
  session create --employee <adresse Ledger> --out <fichier> [--agent <nom>] [--ttl-hours <h>] [--force]
  session open --file <fichier> (--signature <0x...> | --ledger <url Speculos>)`;

class UsageError extends Error {
  override readonly name = "UsageError";
}

/** Measurement the session will be pinned to: attested in channel mode, announced (dev only) in plain mode. */
async function enclaveMeasurement(config: EnclaveConfig): Promise<Hex> {
  const client = createEnclaveClient(config);
  if (config.enclaveTransport === "plain") return (await client.measurement()).measurement;
  return (await client.connect()).enclaveMeasurement;
}

async function create(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      employee: { type: "string" },
      out: { type: "string" },
      agent: { type: "string", default: DEFAULT_AGENT_NAME },
      "ttl-hours": { type: "string", default: String(DEFAULT_TTL_HOURS) },
      force: { type: "boolean", default: false },
    },
    strict: true,
  });
  const employee = values.employee;
  if (employee === undefined || !isAddress(employee))
    throw new UsageError("--employee <adresse Ledger> requis");
  if (values.out === undefined) throw new UsageError("--out <fichier> requis");
  const ttlHours = Number(values["ttl-hours"]);
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > MAX_TTL_HOURS) {
    throw new UsageError(`--ttl-hours doit être un entier entre 1 et ${MAX_TTL_HOURS}`);
  }

  const config = loadEnclaveConfig();
  const created = createAgentSession(employee as Address, {
    agentName: values.agent,
    enclaveMeasurement: await enclaveMeasurement(config),
    ttlSeconds: BigInt(ttlHours * SECONDS_PER_HOUR),
  });
  await writeSessionFile(
    values.out,
    { privateKey: created.privateKey, message: created.message, signature: null },
    { overwrite: values.force },
  );
  printToSign(values.out, created.message);
}

function printToSign(file: string, message: AgentSession): void {
  console.log(`Fichier de session créé (droits 600) : ${file}`);
  console.log("\nMessage AgentSession à signer sur le Ledger de l'employé (EIP-712, clear signing) :");
  console.log(JSON.stringify(encodeBadgeMessage("AgentSession", message), null, 2));
  console.log(`\nEmpreinte EIP-712 : ${hashBadgeMessage("AgentSession", message)}`);
  console.log("\nPuis ouvrez la session avec la signature obtenue (application web ou @badge/ledger) :");
  console.log(`  pnpm --filter @badge/mcp session open --file ${file} --signature 0x...`);
  console.log("ou signez directement sur un Speculos :");
  console.log(`  pnpm --filter @badge/mcp session open --file ${file} --ledger http://localhost:5001`);
}

/** Asks the device to sign. Loaded on demand: the MCP server itself never needs the Ledger stack. */
async function signOnLedger(speculosUrl: string, message: AgentSession): Promise<Hex> {
  const { LedgerSigner } = await import("@badge/ledger");
  const signer = await LedgerSigner.connect(speculosUrl);
  try {
    console.log("Validez la session sur l'appareil...");
    return await signer.signBadgeMessage("AgentSession", message);
  } finally {
    await signer.close();
  }
}

async function open(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { file: { type: "string" }, signature: { type: "string" }, ledger: { type: "string" } },
    strict: true,
  });
  if (values.file === undefined) throw new UsageError("--file <fichier> requis");
  if ((values.signature === undefined) === (values.ledger === undefined)) {
    throw new UsageError("donnez soit --signature, soit --ledger");
  }
  const stored = await readSessionFile(values.file);
  const { message } = stored;
  let signature: Hex;
  if (values.signature !== undefined) {
    const parsed = signatureSchema.safeParse(values.signature);
    if (!parsed.success)
      throw new UsageError("--signature doit être une signature hexadécimale de 65 octets");
    signature = parsed.data;
  } else {
    signature = await signOnLedger(values.ledger as string, message);
  }
  // Checked here first: a signature by another Ledger would otherwise only show up as an opaque enclave refusal.
  await verifyBadgeSignature("AgentSession", message, signature, message.employee);

  const session = await createEnclaveClient(loadEnclaveConfig()).openSession({
    kind: "AgentSession",
    message,
    signature,
  });
  await writeSessionFile(values.file, { ...stored, signature }, { overwrite: true });
  const expires = new Date(session.expiresAt * MILLIS_PER_SECOND).toISOString();
  console.log(`Session ouverte pour ${session.employeeId} (« ${session.agentName} ») jusqu'au ${expires}.`);
  console.log(`Le serveur MCP peut démarrer avec BADGE_SESSION_KEY_FILE=${values.file}`);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "create") return create(rest);
  if (command === "open") return open(rest);
  throw new UsageError(command === undefined ? "commande manquante" : `commande inconnue : ${command}`);
}

main(process.argv.slice(2)).then(
  // The Device Management Kit keeps transport timers alive after its session is closed (`--ledger`): exit
  // explicitly once the command is done rather than hang.
  () => process.exit(0),
  (error: unknown) => {
    // node:util parseArgs reports unknown or malformed flags with ERR_PARSE_ARGS_* codes.
    const parseArgsError = String((error as { code?: unknown }).code ?? "").startsWith("ERR_PARSE_ARGS");
    if (error instanceof UsageError || parseArgsError)
      console.error(`${(error as Error).message}\n\n${USAGE}`);
    else if (error instanceof McpSetupError) console.error(`${error.code}: ${error.message}`);
    else console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    process.exit(1);
  },
);
