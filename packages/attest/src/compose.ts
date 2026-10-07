import { sha256 } from "@noble/hashes/sha2";
import { z } from "zod";
import { decodeHex, normalizeHex, toHex, utf8ToBytes } from "./bytes";
import { ComposeError } from "./errors";

const COMPOSE_HASH_LENGTH = 32;

/**
 * Compose hash of an app-compose document: sha256 of the EXACT string the CVM was deployed with.
 *
 * Never re-serialize the document before hashing (and never use the SDK's `getComposeHash`, which sorts keys):
 * any byte of difference yields another hash, and the attested one is computed over the deployed bytes.
 */
export function composeHashOf(appCompose: string): string {
  return toHex(sha256(utf8ToBytes(appCompose)));
}

/**
 * The `enclaveMeasurement` field of Badge EIP-712 messages: the compose hash as a bytes32.
 *
 * The compose hash pins the code and its confidentiality flags; it survives restarts, unlike RTMR3 or the
 * instance id, so a consent signed on the Ledger stays valid for the same deployment.
 * @throws ComposeError when `composeHash` is not 32 bytes of hex.
 */
export function enclaveMeasurementFrom(composeHash: string): `0x${string}` {
  try {
    decodeHex(composeHash, "compose hash", COMPOSE_HASH_LENGTH);
  } catch (error) {
    throw new ComposeError("MALFORMED_COMPOSE", `invalid compose hash: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return `0x${normalizeHex(composeHash)}`;
}

/**
 * Fields of the app-compose document that decide whether data in the enclave can leak through the platform.
 * Unknown fields are kept (passthrough): they are covered by the hash anyway.
 */
const appComposeSchema = z.looseObject({
  manifest_version: z.number().optional(),
  name: z.string().optional(),
  kms_enabled: z.boolean().optional(),
  public_logs: z.boolean().optional(),
  public_sysinfo: z.boolean().optional(),
  local_key_provider_enabled: z.boolean().optional(),
  allowed_envs: z.array(z.string()).optional(),
});

/**
 * Names of deployer-supplied variables that would choose where data goes. Encrypted variables are only the
 * deployer's choice kept out of the hash: an endpoint among them could send employees' context anywhere.
 */
const ENDPOINT_ENV_NAME = /(_URL|_URI|_HOST|_ENDPOINT|_ADDR)$/i;

export type AppCompose = z.infer<typeof appComposeSchema>;

/**
 * Parses the app-compose JSON string.
 * @throws ComposeError("MALFORMED_COMPOSE") when it is not a JSON object.
 */
export function parseAppCompose(appCompose: string): AppCompose {
  let json: unknown;
  try {
    json = JSON.parse(appCompose);
  } catch (error) {
    throw new ComposeError("MALFORMED_COMPOSE", "app-compose is not valid JSON", { cause: error });
  }
  const parsed = appComposeSchema.safeParse(json);
  if (!parsed.success) {
    throw new ComposeError("MALFORMED_COMPOSE", `app-compose is malformed: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * Lists the confidentiality violations of an app-compose document (empty when compliant):
 * - `public_logs` / `public_sysinfo` must be explicitly false: Phala defaults them to true, and container logs
 *   or system info published by the gateway would leak employee context out of the enclave;
 * - `kms_enabled` must be true and `local_key_provider_enabled` false: a local key provider is a dev posture where
 *   keys are not bound to the app's KMS policy;
 * - no `allowed_envs` entry may name an endpoint (`*_URL`, `*_HOST`...): their values are not attested, so every
 *   destination of data must be a literal of the compose or of a pinned image.
 */
export function composePolicyViolations(compose: AppCompose): string[] {
  const violations: string[] = [];
  if (compose.public_logs !== false) violations.push("public_logs must be false");
  if (compose.public_sysinfo !== false) violations.push("public_sysinfo must be false");
  if (compose.kms_enabled !== true) violations.push("kms_enabled must be true");
  if (compose.local_key_provider_enabled === true)
    violations.push("local_key_provider_enabled must be false");
  for (const name of compose.allowed_envs ?? []) {
    if (ENDPOINT_ENV_NAME.test(name))
      violations.push(`allowed_envs must not configure an endpoint (${name})`);
  }
  return violations;
}
