import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_STORE_FILE_NAME, AgentStore, type PersistedRuntime } from "./agent-store";

const TASK_ID = `0x${"11".repeat(32)}` as const;
const privateKey = generatePrivateKey();

function runtime(): PersistedRuntime {
  return {
    alice: {
      enrolledAt: "2026-10-07T10:00:00.000Z",
      agent: {
        privateKey,
        session: {
          sessionKey: privateKeyToAccount(privateKey).address,
          employeeId: "alice",
          agentName: "Alice's Badge agent",
          expiresAt: 1_791_420_818,
        },
      },
      tasks: [{ id: TASK_ID, task: "Orion brief", trapped: false }],
      deskRequests: [],
    },
    // The consent history is optional (files written before it existed) and holds labels only.
    bob: {
      tasks: [],
      deskRequests: [],
      consentHistory: [
        {
          id: "consent-1",
          requester: "alice",
          excerptLabel: "Orion meeting of September 22",
          flagged: false,
          status: "approved",
          createdAt: "2026-10-07T10:00:00.000Z",
        },
      ],
    },
  };
}

describe("AgentStore", () => {
  let dir: string;
  let warnings: string[];
  let store: AgentStore;

  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "badge-web-")), "data");
    warnings = [];
    store = new AgentStore(dir, (message) => warnings.push(message));
  });

  it("starts empty without a file", () => {
    expect(store.load()).toEqual({});
    expect(warnings).toEqual([]);
  });

  it("round-trips the runtime in an owner-only file", () => {
    store.save(runtime());
    expect(store.load()).toEqual(runtime());
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("stays owner-only when it replaces a file that was readable by others", () => {
    store.save(runtime());
    chmodSync(store.path, 0o644);
    store.save(runtime());
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
  });

  it("never trusts a file other users can read", () => {
    store.save(runtime());
    chmodSync(store.path, 0o640);
    expect(store.load()).toEqual({});
    expect(warnings[0]).toMatch(/readable by other users/);
  });

  it("ignores a malformed file without echoing its content", () => {
    store.save(runtime());
    const tampered = JSON.parse(readFileSync(store.path, "utf8"));
    tampered.employees.alice.agent.privateKey = "0xnot-a-key";
    writeFileSync(join(dir, AGENT_STORE_FILE_NAME), JSON.stringify(tampered), { mode: 0o600 });
    expect(store.load()).toEqual({});
    expect(warnings[0]).toContain("employees.alice.agent.privateKey");
    expect(warnings[0]).not.toContain("not-a-key");

    writeFileSync(store.path, "{", { mode: 0o600 });
    expect(store.load()).toEqual({});
    expect(warnings[1]).toMatch(/not valid JSON/);
  });
});
