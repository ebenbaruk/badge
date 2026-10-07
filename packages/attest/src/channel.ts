/**
 * Attested secure channel between a client (web app, CLI) and the enclave.
 *
 * Why an application-level channel: on Phala, TLS terminates at the gateway, so HTTPS alone does not reach the
 * enclave. The client instead binds its own X25519 key and a fresh nonce into the enclave's TDX quote
 * (report_data = sha512(nonce || clientPk || enclavePk)); only the attested enclave holds the matching key.
 *
 * Protocol:
 * 1. client -> enclave: `ChannelHello` { nonce, clientPk } (fresh ephemeral key per channel);
 * 2. enclave -> client: enclavePk + a quote over `channelReportData(nonce, clientPk, enclavePk)`;
 * 3. the client verifies the attestation (`verifyAttestation`) and only then derives the session keys.
 * Keys: HKDF-SHA256 over the X25519 secret, transcript as info, one key per direction. Messages: AES-256-GCM with
 * a per-direction sequence number as nonce; the receiver only accepts the next number (replay/reorder rejected).
 */
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256, sha512 } from "@noble/hashes/sha2";
import { z } from "zod";
import { concatBytes, decodeHex, normalizeHex, toHex, utf8ToBytes } from "./bytes";
import { AttestError, ChannelError } from "./errors";

export const CHANNEL_NONCE_LENGTH = 32;
export const X25519_KEY_LENGTH = 32;
const SESSION_KEY_LENGTH = 32;
const GCM_NONCE_LENGTH = 12;
const SEQUENCE_OFFSET_IN_NONCE = GCM_NONCE_LENGTH - 8;
/**
 * NIST caps AES-GCM at 2^32 invocations per key; the sequence counter must never wrap (nonce reuse breaks GCM),
 * so a channel refuses to go further. Channels are short-lived anyway: open a new one.
 */
const MAX_MESSAGES_PER_DIRECTION = 2 ** 32 - 1;

const PROTOCOL_LABEL = "badge-attested-channel-v1";
const CLIENT_TO_ENCLAVE = "client->enclave";
const ENCLAVE_TO_CLIENT = "enclave->client";

/** First message of the handshake, sent by the client. Hex without prefix. */
export interface ChannelHello {
  nonce: string;
  clientPk: string;
}

export const channelHelloSchema = z.object({
  nonce: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "nonce must be 32 bytes of hex"),
  clientPk: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "clientPk must be 32 bytes of hex"),
});

/** An encrypted channel message. `seq` is authenticated (it is the GCM nonce and part of the AAD). */
export interface SealedMessage {
  channelId: string;
  seq: number;
  ciphertext: string;
}

export const sealedMessageSchema = z.object({
  channelId: z.string().regex(/^[0-9a-f]{64}$/),
  seq: z.number().int().nonnegative().max(MAX_MESSAGES_PER_DIRECTION),
  ciphertext: z.string().regex(/^([0-9a-fA-F]{2})+$/),
});

/**
 * The 64 bytes the enclave puts in its quote's report_data: sha512(nonce || clientPk || enclavePk).
 * Binds freshness (nonce) and both channel keys to the attested enclave.
 */
export function channelReportData(
  nonce: Uint8Array,
  clientPk: Uint8Array,
  enclavePk: Uint8Array,
): Uint8Array {
  return sha512(concatBytes(nonce, clientPk, enclavePk));
}

/** Generates an X25519 key pair (e.g. a fresh enclave key for tests; production derives it with `getKey`). */
export function generateX25519KeyPair(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const secretKey = x25519.utils.randomPrivateKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** X25519 public key of a 32-byte secret (e.g. a key derived by the dstack KMS). */
export function x25519PublicKey(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey);
}

interface SessionKeys {
  channelId: string;
  sendKey: Uint8Array;
  receiveKey: Uint8Array;
  sendLabel: string;
  receiveLabel: string;
}

