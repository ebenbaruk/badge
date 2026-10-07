import { decodeBadgeMessage, encodeBadgeMessage, isDeviceAscii } from "@badge/consent";
import { describe, expect, it } from "vitest";
import { EMPLOYEES } from "@/lib/directory";
import {
  AGENT_SESSION_TTL_SECONDS,
  buildAgentSession,
  buildContextPolicy,
  buildEmployeeEnroll,
  deviceLabel,
  deviceName,
  MAX_DEVICE_LABEL_LENGTH,
} from "./messages";

const MEASUREMENT = `0x${"ab".repeat(32)}` as const;
const NOW = 1_791_100_800n;

describe("device messages", () => {
  it("names people in device ASCII", () => {
    expect(deviceName(EMPLOYEES.chloe)).toBe("Chloe Bernard (Juridique & conformite)");
  });

  it("truncates labels to the device limit and keeps them canonical", () => {
    const label = deviceLabel(`Réunion Orion ${"très ".repeat(20)}longue`);
    expect(label.length).toBeLessThanOrEqual(MAX_DEVICE_LABEL_LENGTH);
    expect(isDeviceAscii(label)).toBe(true);
    expect(deviceLabel("   ")).toBe("extrait");
  });

  it("builds messages that survive the strict wire format", () => {
    const enroll = buildEmployeeEnroll(EMPLOYEES.chloe, MEASUREMENT, NOW, 1n);
    expect(decodeBadgeMessage("EmployeeEnroll", encodeBadgeMessage("EmployeeEnroll", enroll))).toEqual(
      enroll,
    );

    const policy = buildContextPolicy(
      EMPLOYEES.bob,
      {
        granteeTeam: "Juridique & conformité",
        contextTag: "orion",
        purpose: "revue des contrats",
        maxExcerptLength: 500,
        durationDays: 30,
      },
      MEASUREMENT,
      NOW,
      2n,
    );
    expect(policy.granteeTeam).toBe("Juridique & conformite");
    expect(decodeBadgeMessage("ContextPolicy", encodeBadgeMessage("ContextPolicy", policy))).toEqual(policy);
  });

  it("delegates a working day to a fresh session key", () => {
    const { message, sessionKey } = buildAgentSession(
      EMPLOYEES.alice,
      MEASUREMENT,
      new Date(Number(NOW) * 1000),
    );
    expect(message.expiresAt - NOW).toBe(AGENT_SESSION_TTL_SECONDS);
    expect(message.agentName).toBe("Agent Badge de Alice");
    expect(message.sessionKey).toBe(sessionKey.address);
    expect(message.employee).toBe(EMPLOYEES.alice.address);
  });
});
