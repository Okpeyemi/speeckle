"use client";

interface LatencyBadgeProps {
  color: "accent-asr" | "accent-gen" | "accent-tts";
  state: "idle" | "live" | "done";
  liveMs?: number;
  finalMs?: number | null;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(2)} s`;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem}s`;
}

export default function LatencyBadge({ color, state, liveMs = 0, finalMs }: LatencyBadgeProps) {
  if (state === "idle") return null;

  const isLive = state === "live";
  const ms = isLive ? liveMs : finalMs ?? 0;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums border transition-colors
        ${isLive
          ? `text-${color} border-${color}/30 bg-${color}/10`
          : `text-${color}/80 border-${color}/20 bg-${color}/5`
        }`}
      title={isLive ? "Temps écoulé" : "Temps de traitement"}
    >
      {isLive && (
        <span className={`w-1 h-1 rounded-full bg-${color} animate-pulse`} />
      )}
      {!isLive && <span>⏱</span>}
      <span>{formatMs(ms)}</span>
    </span>
  );
}
