import type { RuleFinding } from "@/server/enclave/types";

/**
 * Identity of a rule reason for de-duplication: the same rule can fire with different wording (e.g. a length rule
 * quoting each excerpt's size), and those stay distinct; only the exact same rule and message collapse.
 */
export const reasonKey = (rule: string, message: string | undefined): string =>
  `${rule}\u0000${message ?? ""}`;

/**
 * The enclave evaluates every candidate excerpt separately, so one request touching several excerpts of the same
 * owner reports the same reason once per excerpt. Shown as is, one attack reads as several. Keeps the first
 * occurrence of each (rule, message) pair, in order.
 */
export function uniqueFindings(findings: Iterable<RuleFinding>): RuleFinding[] {
  const byKey = new Map<string, RuleFinding>();
  for (const finding of findings) {
    const key = reasonKey(finding.rule, finding.message);
    if (!byKey.has(key)) byKey.set(key, finding);
  }
  return [...byKey.values()];
}
