import { Fingerprint, Layers3, ShieldCheck } from "lucide-react";

export function WorkspaceIntro({ firstName }: { firstName: string }) {
  return (
    <section className="workspace-intro" aria-labelledby="workspace-welcome">
      <div className="workspace-intro-copy">
        <p className="mono-label">Your confidential workspace</p>
        <h2 id="workspace-welcome">
          Hello {firstName}.<br />
          <span>
            One step ahead,
            <br className="sm:hidden" /> with full trust.
          </span>
        </h2>
        <p>The right context. At the right time. With the right consent.</p>
        <div className="workspace-principles">
          <span>
            <Layers3 /> Shared memory
          </span>
          <span>
            <Fingerprint /> Signed consent
          </span>
          <span>
            <ShieldCheck /> Confidential enclave
          </span>
        </div>
      </div>
      <div className="workspace-emblem" aria-hidden="true">
        <Fingerprint strokeWidth={1} />
      </div>
    </section>
  );
}
