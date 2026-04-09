"use client";

import { useState, useEffect, useRef } from "react";
import LatencyBadge from "./LatencyBadge";
import ModelBadge from "./ModelBadge";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BrainIcon,
  ArrowRight02Icon,
  Copy01Icon,
  CheckmarkCircle02Icon,
  LanguageCircleIcon,
  MessageTranslateIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";

interface GeneralPanelProps {
  transcription: string;
  onResponse: (fonText: string) => void;
}

interface GeneralResult {
  comprehension_fr: string;
  reponse_fr: string;
  reponse_fon: string;
}

type GeneralState = "idle" | "processing" | "done" | "error";

export default function GeneralPanel({ transcription, onResponse }: GeneralPanelProps) {
  const [state, setState] = useState<GeneralState>("idle");
  const [result, setResult] = useState<GeneralResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"fr" | "comp" | "fon" | null>(null);
  const [processingMs, setProcessingMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (startRef.current !== null) {
      setElapsedMs(performance.now() - startRef.current);
      startRef.current = null;
    }
  };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (transcription && transcription.trim() !== "") {
      callGeneralModel(transcription);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcription]);

  const callGeneralModel = async (text: string) => {
    try {
      setState("processing");
      setResult(null);
      setError("");
      setElapsedMs(null);
      setProcessingMs(0);
      startRef.current = performance.now();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (startRef.current !== null) {
          setProcessingMs(performance.now() - startRef.current);
        }
      }, 50);

      const response = await fetch("/api/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcription_fon: text }),
      });
      if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
      const data: GeneralResult & { error?: string } = await response.json();
      if (data.error) throw new Error(data.error);

      stopTimer();
      setResult(data);
      setState("done");
      onResponse(data.reponse_fon);
    } catch (err) {
      stopTimer();
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
      setState("error");
    }
  };

  const copy = (key: "fr" | "comp" | "fon", text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className={`flex flex-col h-full rounded-2xl border bg-panel transition-all duration-500 overflow-hidden
      ${state === "processing" ? "border-accent-gen/40 panel-gen-active" : "border-border"}
      ${state === "done" ? "border-accent-gen/30" : ""}
    `}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-border">
        <div className={`w-2 h-2 rounded-full bg-accent-gen transition-all duration-300
          ${state === "processing" ? "shadow-[0_0_10px_rgba(123,111,240,0.9)] animate-pulse" : "shadow-[0_0_6px_rgba(123,111,240,0.5)]"}`}
        />
        <span className="font-display text-xs font-semibold tracking-[0.15em] uppercase text-text-secondary">
          Général
        </span>
        <span className="text-text-dim text-xs font-body ml-auto hidden sm:inline">
          Compréhension & Réponse
        </span>
        <LatencyBadge
          color="accent-gen"
          state={state === "processing" ? "live" : state === "done" ? "done" : "idle"}
          liveMs={processingMs}
          finalMs={elapsedMs}
        />
      </div>

      {/* Model info */}
      <div className="flex items-center gap-2 px-4 sm:px-5 py-2 border-b border-border/60 bg-surface/30">
        <span className="text-[9px] font-display font-semibold tracking-widest uppercase text-text-dim shrink-0">
          Modèle
        </span>
        <ModelBadge
          name="Google Gemini 3 Flash"
          url="https://ai.google.dev/gemini-api/docs/models"
          color="accent-gen"
        />
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-4 sm:p-6 gap-4 overflow-y-auto">

        {/* Input preview */}
        {transcription && (
          <div className="rounded-xl border border-border bg-surface p-3 animate-fade-in shrink-0">
            <div className="text-[10px] font-body text-text-dim uppercase tracking-widest mb-1.5">
              ↙ Reçu de ASR
            </div>
            <p className="font-mono text-xs text-text-secondary line-clamp-2">{transcription}</p>
          </div>
        )}

        {/* IDLE */}
        {state === "idle" && !transcription && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-8">
            <div className="w-16 h-16 rounded-full bg-accent-gen/10 flex items-center justify-center border border-accent-gen/20">
              <HugeiconsIcon icon={BrainIcon} size={28} className="text-accent-gen" />
            </div>
            <p className="text-xs font-body text-text-secondary max-w-[160px]">
              En attente de la transcription ASR…
            </p>
          </div>
        )}

        {/* PROCESSING */}
        {state === "processing" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 animate-fade-in py-8">
            <HugeiconsIcon icon={Loading03Icon} size={36} className="text-accent-gen animate-spin" />
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="thinking-dot bg-accent-gen" style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
            </div>
            <div className="text-xs font-body text-text-secondary text-center space-y-1">
              <p>Compréhension du Fon…</p>
              <p className="text-text-dim">Génération de la réponse…</p>
            </div>
          </div>
        )}

        {/* ERROR */}
        {state === "error" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 animate-fade-in py-8">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/30">
              <HugeiconsIcon icon={BrainIcon} size={24} className="text-red-400" />
            </div>
            <p className="text-xs font-body text-red-400 text-center max-w-[200px]">{error}</p>
          </div>
        )}

        {/* DONE */}
        {state === "done" && result && (
          <div className="flex flex-col gap-3 animate-slide-up">

            {/* Compréhension FR */}
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={LanguageCircleIcon} size={13} className="text-accent-gen" />
                  <span className="text-[10px] font-display font-semibold uppercase tracking-widest text-accent-gen">
                    Compréhension
                  </span>
                </div>
                <button onClick={() => copy("comp", result.comprehension_fr)} className="p-1 rounded hover:bg-muted transition-colors">
                  <HugeiconsIcon
                    icon={copied === "comp" ? CheckmarkCircle02Icon : Copy01Icon}
                    size={12}
                    className={copied === "comp" ? "text-accent-gen" : "text-text-dim"}
                  />
                </button>
              </div>
              <p className="text-xs font-body text-text-secondary leading-relaxed">{result.comprehension_fr}</p>
            </div>

            {/* Réponse FR */}
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={MessageTranslateIcon} size={13} className="text-blue-400" />
                  <span className="text-[10px] font-display font-semibold uppercase tracking-widest text-blue-400">
                    Réponse · Français
                  </span>
                </div>
                <button onClick={() => copy("fr", result.reponse_fr)} className="p-1 rounded hover:bg-muted transition-colors">
                  <HugeiconsIcon
                    icon={copied === "fr" ? CheckmarkCircle02Icon : Copy01Icon}
                    size={12}
                    className={copied === "fr" ? "text-blue-400" : "text-text-dim"}
                  />
                </button>
              </div>
              <p className="text-xs font-body text-text-secondary leading-relaxed">{result.reponse_fr}</p>
            </div>

            {/* Réponse FON */}
            <div className="relative rounded-xl border border-accent-gen/30 bg-accent-gen/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={MessageTranslateIcon} size={13} className="text-accent-gen" />
                  <span className="text-[10px] font-display font-semibold uppercase tracking-widest text-accent-gen">
                    Réponse · Fon
                  </span>
                </div>
                <button onClick={() => copy("fon", result.reponse_fon)} className="p-1 rounded hover:bg-muted transition-colors">
                  <HugeiconsIcon
                    icon={copied === "fon" ? CheckmarkCircle02Icon : Copy01Icon}
                    size={12}
                    className={copied === "fon" ? "text-accent-gen" : "text-text-dim"}
                  />
                </button>
              </div>
              <p className="font-mono text-sm text-text-primary leading-relaxed">{result.reponse_fon}</p>
              <span className="absolute top-2 right-8 text-[9px] font-display font-semibold tracking-wider text-accent-gen/60 bg-accent-gen/10 px-2 py-0.5 rounded-full">
                FON
              </span>
            </div>

            {/* Forward indicator */}
            <div className="flex items-center gap-2 text-xs text-accent-gen/60 font-body">
              <HugeiconsIcon icon={ArrowRight02Icon} size={12} />
              <span>Réponse Fon envoyée au TTS</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
