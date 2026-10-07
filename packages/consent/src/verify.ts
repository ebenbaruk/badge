/**
 * Stateless consent verification: signature recovery and intrinsic checks that need no database (expiry, enclave
 * pinning, excerpt binding, bounded horizons). Stateful checks (nonce reuse, revocation, directory membership) are
 * the enclave's job. Every function throws a {@link ConsentError} on the first problem and returns nothing on
 * success: there is no "result" a caller could forget to inspect.
 */
import {
  isAddressEqual,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { assertDeviceAscii } from "./ascii";
import { ConsentError, MalformedSignatureError, SignatureMismatchError } from "./errors";
import { excerptLength, hashExcerpt } from "./excerpt";
import {
  BADGE_TYPES,
  type AgentSession,
  type BadgeMessageKind,
  type BadgeMessages,
  type ContextPolicy,
  type ContextRevoke,
  type ContextShare,
  type DeskJoin,
  type DeskShare,
  type EmployeeEnroll,
} from "./messages";
import { badgeTypedData } from "./typed-data";

const MINUTE = 60n;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;

/** A one-off share is meant for the task at hand; a week is generous and limits the damage of a forgotten grant. */
export const MAX_SHARE_TTL_SECONDS = 7n * DAY;
/** Same horizon for anonymous desk shares, which are one-off as well. */
export const MAX_DESK_SHARE_TTL_SECONDS = 7n * DAY;
/** An agent session key lives on a laptop: keep its delegation short. */
export const MAX_AGENT_SESSION_TTL_SECONDS = 7n * DAY;
/** Standing agreements trade validation fatigue for exposure: capped at one quarter, then re-signed. */
export const MAX_POLICY_TTL_SECONDS = 90n * DAY;
/** An enrollment must be submitted soon after it is signed, so a leaked one cannot be replayed much later. */
export const MAX_ENROLL_AGE_SECONDS = 1n * DAY;
/** Tolerated clock drift between the signer's machine and the enclave for `issuedAt` fields. */
export const MAX_CLOCK_SKEW_SECONDS = 5n * MINUTE;
/** BN254 scalar field order: a Semaphore identity commitment is a field element and must be below it. */
export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Converts a Date to the unix-seconds bigint used by every `expiresAt` / `issuedAt` field. */
export function toUnixSeconds(date: Date): bigint {
  return BigInt(Math.floor(date.getTime() / 1000));
}

/**
 * The address that must have signed `message`, read from the message itself, or `null` for `DeskShare` whose
 * signer is deliberately absent (anonymity) and known only to the enclave.
 */
export function claimedSigner<K extends BadgeMessageKind>(
  kind: K,
  message: BadgeMessages[K],
): Address | null {
  const fields = message as Partial<Record<"owner" | "employee", Address>>;
  switch (kind) {
    case "EmployeeEnroll":
    case "AgentSession":
    case "DeskJoin":
      return fields.employee ?? null;
    case "ContextShare":
    case "ContextPolicy":
    case "ContextRevoke":
      return fields.owner ?? null;
    default:
      return null;
  }
}

/**
 * Recovers the EIP-712 signer of `message`. Throws {@link MalformedSignatureError} when no address can be
 * recovered (bad length, invalid curve point, out-of-range `v`).
 */
export async function recoverBadgeSigner<K extends BadgeMessageKind>(
  kind: K,
  message: BadgeMessages[K],
  signature: Hex,
): Promise<Address> {
  try {
    // viem's generic signature cannot relate a generic K to its message type; badgeTypedData builds it exactly.
    const typedData = badgeTypedData(kind, message) as unknown as TypedDataDefinition;
    return await recoverTypedDataAddress({ ...typedData, signature });
  } catch (error) {
    throw new MalformedSignatureError(`cannot recover the signer of ${kind}`, { cause: error });
  }
}

/**
 * Verifies that `signature` is `expectedSigner`'s EIP-712 signature of `message`. Throws
 * {@link SignatureMismatchError} for another signer, {@link MalformedSignatureError} for unparsable bytes.
 * The zero address is never an acceptable signer.
 */
export async function verifyBadgeSignature<K extends BadgeMessageKind>(
  kind: K,
  message: BadgeMessages[K],
  signature: Hex,
  expectedSigner: Address,
): Promise<void> {
  if (isAddressEqual(expectedSigner, zeroAddress)) {
    throw new ConsentError("INVALID_FIELD", "the expected signer cannot be the zero address");
  }
  const recovered = await recoverBadgeSigner(kind, message, signature);
  if (!isAddressEqual(recovered, expectedSigner)) throw new SignatureMismatchError(expectedSigner, recovered);
}

/** Context of checks that only depend on time and on the enclave we are running in. */
export interface CheckContext {
  /** Current time in unix seconds (see {@link toUnixSeconds}); injected so that checks stay pure and testable. */
  now: bigint;
  /** Measurement of the running enclave (bytes32); a consent pinned to another enclave is refused. */
  enclaveMeasurement: Hex;
}

/** {@link CheckContext} plus the excerpt text about to be released, whose fingerprint the consent must match. */
export interface ExcerptCheckContext extends CheckContext {
  excerptText: string;
}

function assertStringFieldsAscii<K extends BadgeMessageKind>(kind: K, message: BadgeMessages[K]): void {
  const values = message as unknown as Record<string, unknown>;
  for (const { name, type } of BADGE_TYPES[kind]) {
    if (type !== "string") continue;
    const value = values[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new ConsentError("INVALID_FIELD", `${kind}.${name} must be a non-empty string`);
    }
    assertDeviceAscii(value, `${kind}.${name}`);
  }
}

function assertNonZeroAddress(kind: BadgeMessageKind, field: string, value: Address): void {
  if (isAddressEqual(value, zeroAddress))
    throw new ConsentError("INVALID_FIELD", `${kind}.${field} is the zero address`);
}

function assertSameMeasurement(kind: BadgeMessageKind, signed: Hex, running: Hex): void {
  if (signed.toLowerCase() !== running.toLowerCase()) {
    throw new ConsentError("ENCLAVE_MISMATCH", `${kind} is pinned to enclave ${signed}, running ${running}`);
  }
}

function assertExpiry(kind: BadgeMessageKind, expiresAt: bigint, now: bigint, maxTtl: bigint): void {
  if (expiresAt <= now) throw new ConsentError("EXPIRED", `${kind} expired at ${expiresAt} (now ${now})`);
  if (expiresAt - now > maxTtl) {
    throw new ConsentError(
      "TTL_TOO_LONG",
      `${kind} expires in ${expiresAt - now}s, more than the ${maxTtl}s allowed`,
    );
  }
}

function assertNotFuture(kind: BadgeMessageKind, issuedAt: bigint, now: bigint): void {
  if (issuedAt > now + MAX_CLOCK_SKEW_SECONDS) {
    throw new ConsentError("NOT_YET_VALID", `${kind} is issued at ${issuedAt}, in the future (now ${now})`);
  }
}

function assertExcerptBinding(
  kind: BadgeMessageKind,
  signed: { excerptHash: Hex; excerptLength: number },
  text: string,
): void {
  const actualHash = hashExcerpt(text);
  if (signed.excerptHash.toLowerCase() !== actualHash) {
    throw new ConsentError(
      "EXCERPT_HASH_MISMATCH",
      `${kind} signs excerpt ${signed.excerptHash}, got ${actualHash}`,
    );
  }
  // The hash already binds the text; the length is re-checked because it is what the owner read on the device.
  const actualLength = excerptLength(text);
  if (signed.excerptLength !== actualLength) {
    throw new ConsentError(
      "EXCERPT_LENGTH_MISMATCH",
      `${kind} shows ${signed.excerptLength} characters, the excerpt has ${actualLength}`,
    );
  }
}

/**
 * Intrinsic checks of a one-off share before releasing `excerptText`: displayed strings, non-zero parties,
 * enclave pinning, unexpired with a horizon of at most {@link MAX_SHARE_TTL_SECONDS}, excerpt hash and length.
 */
export function checkContextShare(share: ContextShare, context: ExcerptCheckContext): void {
  const kind = "ContextShare";
  assertStringFieldsAscii(kind, share);
  assertNonZeroAddress(kind, "owner", share.owner);
  assertNonZeroAddress(kind, "recipient", share.recipient);
  assertSameMeasurement(kind, share.enclaveMeasurement, context.enclaveMeasurement);
  assertExpiry(kind, share.expiresAt, context.now, MAX_SHARE_TTL_SECONDS);
  assertExcerptBinding(kind, share, context.excerptText);
}

/**
 * Intrinsic checks of an agent delegation: displayed strings, enclave pinning, unexpired within
 * {@link MAX_AGENT_SESSION_TTL_SECONDS}, and a session key distinct from the employee's own Ledger address
 * (delegating to oneself would let a stolen session pass as a Ledger-signed consent).
 */
export function checkAgentSession(session: AgentSession, context: CheckContext): void {
  const kind = "AgentSession";
  assertStringFieldsAscii(kind, session);
  assertNonZeroAddress(kind, "employee", session.employee);
  assertNonZeroAddress(kind, "sessionKey", session.sessionKey);
  if (isAddressEqual(session.sessionKey, session.employee)) {
    throw new ConsentError("INVALID_FIELD", "AgentSession.sessionKey must differ from the employee address");
  }
  assertSameMeasurement(kind, session.enclaveMeasurement, context.enclaveMeasurement);
  assertExpiry(kind, session.expiresAt, context.now, MAX_AGENT_SESSION_TTL_SECONDS);
}

/**
 * Intrinsic checks of a standing agreement: displayed strings, enclave pinning, unexpired within
 * {@link MAX_POLICY_TTL_SECONDS}, positive per-excerpt cap. With `excerptText`, also enforces that cap on the
 * excerpt about to be released under this policy.
 */
export function checkContextPolicy(
  policy: ContextPolicy,
  context: CheckContext & { excerptText?: string },
): void {
  const kind = "ContextPolicy";
  assertStringFieldsAscii(kind, policy);
  assertNonZeroAddress(kind, "owner", policy.owner);
  if (policy.maxExcerptLength <= 0)
    throw new ConsentError("INVALID_FIELD", "ContextPolicy.maxExcerptLength must be > 0");
  assertSameMeasurement(kind, policy.enclaveMeasurement, context.enclaveMeasurement);
  assertExpiry(kind, policy.expiresAt, context.now, MAX_POLICY_TTL_SECONDS);
  if (context.excerptText !== undefined) {
    const length = excerptLength(context.excerptText);
    if (length > policy.maxExcerptLength) {
      throw new ConsentError(
        "EXCERPT_TOO_LONG",
        `excerpt has ${length} characters, the policy allows ${policy.maxExcerptLength}`,
      );
    }
  }
}

/**
 * Intrinsic checks of an anonymous desk share: displayed strings, distinct desks, enclave pinning, unexpired within
 * {@link MAX_DESK_SHARE_TTL_SECONDS}, excerpt hash and length.
 */
export function checkDeskShare(share: DeskShare, context: ExcerptCheckContext): void {
  const kind = "DeskShare";
  assertStringFieldsAscii(kind, share);
  if (share.sourceDesk === share.recipientDesk) {
    throw new ConsentError("INVALID_FIELD", "DeskShare.sourceDesk and recipientDesk must differ");
  }
  assertSameMeasurement(kind, share.enclaveMeasurement, context.enclaveMeasurement);
  assertExpiry(kind, share.expiresAt, context.now, MAX_DESK_SHARE_TTL_SECONDS);
  assertExcerptBinding(kind, share, context.excerptText);
}

/**
 * Intrinsic checks of an enrollment: displayed strings, enclave pinning, and freshness (`issuedAt` no more than
 * {@link MAX_ENROLL_AGE_SECONDS} old and not in the future beyond {@link MAX_CLOCK_SKEW_SECONDS}).
 */
export function checkEmployeeEnroll(enroll: EmployeeEnroll, context: CheckContext): void {
  const kind = "EmployeeEnroll";
  assertStringFieldsAscii(kind, enroll);
  assertNonZeroAddress(kind, "employee", enroll.employee);
  assertSameMeasurement(kind, enroll.enclaveMeasurement, context.enclaveMeasurement);
  assertNotFuture(kind, enroll.issuedAt, context.now);
  if (context.now - enroll.issuedAt > MAX_ENROLL_AGE_SECONDS) {
    throw new ConsentError(
      "STALE",
      `EmployeeEnroll was issued at ${enroll.issuedAt}, too long ago (now ${context.now})`,
    );
  }
}

/**
 * Intrinsic checks of a revocation: displayed strings, non-zero owner, `issuedAt` not in the future. No age limit:
 * replaying an old revocation can only remove access, never grant it (the nonce still prevents double use).
 */
export function checkContextRevoke(revoke: ContextRevoke, context: Pick<CheckContext, "now">): void {
  const kind = "ContextRevoke";
  assertStringFieldsAscii(kind, revoke);
  assertNonZeroAddress(kind, "owner", revoke.owner);
  assertNotFuture(kind, revoke.issuedAt, context.now);
}

/** Intrinsic checks of a desk join: displayed strings, non-zero employee, commitment a non-zero BN254 element. */
export function checkDeskJoin(join: DeskJoin): void {
  const kind = "DeskJoin";
  assertStringFieldsAscii(kind, join);
  assertNonZeroAddress(kind, "employee", join.employee);
  if (join.identityCommitment <= 0n || join.identityCommitment >= SNARK_SCALAR_FIELD) {
    throw new ConsentError(
      "INVALID_FIELD",
      "DeskJoin.identityCommitment is not a non-zero BN254 field element",
    );
  }
}
