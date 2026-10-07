/**
 * @badge/attest: verification of the Badge enclave (Intel TDX via dstack) and the attested channel to it.
 * Works in Node and in the browser. Enclave-side helpers that need the dstack SDK live in `@badge/attest/server`.
 */
export { attestationBundleSchema, type AttestationBundle } from "./bundle";
export {
  CHANNEL_NONCE_LENGTH,
  channelHelloSchema,
  channelReportData,
  ClientChannel,
  EnclaveChannel,
  generateX25519KeyPair,
  sealedMessageSchema,
  X25519_KEY_LENGTH,
  x25519PublicKey,
  type ChannelAttestation,
  type ChannelHello,
  type SealedMessage,
} from "./channel";
export {
  composeHashOf,
  composePolicyViolations,
  enclaveMeasurementFrom,
  parseAppCompose,
  type AppCompose,
} from "./compose";
export {
  AttestationError,
  AttestError,
  ChannelError,
  ComposeError,
  EventLogError,
  QuoteFormatError,
  type AttestErrorCode,
} from "./errors";
export {
  complianceKeyDeriveMessage,
  complianceKeyFromSignature,
  complianceKeyRegistrationMessage,
} from "./compliance";
export {
  openSealed,
  SEALED_BOX_ALGORITHM,
  SEALED_BOX_VERSION,
  sealedBoxSchema,
  sealToPublicKey,
  type SealedBox,
} from "./sealed";
export { parseTdxQuote, type TdxQuote } from "./quote";
export {
  assertRtmrsMatch,
  DSTACK_EVENTS,
  DSTACK_RUNTIME_EVENT_TYPE,
  extractAppIdentity,
  parseEventLog,
  replayRtmrs,
  runtimeEventDigest,
  type AttestedAppIdentity,
  type DstackEvent,
} from "./rtmr";
export {
  phalaDcapVerifier,
  verifyAttestation,
  type AttestationMode,
  type AttestationResult,
  type DcapReport,
  type DcapVerifier,
  type OsMeasurements,
  type RejectedAttestation,
  type TcbStatus,
  type VerifiedAttestation,
  type VerifyAttestationInput,
} from "./verify";
