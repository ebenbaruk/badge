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

const STEPS = ["The agent asks", "You consent", "The excerpt is shared"] as const;

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
            <span /> Confidential memory for your agents
          </p>
          <h1 id="hero-title">
            Your agents
            <br />
            know more.
            <br />
            <span>
              You decide
              <br />
              what.
            </span>
          </h1>
          <p className="lp-hero-description">
            The right context for every task: your company&apos;s knowledge, always within reach. Your
            personal context, shared only with your consent.
          </p>
          <div className="lp-hero-actions">
            <Link href={DEMO_ROUTE} className="lp-primary-action">
              Try Badge <ArrowUpRight size={19} />
            </Link>
            <a href="#how-it-works" className="lp-secondary-action">
              See how it works <ArrowDown size={15} />
            </a>
          </div>
          <p className="lp-hero-assurance">
            <Fingerprint size={17} /> You sign your consent on your Ledger.
          </p>
        </div>

        <div
          ref={sceneRef}
          className="consent-preview"
          data-step={activeStep}
          data-paused={paused || reducedMotion}
        >
          <div className="consent-preview-header">
            <span>ONE EXCERPT, NOT YOUR WHOLE MEMORY.</span>
            <span className="consent-example">Illustrative example</span>
          </div>
          <div className="consent-design-heading">
            <div>
              <span>THE POWER TO SAY YES.</span>
              <p>You hold the key.</p>
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
                <span className="consent-small-label">Alice’s agent</span>
                <p>Prepare my meeting with Orion.</p>
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
                  <strong>Your context, Bob.</strong>
                  <span>Only you can authorize sharing.</span>
                </div>
                <LockKeyhole size={18} />
              </div>
              <div className="consent-card-content">
                <div className="consent-card-heading">
                  <h2>Share this excerpt?</h2>
                  <span>01 excerpt</span>
                </div>
                <blockquote>
                  “Orion wants to roll the solution out to its sales team as early as November.”
                </blockquote>
                <div className="consent-scope">
                  <span>
                    With <strong>Alice</strong>
                  </span>
                  <ArrowRight size={13} />
                  <span>
                    For <strong>the Orion brief</strong>
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
                      ? "Waiting for your decision"
                      : activeStep === 1
                        ? "Consent signed on your Ledger"
                        : "Your consent is verified"}
                  </strong>
                  <span>
                    {activeStep === 0
                      ? "The agent can’t sign on your behalf."
                      : activeStep === 1
                        ? "You authorize this excerpt, for this task."
                        : "Only the authorized excerpt can be released."}
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
                    ? "The excerpt joins Alice’s brief."
                    : "The rest of your notes stays private."}
                </strong>
                <span>
                  {activeStep === 2
                    ? "The rest of your notes stays private."
                    : "Nothing is shared before you consent."}
                </span>
              </div>
              <span className="consent-result-check">
                {activeStep === 2 ? <Check size={17} /> : <LockKeyhole size={15} />}
              </span>
            </div>
          </div>
          <div className="consent-playback">
            <div className="consent-steps" aria-label="Sharing steps">
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
                aria-label={paused ? "Resume the animation" : "Pause the animation"}
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
        <span>Trust, built into the architecture.</span>
        <div>
          <span>Signed on Ledger</span>
          <span>Run in an enclave</span>
          <span>Every share logged</span>
        </div>
      </div>
    </section>
  );
}
