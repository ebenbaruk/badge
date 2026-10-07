/**
 * Canonical JSON: object keys sorted, no whitespace. The audit hash must not depend on property insertion order,
 * otherwise re-serializing an entry read back from the database would "break" a valid chain.
 */
export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new TypeError("non-finite number in audit data");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  // bigint, function, symbol, undefined at top level: refuse rather than silently drop or mis-encode.
  throw new TypeError(`cannot canonicalize a ${typeof value} in audit data`);
}
