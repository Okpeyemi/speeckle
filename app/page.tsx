"use client";

import { useState, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Settings02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import ASRPanel from "@/components/ASRPanel";
import GeneralPanel from "@/components/GeneralPanel";
import TTSPanel from "@/components/TTSPanel";

type Tab = "asr" | "gen" | "tts";

export default function Home() {
  const [asrTranscription, setAsrTranscription] = useState("");
  const [fonResponse, setFonResponse] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("asr");

  // Auto-avance des onglets en mobile quand le pipeline progresse
  useEffect(() => {
    if (asrTranscription) setActiveTab("gen");
  }, [asrTranscription]);
  useEffect(() => {
    if (fonResponse) setActiveTab("tts");
  }, [fonResponse]);

  return (
    <div className="min-h-screen bg-night flex flex-col">

      {/* ── Header ── */}
      <header className="border-b border-border bg-surface/60 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">

          {/* Logo */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="relative w-8 h-8 shrink-0">
              <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="8" fill="#12161F" />
                <path
                  d="M5 16 Q7.5 9 10 16 Q12.5 23 15 16 Q17.5 9 20 16 Q22.5 23 27 16"
                  stroke="url(#logo-grad)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  fill="none"
                />
                <defs>
                  <linearGradient id="logo-grad" x1="5" y1="16" x2="27" y2="16" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#00D4AA" />
                    <stop offset="0.5" stopColor="#7B6FF0" />
                    <stop offset="1" stopColor="#FF6B6B" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <span className="font-display font-bold text-base sm:text-lg text-text-primary tracking-tight truncate">
              Speeckle
            </span>
            <span className="hidden sm:block text-[10px] font-body text-text-dim bg-muted px-2 py-0.5 rounded-full tracking-widest uppercase shrink-0">
              Fon AI
            </span>
          </div>

          {/* Pipeline badge */}
          <div className="hidden lg:flex items-center gap-2 bg-surface border border-border rounded-full px-4 py-1.5">
            <span className="text-xs font-display font-semibold text-accent-asr">ASR</span>
            <HugeiconsIcon icon={ArrowRight01Icon} size={11} className="text-text-dim" />
            <span className="text-xs font-display font-semibold text-accent-gen">Général</span>
            <HugeiconsIcon icon={ArrowRight01Icon} size={11} className="text-text-dim" />
            <span className="text-xs font-display font-semibold text-accent-tts">TTS</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button className="p-2 rounded-lg hover:bg-muted transition-colors text-text-secondary hover:text-text-primary">
              <HugeiconsIcon icon={InformationCircleIcon} size={18} />
            </button>
            <button className="p-2 rounded-lg hover:bg-muted transition-colors text-text-secondary hover:text-text-primary">
              <HugeiconsIcon icon={Settings02Icon} size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col max-w-screen-2xl mx-auto w-full px-3 sm:px-6 py-4 sm:py-6 gap-4 sm:gap-5">

        {/* Subtitle bar */}
        <div className="flex items-center gap-3">
          <p className="text-xs sm:text-sm font-body text-text-secondary min-w-0">
            <span className="hidden sm:inline">Pipeline de traitement de la parole Fon — </span>
            <span className="sm:hidden">Pipeline Fon — </span>
            <span className="text-text-primary">Parle, comprends, réponds</span>
          </p>
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-mono text-text-dim shrink-0">
            {asrTranscription ? "● Actif" : "○ En attente"}
          </span>
        </div>

        {/* ── Mobile tabs (< lg) ── */}
        <div className="lg:hidden flex items-center gap-1 p-1 rounded-xl border border-border bg-surface/40">
          <TabButton
            label="ASR"
            step={1}
            color="accent-asr"
            active={activeTab === "asr"}
            done={!!asrTranscription}
            onClick={() => setActiveTab("asr")}
          />
          <TabButton
            label="Général"
            step={2}
            color="accent-gen"
            active={activeTab === "gen"}
            done={!!fonResponse}
            disabled={!asrTranscription}
            onClick={() => setActiveTab("gen")}
          />
          <TabButton
            label="TTS"
            step={3}
            color="accent-tts"
            active={activeTab === "tts"}
            done={false}
            disabled={!fonResponse}
            onClick={() => setActiveTab("tts")}
          />
        </div>

        {/* ── 3-Panel Grid (tabs en mobile, 3 colonnes en lg) ── */}
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-3 flex-1 lg:min-h-[calc(100vh-220px)]">

          {/* Panel 1 : ASR */}
          <div className={`flex-1 min-w-0 flex-col gap-3 min-h-[520px] lg:min-h-0 lg:flex ${activeTab === "asr" ? "flex" : "hidden"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-5 h-5 rounded-md bg-accent-asr/15 flex items-center justify-center shrink-0">
                <span className="text-[8px] font-display font-bold text-accent-asr">1</span>
              </div>
              <span className="text-xs font-display font-semibold text-accent-asr tracking-wider uppercase">ASR</span>
              <span className="text-[10px] font-body text-text-dim hidden sm:inline">Automatic Speech Recognition</span>
            </div>
            <div className="flex-1">
              <ASRPanel onTranscription={(text) => setAsrTranscription(text)} />
            </div>
          </div>

          {/* Connector ASR → Général */}
          <Connector active={!!asrTranscription} fromColor="accent-asr" toColor="accent-gen" />

          {/* Panel 2 : Général */}
          <div className={`flex-1 min-w-0 flex-col gap-3 min-h-[520px] lg:min-h-0 lg:flex ${activeTab === "gen" ? "flex" : "hidden"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-5 h-5 rounded-md bg-accent-gen/15 flex items-center justify-center shrink-0">
                <span className="text-[8px] font-display font-bold text-accent-gen">2</span>
              </div>
              <span className="text-xs font-display font-semibold text-accent-gen tracking-wider uppercase">Général</span>
              <span className="text-[10px] font-body text-text-dim hidden sm:inline">Compréhension & Génération</span>
            </div>
            <div className="flex-1">
              <GeneralPanel
                transcription={asrTranscription}
                onResponse={(text) => setFonResponse(text)}
              />
            </div>
          </div>

          {/* Connector Général → TTS */}
          <Connector active={!!fonResponse} fromColor="accent-gen" toColor="accent-tts" />

          {/* Panel 3 : TTS */}
          <div className={`flex-1 min-w-0 flex-col gap-3 min-h-[520px] lg:min-h-0 lg:flex ${activeTab === "tts" ? "flex" : "hidden"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-5 h-5 rounded-md bg-accent-tts/15 flex items-center justify-center shrink-0">
                <span className="text-[8px] font-display font-bold text-accent-tts">3</span>
              </div>
              <span className="text-xs font-display font-semibold text-accent-tts tracking-wider uppercase">TTS</span>
              <span className="text-[10px] font-body text-text-dim hidden sm:inline">Text-to-Speech</span>
            </div>
            <div className="flex-1">
              <TTSPanel fonText={fonResponse} />
            </div>
          </div>
        </div>

        {/* ── Status bar ── */}
        <div className="flex items-center gap-4 py-2.5 px-4 rounded-xl border border-border bg-surface/40 text-[10px] font-mono flex-wrap">
          <StatusDot active={!!asrTranscription} color="accent-asr" label="ASR"
            value={asrTranscription ? `"${asrTranscription.slice(0, 22)}${asrTranscription.length > 22 ? "…" : ""}"` : "—"}
          />
          <div className="h-3 w-px bg-border" />
          <StatusDot active={!!fonResponse} color="accent-gen" label="GEN"
            value={fonResponse ? "Réponse générée" : "—"}
          />
          <div className="h-3 w-px bg-border" />
          <StatusDot active={!!fonResponse} color="accent-tts" label="TTS"
            value={fonResponse ? "Synthèse audio…" : "—"}
          />
          <div className="ml-auto text-text-dim">speeckle · langue fon · v0.1</div>
        </div>
      </main>
    </div>
  );
}

/* ── Sub-components ── */

function Connector({ active, fromColor, toColor }: {
  active: boolean;
  fromColor: string;
  toColor: string;
}) {
  return (
    <div className="hidden lg:flex flex-col items-center justify-center shrink-0 w-7 pt-8 gap-1">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`w-px rounded-full transition-all duration-500 ${active ? `bg-${fromColor}` : "bg-border"}`}
          style={{ height: "12px", opacity: active ? 0.4 + i * 0.18 : 0.5, transitionDelay: `${i * 60}ms` }}
        />
      ))}
      <div className={`transition-all duration-500 ${active ? `text-${fromColor}` : "text-border"}`}
        style={{ transform: "rotate(90deg)", margin: "1px 0" }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 3 L5 7 L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`w-px rounded-full transition-all duration-500 ${active ? `bg-${toColor}` : "bg-border"}`}
          style={{ height: "12px", opacity: active ? 0.6 + i * 0.15 : 0.3, transitionDelay: `${(i + 4) * 60}ms` }}
        />
      ))}
    </div>
  );
}

function TabButton({ label, step, color, active, done, disabled, onClick }: {
  label: string;
  step: number;
  color: string;
  active: boolean;
  done: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg font-display text-xs font-semibold tracking-wider uppercase transition-all duration-200
        ${active
          ? `bg-${color}/15 text-${color} border border-${color}/30`
          : disabled
            ? "text-text-dim/50 cursor-not-allowed"
            : `text-text-secondary hover:text-${color} hover:bg-${color}/5 border border-transparent`
        }`}
    >
      <span className={`w-4 h-4 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0
        ${active ? `bg-${color}/25` : "bg-muted"}`}
      >
        {step}
      </span>
      <span className="truncate">{label}</span>
      {done && (
        <span className={`w-1.5 h-1.5 rounded-full bg-${color} shrink-0`} />
      )}
    </button>
  );
}

function StatusDot({ active, color, label, value }: {
  active: boolean;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${active ? `bg-${color}` : "bg-text-dim"}`} />
      <span className="text-text-dim">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  );
}
