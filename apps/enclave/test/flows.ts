/** Request helpers and the bootstrap flows (enroll, session) shared by the API-level tests. */
import { decodeBadgeMessage, toDeviceAscii, toUnixSeconds, type ContextShare } from "@badge/consent";
import type { Hex } from "viem";
import { expect } from "vitest";
import {
  agents,
  ledgers,
  MEASUREMENT,
  nextNonce,
  SESSION_HEADER,
  signedWire,
  type DemoEmployee,
  type Harness,
} from "./harness";

export interface ApiResponse {
  readonly status: number;
  // Test code reads arbitrary JSON shapes; each test asserts the fields it relies on.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly json: any;
}

/** Calls the in-process API, authenticated as `as`'s agent when given. */
export async function call(
  h: Harness,
  method: "GET" | "POST",
  path: string,
  options: { as?: DemoEmployee; body?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.as) headers[SESSION_HEADER] = agents[options.as].address;
  const response = await h.app.request(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, json: await response.json() };
}

const NAMES: Record<DemoEmployee, { name: string; team: string }> = {
  alice: { name: "Alice Martin", team: "Ventes" },
  bob: { name: "Bob Durand", team: "Grands comptes" },
  chloe: { name: "Chloe Bernard", team: "Juridique & conformite" },
};

export function nowSec(h: Harness): bigint {
  return toUnixSeconds(h.clock.now());
}

export async function enroll(
  h: Harness,
  who: DemoEmployee,
  measurement: Hex = MEASUREMENT,
): Promise<ApiResponse> {
  return call(h, "POST", "/v1/enroll", {
    body: await signedWire(ledgers[who], "EmployeeEnroll", {
      company: "Acme",
      employeeName: toDeviceAscii(NAMES[who].name),
      team: toDeviceAscii(NAMES[who].team),
      enclaveMeasurement: measurement,
      employee: ledgers[who].address,
      issuedAt: nowSec(h) - 30n,
      nonce: nextNonce(),
    }),
  });
}

export async function openSession(h: Harness, who: DemoEmployee): Promise<ApiResponse> {
  return call(h, "POST", "/v1/sessions", {
    body: await signedWire(ledgers[who], "AgentSession", {
      agentName: "Claude Code",
      access: "Demandes seulement",
      expiresAt: nowSec(h) + 8n * 3600n,
      sessionKey: agents[who].address,
      enclaveMeasurement: MEASUREMENT,
      employee: ledgers[who].address,
      nonce: nextNonce(),
    }),
  });
}

/** Enrolls and opens a session for each employee. */
export async function onboard(h: Harness, ...who: DemoEmployee[]): Promise<void> {
  for (const employee of who) {
    expect((await enroll(h, employee)).status).toBe(201);
    expect((await openSession(h, employee)).status).toBe(201);
  }
}

/** Opens fresh sessions (after the test clock moved past the previous ones). */
export async function refreshSessions(h: Harness, ...who: DemoEmployee[]): Promise<void> {
  for (const employee of who) expect((await openSession(h, employee)).status).toBe(201);
}

/** Decodes a ContextShare from GET /v1/consents (wire -> message) with the consent package. */
export async function pendingShares(
  h: Harness,
  who: DemoEmployee,
): Promise<
  Array<{ id: Hex; message: ContextShare; risk: { level: string; reasons: Array<{ code: string }> } }>
> {
  const response = await call(h, "GET", "/v1/consents", { as: who });
  expect(response.status).toBe(200);
  return response.json.consents.map(
    (c: { id: Hex; message: unknown; risk: { level: string; reasons: Array<{ code: string }> } }) => ({
      id: c.id,
      message: decodeBadgeMessage("ContextShare", c.message),
      risk: c.risk,
    }),
  );
}