function deriveSessionKeys(
  role: "client" | "enclave",
  ownSecret: Uint8Array,
  peerPublic: Uint8Array,
  nonce: Uint8Array,
  clientPk: Uint8Array,
  enclavePk: Uint8Array,
): SessionKeys {
  let shared: Uint8Array;
  try {
    // noble rejects low-order points (all-zero shared secret), which would make the keys predictable.
    shared = x25519.getSharedSecret(ownSecret, peerPublic);
  } catch (error) {
    throw new ChannelError("INVALID_INPUT", "peer X25519 public key is invalid", { cause: error });
  }
  const transcript = concatBytes(utf8ToBytes(PROTOCOL_LABEL), nonce, clientPk, enclavePk);
  const keyFor = (direction: string) =>
    hkdf(sha256, shared, undefined, concatBytes(transcript, utf8ToBytes(direction)), SESSION_KEY_LENGTH);
  const clientToEnclave = keyFor(CLIENT_TO_ENCLAVE);
  const enclaveToClient = keyFor(ENCLAVE_TO_CLIENT);
  const channelId = toHex(sha256(transcript));
  return role === "client"
    ? {
        channelId,
        sendKey: clientToEnclave,
        receiveKey: enclaveToClient,
        sendLabel: CLIENT_TO_ENCLAVE,
        receiveLabel: ENCLAVE_TO_CLIENT,
      }
    : {
        channelId,
        sendKey: enclaveToClient,
        receiveKey: clientToEnclave,
        sendLabel: ENCLAVE_TO_CLIENT,
        receiveLabel: CLIENT_TO_ENCLAVE,
      };
}

function gcmNonce(seq: number): Uint8Array {
  const nonce = new Uint8Array(GCM_NONCE_LENGTH);
  new DataView(nonce.buffer).setBigUint64(SEQUENCE_OFFSET_IN_NONCE, BigInt(seq), false);
  return nonce;
}

function additionalData(channelId: string, direction: string, seq: number): Uint8Array {
  return utf8ToBytes(`${PROTOCOL_LABEL}|${channelId}|${direction}|${seq}`);
}

/** Encrypt/decrypt state shared by both ends once the keys are derived. */
class Session {
  private sendSeq = 0;
  private receiveSeq = 0;

  constructor(private readonly keys: SessionKeys) {}

  get channelId(): string {
    return this.keys.channelId;
  }

  seal(payload: unknown): SealedMessage {
    if (this.sendSeq > MAX_MESSAGES_PER_DIRECTION) {
      throw new ChannelError("channel_exhausted", "channel message limit reached, open a new channel");
    }
    const json = JSON.stringify(payload);
    if (json === undefined) throw new ChannelError("INVALID_INPUT", "payload is not JSON-serializable");
    const seq = this.sendSeq;
    const aad = additionalData(this.keys.channelId, this.keys.sendLabel, seq);
    const ciphertext = gcm(this.keys.sendKey, gcmNonce(seq), aad).encrypt(utf8ToBytes(json));
    this.sendSeq += 1;
    return { channelId: this.keys.channelId, seq, ciphertext: toHex(ciphertext) };
  }

  open<T>(message: unknown, schema?: z.ZodType<T>): T {
    const parsed = sealedMessageSchema.safeParse(message);
    if (!parsed.success) {
      throw new ChannelError(
        "INVALID_INPUT",
        `sealed message is malformed: ${z.prettifyError(parsed.error)}`,
      );
    }
    const { channelId, seq, ciphertext } = parsed.data;
    if (channelId !== this.keys.channelId) {
      throw new ChannelError("channel_mismatch", "message belongs to another channel");
    }
    // Strictly the next number: an old one is a replay, a later one means a message was dropped or reordered.
    if (seq !== this.receiveSeq) {
      throw new ChannelError("channel_sequence", `expected message #${this.receiveSeq}, got #${seq}`);
    }
    let plaintext: Uint8Array;
    try {
      const aad = additionalData(channelId, this.keys.receiveLabel, seq);
      plaintext = gcm(this.keys.receiveKey, gcmNonce(seq), aad).decrypt(decodeHex(ciphertext, "ciphertext"));
    } catch (error) {
      throw new ChannelError("channel_auth_failed", "message authentication failed (tampered or wrong key)", {
        cause: error,
      });
    }
    // Only advance once the message is authentic, so a forged message cannot desynchronise the channel.
    this.receiveSeq += 1;
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(plaintext));
    } catch (error) {
      throw new ChannelError("INVALID_INPUT", "decrypted payload is not JSON", { cause: error });
    }
    if (!schema) return value as T;
    const checked = schema.safeParse(value);
    if (!checked.success) {
      throw new ChannelError(
        "INVALID_INPUT",
        `decrypted payload is invalid: ${z.prettifyError(checked.error)}`,
      );
    }
    return checked.data;
  }
}

/** What the client needs from a successful attestation check to trust an enclave key. */
export interface ChannelAttestation {
  ok: true;
  nonce: string;
  clientPk: string;
  enclavePk: string;
}

/**
 * Client end of the channel. Create it, send `hello` to the enclave, verify the returned attestation with
 * `verifyAttestation`, then call `establish` with the result: no key is derived before the enclave is verified.
 */
export class ClientChannel {
  readonly hello: ChannelHello;
  private readonly secretKey: Uint8Array;
  private readonly nonce: Uint8Array;
  private readonly publicKey: Uint8Array;
  private session: Session | undefined;

