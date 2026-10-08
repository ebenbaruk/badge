import { Fingerprint, Layers3, ShieldCheck } from "lucide-react";

export function WorkspaceIntro({ firstName }: { firstName: string }) {
  return (
    <section className="workspace-intro" aria-labelledby="workspace-welcome">
      <div className="workspace-intro-copy">
        <p className="mono-label">Votre espace de travail confidentiel</p>
        <h2 id="workspace-welcome">
          Bonjour {firstName}.<br />
          <span>
            Une longueur d’avance,
            <br className="sm:hidden" /> en toute confiance.
          </span>
        </h2>
        <p>Les bonnes informations. Au bon moment. Avec le bon accord.</p>
        <div className="workspace-principles">
          <span>
            <Layers3 /> Mémoire partagée
          </span>
          <span>
            <Fingerprint /> Accord signé
          </span>
          <span>
            <ShieldCheck /> Enclave confidentielle
          </span>
        </div>
      </div>
      <div className="workspace-emblem" aria-hidden="true">
        <Fingerprint strokeWidth={1} />
      </div>
    </section>
  );
}
