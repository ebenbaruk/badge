import { z } from "zod";

/**
 * What the enclave returns to a client hello: the evidence `verifyAttestation` needs, minus the client's own
 * values (nonce, clientPk), which the client must take from its own state, never from this response.
 */
export interface AttestationBundle {
  /** TDX quote, hex without prefix. */
  quote: string;
  /** dstack event log, the exact JSON string returned by `getQuote`. */
  eventLog: string;
  /** The exact app-compose string of the deployment. */
  appCompose: string;
  /** Enclave X25519 public key for this channel, hex without prefix. */
  enclavePk: string;
}

/** Validates a bundle received from the network before handing it to `verifyAttestation`. */
export const attestationBundleSchema = z.object({
  quote: z.string().regex(/^(0x)?([0-9a-fA-F]{2})+$/, "quote must be hex"),
  eventLog: z.string().min(1),
  appCompose: z.string().min(1),
  enclavePk: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "enclavePk must be 32 bytes of hex"),
}) satisfies z.ZodType<AttestationBundle>;
