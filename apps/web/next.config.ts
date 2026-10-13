import type { NextConfig } from "next";

/** Hosted showcase build (NEXT_PUBLIC_BADGE_SHOWCASE=1): the landing only, see components/landing/primitives.tsx. */
const SHOWCASE = process.env.NEXT_PUBLIC_BADGE_SHOWCASE === "1";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources (no build step): Next compiles them with the app.
  transpilePackages: ["@badge/attest", "@badge/client", "@badge/consent", "@badge/ledger", "@badge/zk"],
  // The Groth16 prover loads its wasm/zkey artifacts from disk and spawns workers: it must run unbundled.
  // The Ledger DMK is deliberately NOT listed: its ESM build uses directory imports that Node's native ESM loader
  // rejects (ERR_UNSUPPORTED_DIR_IMPORT), so it only works once bundled.
  serverExternalPackages: ["@semaphore-protocol/core", "snarkjs"],
  typedRoutes: true,
  // Do not generate tooling instruction files in the app directory on `next dev`.
  agentRules: false,
  // The jury demo runs on `next dev`: no dev badge over the Ledger panel or in the recordings. Build errors still
  // show in the overlay.
  devIndicators: false,
  poweredByHeader: false,
  // The demo needs the five emulated Ledgers and the enclave, which a hosted showcase does not have: its routes lead
  // back to the landing, whose demo links point to the video.
  async redirects() {
    if (!SHOWCASE) return [];
    return [
      { source: "/demo/:path*", destination: "/", permanent: false },
      { source: "/:employee(alice|bob|chloe)/:path*", destination: "/", permanent: false },
      { source: "/api/:path*", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
