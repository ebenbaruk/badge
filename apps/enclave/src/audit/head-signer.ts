/**
 * Signs the head of the compliance log with a key derived from the dstack KMS: only this deployment can derive it,
 * and it is stable across restarts (and across a rollback of the disk, which is the point). The officer's client
 * keeps the last signed head it saw and refuses a later read that does not extend it (`checkAuditHead`).
 */
import { auditHeadMessage } from "@badge/client";
import { deriveEnclaveKey, ENCLAVE_KEY_PATHS, type DstackAgent } from "@badge/attest/server";
import { bytesToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export class AuditHeadSigner {
  private account: Promise<PrivateKeyAccount> | undefined;

  constructor(
    private readonly dstack: DstackAgent,
    private readonly measurement: Hex,
  ) {}

  /** EIP-191 signature of `auditHeadMessage` for a verified chain of `length` entries ending with `head`. */
  async sign(length: number, head: string): Promise<{ signer: Address; signature: Hex }> {
    this.account ??= deriveEnclaveKey(this.dstack, ENCLAVE_KEY_PATHS.auditHead).then(
      (key) => privateKeyToAccount(bytesToHex(key)),
      (error: unknown) => {
        // A KMS failure is not cached: the next read derives again.
        this.account = undefined;
        throw error;
      },
    );
    const account = await this.account;
    const signature = await account.signMessage({
      message: auditHeadMessage({ measurement: this.measurement, length, head }),
    });
    return { signer: account.address, signature };
  }
}
