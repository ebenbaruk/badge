/**
 * Sealed boxes: encrypt to an X25519 public key without any prior exchange (ECIES-style). Used by the enclave to
 * seal the signer identity of an anonymous desk share to the compliance officer's key: the enclave can write it,
 * only the officer (with her Ledger) can read it.
 *
 * Construction: fresh ephemeral X25519 key per message; key = HKDF-SHA256(shared secret, info = label || epk ||
 * recipientPk); AES-256-GCM with a random nonce and the envelope version as AAD. Binding both public keys into the
 * key derivation prevents re-targeting an envelope at another recipient.
 */
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { z } from "zod";
import { concatBytes, decodeHex, toHex, utf8ToBytes } from "./bytes";
import { X25519_KEY_LENGTH } from "./channel";
import { AttestError } from "./errors";

export const SEALED_BOX_VERSION = 1;
export const SEALED_BOX_ALGORITHM = "X25519-HKDF-SHA256-AES256GCM";
const SEALED_BOX_LABEL = "badge-sealed-box-v1";
const AES_KEY_LENGTH = 32;
const GCM_NONCE_LENGTH = 12;

/** A sealed box as JSON: every byte field is lowercase hex without prefix. */
export interface SealedBox {
  v: typeof SEALED_BOX_VERSION;
  alg: typeof SEALED_BOX_ALGORITHM;
  /** Ephemeral X25519 public key. */
  epk: string;
  nonce: string;
  /** AES-GCM ciphertext followed by its 16-byte tag. */
  ciphertext: string;
}

export const sealedBoxSchema = z.strictObject({
  v: z.literal(SEALED_BOX_VERSION),
  alg: z.literal(SEALED_BOX_ALGORITHM),
  epk: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: z.string().regex(/^[0-9a-f]{24}$/),
  ciphertext: z.string().regex(/^([0-9a-f]{2})+$/),
}) satisfies z.ZodType<SealedBox>;

function boxKey(shared: Uint8Array, epk: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  const info = concatBytes(utf8ToBytes(SEALED_BOX_LABEL), epk, recipientPk);
  return hkdf(sha256, shared, undefined, info, AES_KEY_LENGTH);
}

function sharedSecret(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  try {
    // noble rejects low-order points (all-zero shared secret), which would make the key predictable.
    return x25519.getSharedSecret(secretKey, publicKey);
  } catch (error) {
    throw new AttestError("INVALID_INPUT", "X25519 public key is invalid", { cause: error });
  }
}

const AAD = utf8ToBytes(`${SEALED_BOX_LABEL}|${SEALED_BOX_VERSION}|${SEALED_BOX_ALGORITHM}`);

/**
 * Encrypts `plaintext` (bytes, or a string as UTF-8) so that only the holder of the secret key matching
 * `recipientPk` (32 bytes, or hex) can read it.
 * @throws AttestError("INVALID_INPUT") on a malformed public key.
 */
export function sealToPublicKey(recipientPk: Uint8Array | string, plaintext: Uint8Array | string): SealedBox {
  const recipient =
    typeof recipientPk === "string" ? decodeHex(recipientPk, "recipientPk", X25519_KEY_LENGTH) : recipientPk;
  if (recipient.length !== X25519_KEY_LENGTH) {
    throw new AttestError("INVALID_INPUT", `recipientPk must be ${X25519_KEY_LENGTH} bytes`);
  }
  const ephemeralSecret = x25519.utils.randomPrivateKey();
  const epk = x25519.getPublicKey(ephemeralSecret);
  const key = boxKey(sharedSecret(ephemeralSecret, recipient), epk, recipient);
  const nonce = randomBytes(GCM_NONCE_LENGTH);
  const data = typeof plaintext === "string" ? utf8ToBytes(plaintext) : plaintext;
  const ciphertext = gcm(key, nonce, AAD).encrypt(data);
  return {
    v: SEALED_BOX_VERSION,
    alg: SEALED_BOX_ALGORITHM,
    epk: toHex(epk),
    nonce: toHex(nonce),
    ciphertext: toHex(ciphertext),
  };
}

/**
 * Opens a sealed box (validated here: it usually comes from storage or the network) with the recipient's secret key.
 * Returns the plaintext bytes (decode with `TextDecoder` for text).
 * @throws AttestError("INVALID_INPUT") on a malformed envelope or key, ("sealed_box_auth_failed") when the box was
 * tampered with or sealed to another key.
 */
export function openSealed(recipientSk: Uint8Array, sealed: unknown): Uint8Array {
  const parsed = sealedBoxSchema.safeParse(sealed);
  if (!parsed.success) {
    throw new AttestError("INVALID_INPUT", `sealed box is malformed: ${z.prettifyError(parsed.error)}`);
  }
  if (recipientSk.length !== X25519_KEY_LENGTH) {
    throw new AttestError("INVALID_INPUT", `recipient secret key must be ${X25519_KEY_LENGTH} bytes`);
  }
  const epk = decodeHex(parsed.data.epk, "epk", X25519_KEY_LENGTH);
  const recipientPk = x25519.getPublicKey(recipientSk);
  const key = boxKey(sharedSecret(recipientSk, epk), epk, recipientPk);
  try {
    return gcm(key, decodeHex(parsed.data.nonce, "nonce"), AAD).decrypt(
      decodeHex(parsed.data.ciphertext, "ciphertext"),
    );
  } catch (error) {
    throw new AttestError(
      "sealed_box_auth_failed",
      "sealed box authentication failed (tampered or wrong key)",
      {
        cause: error,
      },
    );
  }
}
