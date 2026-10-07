import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BadgeApiError, createAgentSession } from "@badge/client";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMcpConfig } from "../src/config";
import { verifyEnclave } from "../src/enclave";
import type { McpSetupError } from "../src/errors";
import {
  readSessionFile,
  requireUsableSession,
  writeSessionFile,
  type StoredSession,
} from "../src/session-file";
import { ALICE, MEASUREMENT, verifiedAttestation } from "./fixtures";

const NOW = new Date("2026-10-07T12:00:00Z");
const SIGNATURE = `0x${"12".repeat(65)}` as const;
const COMPOSE_HASH = "ab".repeat(32);
const OWNER_ONLY = 0o600;
const WORLD_READABLE = 0o644;

function newSession(): StoredSession {
  const created = createAgentSession(ALICE, {
    agentName: "Claude Code",
    enclaveMeasurement: MEASUREMENT,
    now: NOW,
  });
  return { privateKey: created.privateKey, message: created.message, signature: null };
}

async function expectSetupError(promise: Promise<unknown>, code: McpSetupError["code"]): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "McpSetupError", code });
}

describe("session file", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "badge-mcp-"));
    file = join(dir, "session.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips owner-only and never stores anything but the key, the session and the signature", async () => {
    const session = newSession();
    await writeSessionFile(file, session, { overwrite: false });

    expect((await stat(file)).mode & 0o777).toBe(OWNER_ONLY);
    expect(Object.keys(JSON.parse(await readFile(file, "utf8")))).toEqual([
      "version",
      "privateKey",
      "session",
      "signature",
    ]);
    expect(await readSessionFile(file)).toEqual(session);
  });

  it("does not replace an existing file unless asked", async () => {
    await writeSessionFile(file, newSession(), { overwrite: false });
    await expectSetupError(writeSessionFile(file, newSession(), { overwrite: false }), "SESSION_FILE_EXISTS");
    await chmod(file, WORLD_READABLE);
    await writeSessionFile(file, newSession(), { overwrite: true });
    expect((await stat(file)).mode & 0o777).toBe(OWNER_ONLY);
  });

  it("refuses a file other users can read", async () => {
    await writeSessionFile(file, newSession(), { overwrite: false });
    await chmod(file, WORLD_READABLE);
    await expectSetupError(readSessionFile(file), "SESSION_FILE_INSECURE");
  });

  it("refuses a key that does not match the delegated session key", async () => {
    await writeSessionFile(file, { ...newSession(), privateKey: generatePrivateKey() }, { overwrite: false });
    await expectSetupError(readSessionFile(file), "SESSION_FILE_INVALID");
  });

  it("refuses malformed content without echoing it", async () => {
    await writeFile(
      file,
      JSON.stringify({ version: 1, privateKey: "0xsecret", session: {}, signature: null }),
      {
        mode: OWNER_ONLY,
      },
    );
    const error = await readSessionFile(file).catch((e: unknown) => e as Error);
    expect(error).toMatchObject({ code: "SESSION_FILE_INVALID" });
    expect((error as Error).message).not.toContain("0xsecret");
  });

  it("requires an opened, unexpired session", () => {
    const session = newSession();
    expect(() => requireUsableSession(session, NOW)).toThrow(/not opened/);
    const opened = { ...session, signature: SIGNATURE };
    expect(requireUsableSession(opened, NOW).account.address).toBe(session.message.sessionKey);
    const later = new Date(Number(session.message.expiresAt) * 1000);
    expect(() => requireUsableSession(opened, later)).toThrow(/expired/);
  });
});

describe("configuration", () => {
  const base = { BADGE_SESSION_KEY_FILE: "/tmp/session.json" };

  it("defaults to the attested channel in tdx mode, which needs a pinned compose hash", () => {
    expect(() => loadMcpConfig(base, [])).toThrow(/BADGE_ENCLAVE_COMPOSE_HASH/);
    const config = loadMcpConfig({ ...base, BADGE_ENCLAVE_COMPOSE_HASH: COMPOSE_HASH }, []);
    expect(config).toMatchObject({
      enclaveTransport: "channel",
      attestationMode: "tdx",
      mcpTransport: "stdio",
    });
  });

  it("allows the plain transport only with the simulator", () => {
    const plain = { ...base, BADGE_ENCLAVE_TRANSPORT: "plain", BADGE_ENCLAVE_COMPOSE_HASH: COMPOSE_HASH };
    expect(() => loadMcpConfig(plain, [])).toThrow(/plain transport/);
    expect(loadMcpConfig({ ...plain, BADGE_ATTESTATION_MODE: "simulated" }, []).enclaveTransport).toBe(
      "plain",
    );
  });

  it("lets flags override the environment and requires a session file", () => {
    const env = { BADGE_ATTESTATION_MODE: "simulated" };
    expect(() => loadMcpConfig(env, [])).toThrow(/no session file/);
    expect(loadMcpConfig(env, ["--session", "/x.json", "--http", "--port", "9000"])).toMatchObject({
      sessionFile: "/x.json",
      mcpTransport: "http",
      httpPort: 9000,
    });
    expect(() => loadMcpConfig(env, ["--unknown"])).toThrow(/Unknown option/);
  });
});

describe("enclave verification at startup", () => {
  const session = requireUsableSession({ ...newSession(), signature: SIGNATURE }, NOW);
  const channel = {
    enclaveUrl: "http://127.0.0.1:8787",
    enclaveTransport: "channel",
    expectedComposeHash: undefined,
  } as const;
  const simulated = { ...channel, attestationMode: "simulated" } as const;
  const tdx = { ...channel, attestationMode: "tdx", expectedComposeHash: COMPOSE_HASH } as const;
  const unreachable = {
    connect: () => Promise.reject(new BadgeApiError(0, "NETWORK_ERROR", "ECONNREFUSED")),
  };
  const untrusted = {
    connect: () => Promise.reject(new BadgeApiError(0, "ATTESTATION_FAILED", "RTMR_MISMATCH")),
  };
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);

  beforeEach(() => {
    warnings.length = 0;
  });

  it("accepts the enclave the session was signed for", async () => {
    await verifyEnclave({ connect: async () => verifiedAttestation() }, simulated, session, warn);
    expect(warnings).toEqual([]);
  });

  it("refuses another enclave build", async () => {
    const other = {
      connect: async () => verifiedAttestation({ enclaveMeasurement: `0x${"99".repeat(32)}` }),
    };
    await expectSetupError(verifyEnclave(other, simulated, session, warn), "MEASUREMENT_MISMATCH");
  });

  it("refuses to start in tdx mode when the enclave cannot be attested", async () => {
    await expectSetupError(verifyEnclave(unreachable, tdx, session, warn), "ATTESTATION_FAILED");
    await expectSetupError(verifyEnclave(untrusted, tdx, session, warn), "ATTESTATION_FAILED");
  });

  it("only warns about an unreachable simulator, but still refuses a rejected attestation", async () => {
    await verifyEnclave(unreachable, simulated, session, warn);
    expect(warnings).toEqual([expect.stringContaining("ECONNREFUSED")]);
    await expectSetupError(verifyEnclave(untrusted, simulated, session, warn), "ATTESTATION_FAILED");
  });
});
