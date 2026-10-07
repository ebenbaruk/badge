import type { AttestationResult } from "@badge/attest";
import type { AuditLog, Task } from "@badge/client";
import { describe, expect, it } from "vitest";
import { attestationView, auditView, deskIdOf, parseBrief, taskView, type TaskRecord } from "./live-views";

const TASK_ID = `0x${"ab".repeat(32)}` as const;
const CREATED_AT = 1_791_100_800;
const RECORD: TaskRecord = { id: TASK_ID, requester: "alice", task: "Brief Orion", trapped: false };

const warn = {
  level: "warn" as const,
  reasons: [{ code: "FULL_CONTEXT_REQUEST", severity: "warn" as const, message: "Tout le contexte de Bob." }],
};

function task(overrides: Partial<Task>): Task {
  return {
    id: TASK_ID,
    taskLabel: "Brief RDV Orion",
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
      "**Brief : rendez-vous Orion**\n- Client depuis 2021 [1]\n- Remise de 12 % en 2025 [2, 3]\n- Hors sujet [9]",
      ["1", "2", "3"],
    );
    expect(brief.title).toBe("Brief : rendez-vous Orion");
    expect(brief.bullets).toEqual([
      { text: "Client depuis 2021", sourceIds: ["1"] },
      { text: "Remise de 12 % en 2025", sourceIds: ["2", "3"] },
      { text: "Hors sujet", sourceIds: [] },
    ]);
  });

  it("falls back to a default title and extracts a recommendation", () => {
    const brief = parseBrief("- Fait [1]\nRecommandation : proposer -15 % [1]", ["1"]);
    expect(brief.title).toBe("Brief");
    expect(brief.recommendation).toBe("proposer -15 %");
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
            excerptLabel: "Tout le contexte de Bob",
            excerptLength: 1800,
            consentId: "c1",
            risk: warn,
          },
        ],
      }),
      { ...RECORD, trapped: true },
    );
    expect(view.pending[0]?.findings).toEqual([
      { rule: "FULL_CONTEXT_REQUEST", outcome: "warn", message: "Tout le contexte de Bob." },
    ]);
    expect(view.trapped).toBe(true);
    expect(view.steps.map((s) => s.kind)).toEqual(["search", "rule_warn", "waiting_consent"]);
  });

  it("reports a task that released nothing as refused, with the owner's refusal", () => {
    const view = taskView(
      task({
        refused: [
          { ownerId: "bob", ownerName: "Bob", excerptLabel: "Tout", excerptLength: 10, reason: "rejected" },
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
            excerptLabel: "Fiche Orion",
            excerptLength: 200,
            via: "company",
          },
          { ownerId: "bob", ownerName: "Bob", excerptLabel: "Conditions", excerptLength: 300, via: "policy" },
        ],
        brief: "Brief Orion\n- Remise 12 % [2]",
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
    chain: { valid: true, length: 3, brokenAt: null },
  };

  it("lists alerts and sealed shares, and shows a reveal only with what this bridge decrypted", () => {
    const anonymous = auditView(log, new Map());
    expect(anonymous.alerts.map((a) => a.seq)).toEqual([1]);
    expect(anonymous.sealed[0]).toMatchObject({
      seq: 2,
      sourceDesk: "research",
      label: "Vers le desk Origination",
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
