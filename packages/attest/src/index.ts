/**
 * @badge/attest: verification of the Badge enclave (Intel TDX via dstack).
 * Works in Node and in the browser.
 */
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