  private constructor() {
    const { secretKey, publicKey } = generateX25519KeyPair();
    this.secretKey = secretKey;
    this.publicKey = publicKey;
    this.nonce = randomBytes(CHANNEL_NONCE_LENGTH);
    this.hello = { nonce: toHex(this.nonce), clientPk: toHex(publicKey) };
  }

  /** Starts a handshake with a fresh ephemeral key and a fresh nonce. */
  static create(): ClientChannel {
    return new ClientChannel();
  }

  /**
   * Derives the session keys from a VERIFIED attestation of this handshake.
   * @throws ChannelError("CHANNEL_UNVERIFIED") if the attestation is not ok or was made for another handshake.
   */
  establish(attestation: ChannelAttestation): void {
    if (attestation.ok !== true) {
      throw new ChannelError(
        "CHANNEL_UNVERIFIED",
        "cannot open a channel to an enclave that failed attestation",
      );
    }
    if (
      normalizeHex(attestation.nonce) !== this.hello.nonce ||
      normalizeHex(attestation.clientPk) !== this.hello.clientPk
    ) {
      throw new ChannelError("CHANNEL_UNVERIFIED", "attestation was verified for another handshake");
    }
    const enclavePk = decodeHex(attestation.enclavePk, "enclavePk", X25519_KEY_LENGTH);
    this.session = new Session(
      deriveSessionKeys("client", this.secretKey, enclavePk, this.nonce, this.publicKey, enclavePk),
    );
  }

  /** Identifier of the established channel (sha256 of the handshake transcript). */
  get channelId(): string {
    return this.requireSession().channelId;
  }

  /** Encrypts a JSON-serializable payload for the enclave. */
  seal(payload: unknown): SealedMessage {
    return this.requireSession().seal(payload);
  }

  /**
   * Decrypts the next message from the enclave, optionally validating it with a zod schema.
   * @throws ChannelError on tampering, replay, reordering or schema mismatch.
   */
  open<T = unknown>(message: unknown, schema?: z.ZodType<T>): T {
    return this.requireSession().open(message, schema);
  }

  private requireSession(): Session {
    if (!this.session) {
      throw new ChannelError("CHANNEL_UNVERIFIED", "channel not established: verify the attestation first");
    }
    return this.session;
  }
}

/** Enclave end of the channel, created from the client's hello and the enclave's X25519 secret key. */
export class EnclaveChannel {
  /** Hex public key to return to the client with the attestation. */
  readonly enclavePk: string;
  /** The 64 bytes to request in the quote's report_data. */
  readonly reportData: Uint8Array;
  private readonly session: Session;

  private constructor(hello: ChannelHello, enclaveSecretKey: Uint8Array) {
    const nonce = decodeHex(hello.nonce, "nonce", CHANNEL_NONCE_LENGTH);
    const clientPk = decodeHex(hello.clientPk, "clientPk", X25519_KEY_LENGTH);
    if (enclaveSecretKey.length !== X25519_KEY_LENGTH) {
      throw new ChannelError("INVALID_INPUT", `enclave secret key must be ${X25519_KEY_LENGTH} bytes`);
    }
    const enclavePk = x25519.getPublicKey(enclaveSecretKey);
    this.enclavePk = toHex(enclavePk);
    this.reportData = channelReportData(nonce, clientPk, enclavePk);
    this.session = new Session(
      deriveSessionKeys("enclave", enclaveSecretKey, clientPk, nonce, clientPk, enclavePk),
    );
  }

  /**
   * Accepts a client hello (validated here, it comes from the network).
   * @throws ChannelError when the hello or the key is malformed.
   */
  static accept(hello: unknown, enclaveSecretKey: Uint8Array): EnclaveChannel {
    const parsed = channelHelloSchema.safeParse(hello);
    if (!parsed.success) {
      throw new ChannelError("INVALID_INPUT", `channel hello is malformed: ${z.prettifyError(parsed.error)}`);
    }
    try {
      return new EnclaveChannel(parsed.data, enclaveSecretKey);
    } catch (error) {
      if (error instanceof ChannelError || !(error instanceof AttestError)) throw error;
      throw new ChannelError(error.code, error.message, { cause: error });
    }
  }

  get channelId(): string {
    return this.session.channelId;
  }

  /** Encrypts a JSON-serializable payload for the client. */
  seal(payload: unknown): SealedMessage {
    return this.session.seal(payload);
  }

  /**
   * Decrypts the next message from the client, optionally validating it with a zod schema.
   * @throws ChannelError on tampering, replay, reordering or schema mismatch.
   */
  open<T = unknown>(message: unknown, schema?: z.ZodType<T>): T {
    return this.session.open(message, schema);
  }
}
