"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowUpRight,
  ArrowRight,
  Bot,
  Check,
  Fingerprint,
  LockKeyhole,
  Pause,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { DEMO_ROUTE } from "./primitives";

const STEPS = ["L’agent demande", "Vous donnez l’accord", "L’extrait est partagé"] as const;

/** An illustrative consent sequence, independent from real signing and enclave state. */
export function Hero() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const activeStep = reducedMotion && !paused ? 2 : step;

  useEffect(() => {
    if (paused || reducedMotion) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let visible = false;
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const sync = () => {
      stop();
      if (visible && !document.hidden) timer = setInterval(() => setStep((value) => (value + 1) % 3), 3600);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      sync();
    });
    if (sceneRef.current) observer.observe(sceneRef.current);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [paused, reducedMotion]);

  return (
    <section id="top" aria-labelledby="hero-title" className="lp-hero">
      <div className="lp-hero-layout">
        <div className="lp-hero-copy">
          <p className="lp-hero-eyebrow">
            <span /> La mémoire confidentielle de vos agents
          </p>
          <h1 id="hero-title">
            Vos agents
            <br />
            savent plus.
            <br />
            <span>
              Vous décidez
              <br />
              quoi.
            </span>
          </h1>
          <p className="lp-hero-description">
            Le savoir de votre entreprise, à portée de vos agents. Votre contexte personnel, partagé
            uniquement avec votre accord.
          </p>
          <div className="lp-hero-actions">
            <Link href={DEMO_ROUTE} className="lp-primary-action">
              Essayer Badge <ArrowUpRight size={19} />
            </Link>
            <a href="#fonctionnement" className="lp-secondary-action">
              Voir le fonctionnement <ArrowDown size={15} />
            </a>
          </div>
          <p className="lp-hero-assurance">
            <Fingerprint size={17} /> Votre accord se signe sur votre Ledger.
          </p>
        </div>

        <div
          ref={sceneRef}
          className="consent-preview"
          data-step={activeStep}
          data-paused={paused || reducedMotion}
        >
          <div className="consent-preview-header">
            <span>UN PARTAGE, PAS TOUTE VOTRE MÉMOIRE.</span>
            <span className="consent-example">Exemple illustratif</span>
          </div>
          <div className="consent-design-heading">
            <div>
              <span>LE POUVOIR DE DIRE OUI.</span>
              <p>La clé, c’est vous.</p>
            </div>
            <div className="consent-design-mark" aria-hidden="true">
              <Fingerprint strokeWidth={1.2} />
            </div>
          </div>
          <div className="consent-scene">
            <div className="consent-request">
              <span className="consent-agent-icon">
                <Bot size={22} />
              </span>
              <div>
                <span className="consent-small-label">L’agent d’Alice</span>
                <p>Prépare mon rendez-vous avec Orion.</p>
              </div>
              <span className="consent-request-dot" />
            </div>
            <div className="consent-connector" aria-hidden="true">
              <span />
              <ArrowDown size={15} />
            </div>
            <div className="consent-card">
              <div className="consent-card-top">
                <span className="consent-owner">B</span>
                <div>
                  <strong>Votre contexte, Bob.</strong>
                  <span>Vous seul autorisez le partage.</span>
                </div>
                <LockKeyhole size={18} />
              </div>
              <div className="consent-card-content">
                <div className="consent-card-heading">
                  <h2>Partager cet extrait ?</h2>
                  <span>01 extrait</span>
                </div>
                <blockquote>
                  « Orion souhaite déployer la solution auprès de son équipe commerciale dès novembre. »
                </blockquote>
                <div className="consent-scope">
                  <span>
                    Avec <strong>Alice</strong>
                  </span>
                  <ArrowRight size={13} />
                  <span>
                    Pour <strong>le brief Orion</strong>
                  </span>
                </div>
              </div>
              <div className="consent-signature">
                <span className="consent-signature-symbol">
                  {activeStep === 2 ? <Check size={20} /> : <Fingerprint size={23} />}
                </span>
                <div>
                  <strong>
                    {activeStep === 0
                      ? "En attente de votre décision"
                      : activeStep === 1
                        ? "Accord signé sur votre Ledger"
                        : "Votre accord est vérifié"}
                  </strong>
                  <span>
                    {activeStep === 0
                      ? "L’agent ne peut pas signer à votre place."
                      : activeStep === 1
                        ? "Vous autorisez cet extrait, pour cette tâche."
                        : "Seul l’extrait autorisé peut être transmis."}
                  </span>
                </div>
              </div>
            </div>
            <div className="consent-connector consent-connector-out" aria-hidden="true">
              <span />
              <ArrowDown size={15} />
            </div>
            <div className="consent-result">
              <ShieldCheck size={21} />
              <div>
                <strong>
                  {activeStep === 2
                    ? "L’extrait rejoint le brief d’Alice."
                    : "Le reste de vos notes reste privé."}
                </strong>
                <span>
                  {activeStep === 2
                    ? "Le reste de vos notes reste privé."
                    : "Aucun partage avant votre accord."}
                </span>
              </div>
              <span className="consent-result-check">
                {activeStep === 2 ? <Check size={17} /> : <LockKeyhole size={15} />}
              </span>
            </div>
          </div>
          <div className="consent-playback">
            <div className="consent-steps" aria-label="Étapes du partage">
              {STEPS.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  aria-pressed={activeStep === index}
                  onClick={() => {
                    setStep(index);
                    setPaused(true);
                  }}
                >
                  <span>0{index + 1}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {!reducedMotion && (
              <button
                type="button"
                className="consent-pause"
                aria-label={paused ? "Relancer l’animation" : "Mettre l’animation en pause"}
                aria-pressed={paused}
                onClick={() => setPaused((value) => !value)}
              >
                {paused ? <Play size={14} /> : <Pause size={14} />}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="lp-hero-foundation">
        <span>La confiance, inscrite dans l’architecture.</span>
        <div>
          <span>Signé sur Ledger</span>
          <span>Exécuté en enclave</span>
          <span>Chaque partage tracé</span>
        </div>
      </div>
    </section>
  );
}
