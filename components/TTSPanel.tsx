"use client";

import { useState, useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  VolumeHighIcon,
  PauseIcon,
  PlayIcon,
  Loading03Icon,
  VoiceIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import LatencyBadge from "./LatencyBadge";
import ModelBadge from "./ModelBadge";

interface TTSPanelProps {
  fonText: string;
}

type TTSState = "idle" | "synthesizing" | "ready" | "playing" | "paused" | "error";

export default function TTSPanel({ fonText }: TTSPanelProps) {
  const [state, setState] = useState<TTSState>("idle");
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSimulated, setIsSimulated] = useState(false);
  const [processingMs, setProcessingMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
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
    if (fonText && fonText.trim() !== "") {
      synthesize(fonText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonText]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const synthesize = async (text: string) => {
    try {
      setState("synthesizing");
      setError("");
      setProgress(0);
      setAudioUrl(null);
      setDuration(0);
      setCurrentTime(0);
      setElapsedMs(null);
      setProcessingMs(0);
      startRef.current = performance.now();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (startRef.current !== null) {
          setProcessingMs(performance.now() - startRef.current);
        }
      }, 50);

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text_fon: text }),
      });
      if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("audio/")) {
        // Real audio stream
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        stopTimer();
        setAudioUrl(url);
        setIsSimulated(false);
        setState("ready");
        setTimeout(() => playAudio(url), 300);
      } else {
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        if (data.audio_base64) {
          // Base64 audio
          const binaryStr = atob(data.audio_base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          const blob = new Blob([bytes], { type: data.mime_type || "audio/wav" });
          const url = URL.createObjectURL(blob);
          stopTimer();
          setAudioUrl(url);
          setIsSimulated(false);
          setState("ready");
          setTimeout(() => playAudio(url), 300);
        } else {
          // Placeholder mode
          stopTimer();
          setIsSimulated(true);
          setState("ready");
        }
      }
    } catch (err) {
      stopTimer();
      setError(err instanceof Error ? err.message : "Erreur TTS inconnue.");
      setState("error");
    }
  };

  const ensureAudio = (url: string): HTMLAudioElement => {
    if (audioRef.current && audioRef.current.src === url) return audioRef.current;
    if (audioRef.current) audioRef.current.pause();

    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onloadedmetadata = () => setDuration(audio.duration);
    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration > 0) setProgress((audio.currentTime / audio.duration) * 100);
    };
    audio.onended = () => {
      setState("ready");
      setProgress(100);
      setCurrentTime(audio.duration);
    };
    audio.onerror = () => {
      setError("Erreur lecture audio.");
      setState("error");
    };
    return audio;
  };

  const playAudio = (url?: string) => {
    const src = url || audioUrl;
    if (!src || isSimulated) return;
    const audio = ensureAudio(src);
    // Replay from start if previous playback finished
    if (audio.ended || audio.currentTime >= audio.duration) {
      audio.currentTime = 0;
      setProgress(0);
      setCurrentTime(0);
    }
    audio.play();
    setState("playing");
  };

  const togglePlayPause = () => {
    if (!audioUrl || isSimulated) return;
    if (state === "playing") {
      audioRef.current?.pause();
      setState("paused");
    } else {
      // handles "ready" (initial or after end) and "paused"
      playAudio();
    }
  };

  const applySeek = (clientX: number, rect: DOMRect) => {
    if (!audioRef.current || !duration) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = ratio * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    setProgress(ratio * 100);
  };

  const seekingRef = useRef(false);
  const handleSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    seekingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    applySeek(e.clientX, e.currentTarget.getBoundingClientRect());
  };
  const handleSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekingRef.current) return;
    applySeek(e.clientX, e.currentTarget.getBoundingClientRect());
  };
  const handleSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekingRef.current) return;
    seekingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className={`flex flex-col h-full rounded-2xl border bg-panel transition-all duration-500 overflow-hidden
      ${state === "playing" ? "border-accent-tts/40 panel-tts-active" : "border-border"}
      ${state === "ready" || state === "paused" ? "border-accent-tts/30" : ""}
    `}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-border">
        <div className={`w-2 h-2 rounded-full bg-accent-tts transition-all duration-300
          ${state === "playing" ? "shadow-[0_0_10px_rgba(255,107,107,0.9)] animate-pulse" : "shadow-[0_0_6px_rgba(255,107,107,0.5)]"}`}
        />
        <span className="font-display text-xs font-semibold tracking-[0.15em] uppercase text-text-secondary">
          TTS
        </span>
        <span className="text-text-dim text-xs font-body ml-auto hidden sm:inline">
          Synthèse vocale · Fon
        </span>
        <LatencyBadge
          color="accent-tts"
          state={
            state === "synthesizing"
              ? "live"
              : state === "ready" || state === "playing" || state === "paused"
                ? "done"
                : "idle"
          }
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
          name="facebook/mms-tts-fon"
          url="https://huggingface.co/facebook/mms-tts-fon"
          color="accent-tts"
        />
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 items-center justify-between p-4 sm:p-6 gap-4 sm:gap-6">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full">

          {/* IDLE */}
          {state === "idle" && !fonText && (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 rounded-full bg-accent-tts/10 flex items-center justify-center border border-accent-tts/20">
                <HugeiconsIcon icon={VolumeHighIcon} size={28} className="text-accent-tts" />
              </div>
              <p className="text-xs font-body text-text-secondary max-w-[160px]">
                En attente de la réponse du modèle Général…
              </p>
            </div>
          )}

          {/* SYNTHESIZING */}
          {state === "synthesizing" && (
            <div className="flex flex-col items-center gap-4 animate-fade-in">
              <HugeiconsIcon icon={Loading03Icon} size={36} className="text-accent-tts animate-spin" />
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="thinking-dot bg-accent-tts" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
              <span className="text-xs font-body text-text-secondary">Synthèse audio en cours…</span>
            </div>
          )}

          {/* READY / PLAYING / PAUSED */}
          {(state === "ready" || state === "playing" || state === "paused") && (
            <div className="flex flex-col items-center gap-5 w-full animate-slide-up">
              {/* Text received */}
              {fonText && (
                <div className="relative w-full rounded-xl border border-accent-tts/20 bg-accent-tts/5 p-4">
                  <p className="font-mono text-sm text-text-primary leading-relaxed">{fonText}</p>
                  <span className="absolute top-2 right-2 text-[9px] font-display font-semibold tracking-wider text-accent-tts/60 bg-accent-tts/10 px-2 py-0.5 rounded-full">
                    FON
                  </span>
                </div>
              )}

              {/* Speaker visual */}
              {!isSimulated ? (
                <div className="flex flex-col items-center gap-4 w-full">
                  <div className={`w-20 h-20 rounded-full border-2 flex items-center justify-center transition-all duration-300
                    ${state === "playing" ? "border-accent-tts bg-accent-tts/15 speaker-playing" : "border-accent-tts/30 bg-accent-tts/5"}`}
                  >
                    <HugeiconsIcon
                      icon={VoiceIcon}
                      size={36}
                      className={state === "playing" ? "text-accent-tts" : "text-accent-tts/50"}
                    />
                  </div>

                  {/* Waveform while playing */}
                  {state === "playing" && (
                    <div className="flex items-center gap-1 h-8">
                      {[...Array(9)].map((_, i) => (
                        <div
                          key={i}
                          className="wave-bar bg-accent-tts rounded-full"
                          style={{ animationDelay: `${i * 0.12}s` }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Progress bar (clickable + draggable seek) */}
                  {duration > 0 && (
                    <div className="w-full flex flex-col gap-1.5">
                      <div
                        role="slider"
                        aria-label="Progression audio"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progress)}
                        tabIndex={0}
                        onPointerDown={handleSeekPointerDown}
                        onPointerMove={handleSeekPointerMove}
                        onPointerUp={handleSeekPointerUp}
                        onPointerCancel={handleSeekPointerUp}
                        className="group w-full py-2 -my-2 cursor-pointer touch-none select-none"
                      >
                        <div className="relative w-full h-1.5 bg-muted rounded-full overflow-visible">
                          <div
                            className="absolute inset-y-0 left-0 bg-accent-tts rounded-full transition-[width] duration-75"
                            style={{ width: `${progress}%` }}
                          />
                          <div
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-accent-tts shadow-[0_0_0_3px_rgba(255,107,107,0.25)] opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ left: `${progress}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-text-dim tabular-nums">
                        <span>{fmt(currentTime)}</span>
                        <span>{fmt(duration)}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Placeholder / dev mode */
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-14 h-14 rounded-full bg-accent-tts/10 flex items-center justify-center border border-dashed border-accent-tts/30">
                    <HugeiconsIcon icon={VolumeHighIcon} size={24} className="text-accent-tts/50" />
                  </div>
                  <div className="rounded-xl border border-accent-tts/20 bg-accent-tts/5 px-4 py-3">
                    <p className="text-xs font-display font-semibold text-accent-tts/80">⚙ Mode développement</p>
                    <p className="text-[10px] font-body text-text-dim mt-1">
                      Connecte ton modèle TTS pour l&apos;audio réel
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ERROR */}
          {state === "error" && (
            <div className="flex flex-col items-center gap-3 animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/30">
                <HugeiconsIcon icon={VolumeHighIcon} size={24} className="text-red-400" />
              </div>
              <p className="text-xs font-body text-red-400 text-center max-w-[180px]">{error}</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 w-full">
          {!isSimulated && audioUrl && (state === "ready" || state === "playing" || state === "paused") && (
            <button
              onClick={togglePlayPause}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-display font-semibold text-sm tracking-wide transition-all duration-200 active:scale-95
                ${state === "playing"
                  ? "bg-accent-tts/20 border border-accent-tts/40 text-accent-tts hover:bg-accent-tts/30"
                  : "bg-accent-tts text-night hover:bg-accent-tts/90"
                }`}
            >
              <HugeiconsIcon icon={state === "playing" ? PauseIcon : PlayIcon} size={16} />
              {state === "playing"
                ? "Pause"
                : state === "paused"
                  ? "Reprendre"
                  : currentTime > 0 && currentTime >= duration && duration > 0
                    ? "Rejouer"
                    : "Écouter"}
            </button>
          )}

          {(state === "ready" || state === "paused" || state === "error") && fonText && (
            <button
              onClick={() => synthesize(fonText)}
              className="p-3 rounded-xl border border-border hover:border-accent-tts/30 hover:bg-accent-tts/5 transition-all duration-200 active:scale-95"
              title="Resynthétiser"
            >
              <HugeiconsIcon icon={Refresh01Icon} size={16} className="text-text-secondary" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
