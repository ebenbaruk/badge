/**
 * The canonical text a ContextRevoke shows on the device ("Revoquer: ..."). grantId and recipient are signed but
 * not displayed, so the label is the only thing the owner reads: the enclave prepares it from the real target and
 * refuses any other label, which binds what the owner reads to what actually gets revoked.
 */
import { toDeviceAscii } from "./ascii";

/** Room left under the wire string limit (256) whatever the directory names and tags. */
export const MAX_REVOKE_LABEL_LENGTH = 200;

/** What a revocation targets, described with the names the owner knows. */
export type RevocationTarget =
  /** One one-off share: its recipient (as signed in the ContextShare, e.g. "Alice Martin (Ventes)") and excerpt. */
  | { kind: "grant"; recipientName: string; excerptLabel: string }
  /** One standing agreement (granted to a team, for one context tag). */
  | { kind: "policy"; granteeTeam: string; contextTag: string }
  /**
   * Everything granted to one colleague: their one-off shares AND every standing agreement granted to their team,
   * which affects the whole team, so the label says so.
   */
  | { kind: "recipient"; recipientName: string; recipientTeam: string };

/** The device-ASCII label of a revocation of `target` (deterministic: the enclave recomputes it to check it). */
export function revocationTargetLabel(target: RevocationTarget): string {
  let label: string;
  switch (target.kind) {
    case "grant":
      label = `${target.recipientName} - ${target.excerptLabel}`;
      break;
    case "policy":
      label = `Accord equipe ${target.granteeTeam} - ${target.contextTag}`;
      break;
    case "recipient":
      label = `Tout ce que j'ai partage avec ${target.recipientName} + accords equipe ${target.recipientTeam}`;
      break;
  }
  return toDeviceAscii(toDeviceAscii(label).slice(0, MAX_REVOKE_LABEL_LENGTH));
}
