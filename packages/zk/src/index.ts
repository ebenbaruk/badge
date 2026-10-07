export type { Group, Identity } from "@semaphore-protocol/core";
export { DESK_TREE_DEPTH, type DeskArtifacts, resolveDeskArtifacts, ZK_ARTIFACTS_DIR_ENV } from "./artifacts";
export { ZK_ERROR_CODES, ZkError, type ZkErrorCode } from "./errors";
export { buildDeskGroup, deskGroupRoot, SNARK_SCALAR_FIELD } from "./group";
export { deriveDeskIdentity } from "./identity";
export { InMemoryNullifierRegistry, type NullifierRegistry } from "./nullifiers";
export {
  createDeskProof,
  type CreateDeskProofInput,
  type DeskProofExpectations,
  verifyDeskProof,
  type VerifiedDeskProof,
} from "./proof";
export {
  decodeDeskProof,
  type DeskProof,
  type DeskProofWire,
  deskProofSchema,
  encodeDeskProof,
} from "./wire";
