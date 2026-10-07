import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ZkError } from "./errors";

/**
 * Every desk proof uses this Merkle tree depth (2^16 = 65,536 members per desk), whatever the actual group size.
 * Why fixed: Semaphore otherwise infers the depth from the group, which (1) leaks the desk size to the verifier and
 * (2) mismatches the depth-16 artifacts, failing with "Not enough values for input signal merkleProofSiblings".
 */
export const DESK_TREE_DEPTH = 16;

/** Overrides the directory holding `semaphore-16.wasm` and `semaphore-16.zkey` (required in the enclave image). */
export const ZK_ARTIFACTS_DIR_ENV = "BADGE_ZK_ARTIFACTS_DIR";

const WORKSPACE_MARKER = "pnpm-workspace.yaml";
const DEFAULT_ARTIFACTS_SUBDIR = join("infra", "zk-artifacts");
const ARTIFACT_BASENAME = `semaphore-${DESK_TREE_DEPTH}`;

/** Local paths of the Groth16 proving artifacts for {@link DESK_TREE_DEPTH}. */
export interface DeskArtifacts {
  wasm: string;
  zkey: string;
}

/** Walks up from `start` to the monorepo root, identified by its pnpm workspace file. */
function findWorkspaceRoot(start: string): string | undefined {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, WORKSPACE_MARKER))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Resolves the proving artifacts, in this order: `dir` argument, `BADGE_ZK_ARTIFACTS_DIR`, then
 * `<repo root>/infra/zk-artifacts` found from the working directory.
 *
 * Resolution is lazy (called at proof time, never at import) so the package can be imported from Next.js server
 * code or a bundled enclave where neither `import.meta.url` nor the repo layout is reliable. The files must exist:
 * without them Semaphore would silently download artifacts from the network, which the enclave must never do.
 *
 * @throws {ZkError} `ARTIFACTS_MISSING` when no directory can be resolved or a file is absent.
 */
export function resolveDeskArtifacts(dir?: string): DeskArtifacts {
  const baseDir = dir ?? process.env[ZK_ARTIFACTS_DIR_ENV] ?? defaultArtifactsDir();
  if (baseDir === undefined) {
    throw new ZkError(
      "ARTIFACTS_MISSING",
      `no artifacts directory: set ${ZK_ARTIFACTS_DIR_ENV} or run from inside the Badge repository`,
    );
  }
  const artifacts: DeskArtifacts = {
    wasm: resolve(baseDir, `${ARTIFACT_BASENAME}.wasm`),
    zkey: resolve(baseDir, `${ARTIFACT_BASENAME}.zkey`),
  };
  for (const path of Object.values(artifacts)) {
    if (!existsSync(path)) {
      throw new ZkError(
        "ARTIFACTS_MISSING",
        `${path} not found (run infra/setup.sh or set ${ZK_ARTIFACTS_DIR_ENV})`,
      );
    }
  }
  return artifacts;
}

function defaultArtifactsDir(): string | undefined {
  const root = findWorkspaceRoot(process.cwd());
  return root === undefined ? undefined : join(root, DEFAULT_ARTIFACTS_SUBDIR);
}
