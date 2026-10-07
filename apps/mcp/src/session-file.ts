/**
 * The agent's session file: the software session key and the `AgentSession` message that delegates to it, plus the
 * owner's Ledger signature once the session has been opened. It holds a private key, so it is created owner-only
 * (0600) and refused when anyone else can read it.
 */
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import {
  decodeBadgeMessage,
  encodeBadgeMessage,
  signatureSchema,
  toUnixSeconds,
  type AgentSession,
} from "@badge/consent";
import { isAddressEqual, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { McpSetupError } from "./errors";

export const SESSION_FILE_VERSION = 1;
/** Owner read/write only. */
export const SESSION_FILE_MODE = 0o600;
/** Any group or other permission bit. */
const GROUP_OTHER_BITS = 0o077;
const PERMISSION_BITS = 0o777;
const OCTAL = 8;
const PRIVATE_KEY_HEX = /^0x[0-9a-fA-F]{64}$/;

const sessionFileSchema = z.strictObject({
  version: z.literal(SESSION_FILE_VERSION),
  privateKey: z.string().regex(PRIVATE_KEY_HEX, { error: "privateKey must be 0x + 32 bytes of hex" }),
  /** AgentSession in the @badge/consent wire format (decoded strictly on load). */
  session: z.unknown(),
  /** Owner's Ledger EIP-712 signature of `session`; null until the session is opened. */
  signature: signatureSchema.nullable(),
});

/** Decoded content of a session file. */
export interface StoredSession {
  readonly privateKey: Hex;
  readonly message: AgentSession;
  readonly signature: Hex | null;
}

/** A session that was opened on the enclave and has not expired: what the MCP server needs to act. */
export interface UsableSession {
  readonly account: LocalAccount;
  readonly message: AgentSession;
  readonly signature: Hex;
}

/**
 * Reads and validates a session file. The key must match `message.sessionKey`, so a file edited by hand cannot
 * pair one employee's delegation with another key.
 * @throws McpSetupError (`session_file_insecure`, `session_file_invalid`).
 */
export async function readSessionFile(path: string): Promise<StoredSession> {
  await assertOwnerOnly(path);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new McpSetupError("session_file_invalid", `cannot read the session file ${path}`, { cause: error });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new McpSetupError("session_file_invalid", `${path} is not JSON`, { cause: error });
  }
  const parsed = sessionFileSchema.safeParse(json);
  if (!parsed.success) {
    // Only the issue paths and messages: never echo the values (one of them is the private key).
    throw new McpSetupError("session_file_invalid", `${path}: ${z.prettifyError(parsed.error)}`);
  }
  let message: AgentSession;
  try {
    message = decodeBadgeMessage("AgentSession", parsed.data.session);
  } catch (error) {
    throw new McpSetupError("session_file_invalid", `${path}: invalid AgentSession`, { cause: error });
  }
  const privateKey = parsed.data.privateKey as Hex;
  if (!isAddressEqual(privateKeyToAccount(privateKey).address, message.sessionKey)) {
    throw new McpSetupError("session_file_invalid", `${path}: the key does not match session.sessionKey`);
  }
  return { privateKey, message, signature: parsed.data.signature };
}

/**
 * Writes a session file owner-only. Refuses to replace an existing file unless `overwrite` (a lost key cannot be
 * recovered, and an opened session would silently be orphaned).
 * @throws McpSetupError (`session_file_exists`).
 */
export async function writeSessionFile(
  path: string,
  session: StoredSession,
  options: { overwrite: boolean },
): Promise<void> {
  const content = {
    version: SESSION_FILE_VERSION,
    privateKey: session.privateKey,
    session: encodeBadgeMessage("AgentSession", session.message),
    signature: session.signature,
  };
  try {
    await writeFile(path, `${JSON.stringify(content, null, 2)}\n`, {
      mode: SESSION_FILE_MODE,
      flag: options.overwrite ? "w" : "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new McpSetupError("session_file_exists", `${path} already exists (use --force to replace it)`);
    }
    throw error;
  }
  // `mode` only applies when the file is created: tighten an overwritten file too.
  await chmod(path, SESSION_FILE_MODE);
}

/**
 * Checks that the stored session can be used now: opened (signed) and not expired.
 * @throws McpSetupError (`session_not_opened`, `session_expired`).
 */
export function requireUsableSession(stored: StoredSession, now: Date): UsableSession {
  if (stored.signature === null) {
    throw new McpSetupError(
      "session_not_opened",
      "the session is not opened yet: sign it on the Ledger, then run `pnpm --filter @badge/mcp session open`",
    );
  }
  if (stored.message.expiresAt <= toUnixSeconds(now)) {
    throw new McpSetupError(
      "session_expired",
      `the agent session expired at ${new Date(Number(stored.message.expiresAt) * 1000).toISOString()}: create a new one`,
    );
  }
  return {
    account: privateKeyToAccount(stored.privateKey),
    message: stored.message,
    signature: stored.signature,
  };
}

async function assertOwnerOnly(path: string): Promise<void> {
  // POSIX permission bits do not describe Windows ACLs.
  if (process.platform === "win32") return;
  let mode: number;
  try {
    mode = (await stat(path)).mode;
  } catch (error) {
    throw new McpSetupError("session_file_invalid", `cannot read the session file ${path}`, { cause: error });
  }
  if ((mode & GROUP_OTHER_BITS) !== 0) {
    throw new McpSetupError(
      "session_file_insecure",
      `${path} is readable by other users (mode ${(mode & PERMISSION_BITS).toString(OCTAL)}): run chmod 600 on it`,
    );
  }
}
