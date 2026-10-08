import type { AttestationResult } from "@badge/attest";
import type { AuditLog, Task } from "@badge/client";
import { describe, expect, it } from "vitest";
import {
  attestationView,
  auditView,
  deskIdOf,
  parseBrief,
  ruleSteps,
  taskView,
  type TaskRecord,
} from "./live-views";

const TASK_ID = `0x${"ab".repeat(32)}` as const;
const CREATED_AT = 1_791_100_800;
const RECORD: TaskRecord = { id: TASK_ID, requester: "alice", task: "Orion brief", trapped: false };

const warn = {
  level: "warn" as const,
  reasons: [
    { code: "FULL_CONTEXT_REQUEST", severity: "warn" as const, message: "Full context of Bob Durand." },
  ],
};

function task(overrides: Partial<Task>): Task {
  return {
    id: TASK_ID,
    taskLabel: "Orion meeting brief",
    status: "ready",
    allowed: [],
    pending: [],
    blocked: [],
    refused: [],
    brief: null,
    tokenStats: null,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe("parseBrief", () => {
  it("links [n] citations to the numbered sources and keeps the title", () => {
    const brief = parseBrief(
      "**Brief: Orion meeting**\n- Client since 2021 [1]\n- 12% discount in 2025 [2, 3]\n- Off topic [9]",
      ["1", "2", "3"],
    );
    expect(brief.title).toBe("Brief: Orion meeting");
    expect(brief.bullets).toEqual([
      { text: "Client since 2021", sourceIds: ["1"] },
      { text: "12% discount in 2025", sourceIds: ["2", "3"] },
      { text: "Off topic", sourceIds: [] },
    ]);
  });

  it("falls back to a default title and extracts a recommendation", () => {
    const brief = parseBrief("- Fact [1]\nRecommendation: offer 15% off [1]", ["1"]);
    expect(brief.title).toBe("Brief");
    expect(brief.recommendation).toBe("offer 15% off");
  });
});

describe("taskView", () => {
  it("shows the enclave's risk reasons as findings, without recomputing them", () => {
    const view = taskView(
      task({
        status: "waiting_consent",
        pending: [
          {
            ownerId: "bob",
            ownerName: "Bob Durand",
            excerptLabel: "Full context of Bob Durand",
            excerptLength: 1800,
            consentId: "c1",
            risk: warn,
          },
        ],
      }),
      { ...RECORD, trapped: true },
    );
    expect(view.pending[0]?.findings).toEqual([
      { rule: "FULL_CONTEXT_REQUEST", outcome: "warn", message: "Full context of Bob Durand." },
    ]);
    expect(view.trapped).toBe(true);
    expect(view.steps.map((s) => s.kind)).toEqual(["search", "rule_warn", "waiting_consent"]);
  });

  it("reports a task that released nothing as refused, with the owner's refusal", () => {
    const view = taskView(
      task({
        refused: [
          {
            ownerId: "bob",
            ownerName: "Bob",
            excerptLabel: "Everything",
            excerptLength: 10,
            reason: "rejected",
          },
        ],
      }),
      RECORD,
    );
    expect(view.status).toBe("refused");
    expect(view.blocked).toMatchObject([{ owner: "bob", kind: "rejected" }]);
    expect(view.steps.at(-1)?.kind).toBe("refused");
  });

  it("maps provenance and drafts the brief layout once ready", () => {
    const view = taskView(
      task({
        allowed: [
          {
            ownerId: "company",
            ownerName: "Acme",
            excerptLabel: "Orion client profile",
            excerptLength: 200,
            via: "company",
          },
          { ownerId: "bob", ownerName: "Bob", excerptLabel: "Terms", excerptLength: 300, via: "policy" },
        ],
        brief: "Orion brief\n- 12% discount [2]",
        tokenStats: { selectedTokens: 120, allContextTokens: 1200 },
      }),
      RECORD,
    );
    expect(view.allowed.map((s) => s.allowedBy)).toEqual(["global", "policy"]);
    expect(view.brief?.bullets[0]?.sourceIds).toEqual(["2"]);
    expect(view.steps.map((s) => s.kind)).toEqual(["search", "allowed", "policy", "brief"]);
  });

  it("refuses an owner the web directory does not know (contract break)", () => {
    const stranger = { ownerId: "mallory", ownerName: "M", excerptLabel: "x", excerptLength: 1 };
    expect(() => taskView(task({ allowed: [{ ...stranger, via: "consent" }] }), RECORD)).toThrow(/mallory/);
  });
});

describe("ruleSteps", () => {
  const full = { code: "FULL_CONTEXT_REQUEST", severity: "warn" as const, message: "100% of your context." };
  const long = { code: "EXCERPT_LENGTH", severity: "warn" as const, message: "Unusually long excerpt." };
  const block = { code: "OWNER_RATE", severity: "block" as const, message: "Too many requests." };

  it("shows one flagged request as one step, with each reason once and the excerpt count", () => {
    const steps = ruleSteps([
      { ownerId: "bob", risk: { level: "warn", reasons: [full, long] } },
      { ownerId: "bob", risk: { level: "warn", reasons: [full] } },
      { ownerId: "bob", risk: { level: "warn", reasons: [full] } },
      { ownerId: "bob", risk: { level: "warn", reasons: [full] } },
    ]);
    expect(steps).toEqual([
      {
        kind: "rule_warn",
        title: "Flagged to Bob by enclave rules",
        detail: "100% of Bob Durand's context. Unusually long excerpt. (4 excerpts)",
      },
    ]);
  });

  it("keeps one step per owner and level, skips ok excerpts, and omits the count for a single excerpt", () => {
    const steps = ruleSteps([
      { ownerId: "bob", risk: { level: "warn", reasons: [full] } },
      { ownerId: "bob", risk: { level: "ok", reasons: [] } },
      { ownerId: "bob", risk: { level: "block", reasons: [block] } },
      { ownerId: "chloe", risk: { level: "warn", reasons: [full] } },
    ]);
    expect(steps.map((s) => [s.kind, s.title, s.detail])).toEqual([
      ["rule_warn", "Flagged to Bob by enclave rules", "100% of Bob Durand's context."],
      ["rule_block", "Blocked by the rules before reaching Bob", "Too many requests."],
      ["rule_warn", "Flagged to Chloé by enclave rules", expect.stringMatching(/^100% of Chlo/)],
    ]);
  });
});

describe("attestationView", () => {
  const verified = {
    ok: true,
    mode: "simulated",
    simulated: true,
    tcbStatus: "Simulated",
    advisoryIds: [],
    composeHash: "11".repeat(32),
    enclaveMeasurement: `0x${"11".repeat(32)}`,
    appId: "22".repeat(20),
    rtmr3: "33".repeat(48),
    keyProvider: "kms",
    warnings: ["simulated quote"],
  } as unknown as AttestationResult;

  it("never shows a simulated quote as a real TEE", () => {
    const view = attestationView(verified, new Date(0));
    expect(view).toMatchObject({ mode: "simulated", verified: true, keyProvider: "kms" });
    expect(view.measurement).toBe(`0x${"11".repeat(32)}`);
  });

  it("fails closed on a rejected attestation", () => {
    const rejected = { ok: false, mode: "tdx", simulated: false, code: "quote_invalid", reason: "bad" };
    expect(() => attestationView(rejected as unknown as AttestationResult, new Date())).toThrow(/rejected/);
  });
});

describe("auditView", () => {
  const entry = (seq: number, type: string, data: Record<string, unknown>) => ({
    seq,
    ts: CREATED_AT + seq,
    type,
    actor: "anonymous",
    subject: TASK_ID,
    data,
    prevHash: `h${seq - 1}`,
    hash: `h${seq}`,
  });
  const log: AuditLog = {
    entries: [
      entry(1, "rule.warn", { reasons: [{ code: "FULL_CONTEXT_REQUEST" }] }),
      entry(2, "desk.share", {
        sourceDesk: "research",
        recipientDesk: "origination",
        sealedSigner: { v: 1, ciphertext: "aa" },
      }),
      entry(3, "compliance.reveal", { auditSeq: 2, reason: "test" }),
    ],
    chain: { valid: true, length: 3, brokenAt: null, head: "ab".repeat(32), signedHead: null },
  };

  it("lists alerts and sealed shares, and shows a reveal only with what this bridge decrypted", () => {
    const anonymous = auditView(log, new Map());
    expect(anonymous.alerts.map((a) => a.seq)).toEqual([1]);
    expect(anonymous.sealed[0]).toMatchObject({
      seq: 2,
      sourceDesk: "research",
      label: "To the Origination desk",
    });
    expect(anonymous.sealed[0]?.revealed?.employee).toBeUndefined();
    expect(anonymous.chain).toEqual({ ok: true, length: 3, headHash: "h3" });
    expect(auditView(log, new Map([[2, "bob"]])).sealed[0]?.revealed?.employee).toBe("bob");
  });
});

describe("deskIdOf", () => {
  it("accepts the API id and the device name, and nothing else", () => {
    expect(deskIdOf("research")).toBe("research");
    expect(deskIdOf("Origination")).toBe("origination");
    expect(() => deskIdOf("Trading")).toThrow(/Trading/);
  });
});
