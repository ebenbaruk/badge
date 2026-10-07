/**
 * "What your Ledger will show": the clear-signing screens of a message, computed from the same descriptors the
 * device receives (BADGE_DESCRIPTORS), so the preview cannot drift from the device.
 */
import {
  BADGE_DESCRIPTORS,
  decodeBadgeMessage,
  type BadgeMessageKind,
  type WireMessage,
} from "@badge/consent";

export interface DevicePreview {
  /** Shown by the device under "Contract" / as the review title. */
  intent: string;
  rows: Array<{ label: string; value: string; mono: boolean }>;
}

/** The device renders datetimes as UTC `YYYY-MM-DD HH:MM:SS`. */
function deviceDatetime(seconds: bigint): string {
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** @throws InvalidMessageError if the wire message is malformed (never preview something we would not sign). */
export function devicePreview<K extends BadgeMessageKind>(kind: K, wire: WireMessage<K>): DevicePreview {
  const message = decodeBadgeMessage(kind, wire) as unknown as Record<string, unknown>;
  const descriptor = BADGE_DESCRIPTORS[kind];
  return {
    intent: descriptor.intent,
    rows: descriptor.fields.map((field) => {
      const value = message[field.path];
      if (field.format === "datetime" && typeof value === "bigint") {
        return { label: field.label, value: deviceDatetime(value), mono: true };
      }
      const text = String(value);
      return { label: field.label, value: text, mono: text.startsWith("0x") || /^\d+$/.test(text) };
    }),
  };
}
