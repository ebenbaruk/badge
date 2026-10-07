import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources (no build step): Next compiles them with the app.
  transpilePackages: ["@badge/consent", "@badge/ledger", "@badge/zk", "@badge/attest"],
  // The Groth16 prover loads its wasm/zkey artifacts from disk and spawns workers: it must run unbundled.
  // The Ledger DMK is deliberately NOT listed: its ESM build uses directory imports that Node's native ESM loader
  // rejects (ERR_UNSUPPORTED_DIR_IMPORT), so it only works once bundled.
  serverExternalPackages: ["@semaphore-protocol/core", "snarkjs"],
  typedRoutes: true,
  // Do not generate tooling instruction files in the app directory on `next dev`.
  agentRules: false,
  // Keep the dev badge away from the sidebar footer.
  devIndicators: { position: "bottom-right" },
  poweredByHeader: false,
};

export default nextConfig;
