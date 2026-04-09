"use client";

interface ModelBadgeProps {
  name: string;
  url: string;
  color: "accent-asr" | "accent-gen" | "accent-tts";
}

export default function ModelBadge({ name, url, color }: ModelBadgeProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-${color}/20 bg-${color}/5 text-[10px] font-mono text-${color}/80 hover:bg-${color}/10 hover:text-${color} hover:border-${color}/40 transition-colors max-w-full`}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 opacity-70"
      >
        <path d="M12 2 L2 7 L12 12 L22 7 L12 2 Z" />
        <path d="M2 17 L12 22 L22 17" />
        <path d="M2 12 L12 17 L22 12" />
      </svg>
      <span className="truncate">{name}</span>
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 opacity-60"
      >
        <path d="M7 17 L17 7" />
        <path d="M7 7 L17 7 L17 17" />
      </svg>
    </a>
  );
}
