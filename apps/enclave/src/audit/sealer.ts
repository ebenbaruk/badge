/**
 * Sealing to a public key (X25519 sealed box), used to escrow the identity of an anonymous desk-share signer for the
 * compliance officer only. The implementation lives in @badge/attest (shared with the browser, which opens the box
 * with a key derived from the officer's Ledger); the enclave depends on this interface and receives it by injection.
 */

/** JSON-safe sealed payload (ciphertext and ephemeral key, encoded by the implementation). */
export type SealedBlob = { readonly [field: string]: string | number };

export interface Sealer {
  /** Encrypts `plaintext` so that only the holder of the secret key matching `publicKey` can read it. */
  seal(publicKey: Uint8Array, plaintext: Uint8Array): SealedBlob | Promise<SealedBlob>;
}
