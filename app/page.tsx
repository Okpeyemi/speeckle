"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CloudUploadIcon,
  FileMusicIcon,
  SplitIcon,
  Loading02Icon,
  CheckmarkCircle01Icon,
  Alert01Icon,
  Cancel01Icon,
  AudioWave01Icon,
  PlayIcon,
  PauseIcon,
  NextIcon,
  Backward01Icon,
  ReplayIcon,
  LanguageCircleIcon,
  TextIcon,
  FileAttachmentIcon,
  ArrowDataTransferHorizontalIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

// ─── Waveform Player ──────────────────────────────────────────────────────────

const BAR_COUNT = 90;

async function buildWaveform(url: string): Promise<number[]> {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx() as AudioContext;
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();

  const data = buffer.getChannelData(0);
  const blockSize = Math.floor(data.length / BAR_COUNT);
  const bars: number[] = [];

  for (let i = 0; i < BAR_COUNT; i++) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(data[i * blockSize + j]);
    }
    bars.push(sum / blockSize);
  }

  const peak = Math.max(...bars, 0.001);
  return bars.map((v) => v / peak);
}

// Loading skeleton heights — deterministic (no hydration mismatch)
const SKELETON_HEIGHTS = Array.from(
  { length: BAR_COUNT },
  (_, i) => 20 + Math.sin(i * 0.4) * 15 + Math.sin(i * 0.15) * 25
);

function WaveformPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBars([]);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);

    buildWaveform(src)
      .then((data) => { if (!cancelled) { setBars(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [src]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) a.pause();
    else a.play().catch(() => {});
  }, [isPlaying]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    const el = containerRef.current;
    if (!a || !el || !a.duration) return;
    const { left, width } = el.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - left) / width)) * a.duration;
  }, []);

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Waveform bars */}
      <div
        ref={containerRef}
        onClick={seek}
        className="relative flex items-center gap-px h-16 cursor-pointer select-none"
      >
        {loading
          ? SKELETON_HEIGHTS.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-full bg-primary/15 animate-pulse"
                style={{ height: `${h}%` }}
              />
            ))
          : bars.map((amp, i) => (
              <div
                key={i}
                className={cn(
                  "flex-1 rounded-full transition-colors duration-75",
                  i / BAR_COUNT <= progress ? "bg-primary" : "bg-primary/20"
                )}
                style={{ height: `${Math.max(2, amp * 100)}%` }}
              />
            ))}

        {/* Playhead */}
        {!loading && duration > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-primary/80 rounded-full"
            style={{ left: `${progress * 100}%` }}
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={togglePlay}
          disabled={loading}
          className="text-primary hover:text-primary/80"
        >
          <HugeiconsIcon icon={isPlaying ? PauseIcon : PlayIcon} size={18} />
        </Button>
        <div className="flex-1" />
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {formatTime(currentTime)}&nbsp;/&nbsp;{formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SegmentResult {
  id: string;
  index: number;
  fileName: string;
  startTime: number;
  endTime: number;
  duration: number;
}

interface ProcessResult {
  totalDuration: number;
  segmentCount: number;
  silencesDetected: number;
  outputDir: string;
  segments: SegmentResult[];
}

interface TranscriptionItem {
  segmentId: string;
  segmentIndex: number;
  fileName: string;
  geminiText: string;
  duration: number;
  startTime: number;
  endTime: number;
}

type Stage = "idle" | "selected" | "processing" | "done" | "error";
type TranscribeStatus = "idle" | "pending" | "done" | "error";

interface AlignedSegmentItem {
  segmentIndex: number;
  referenceText: string;
  matchScore: number;
  refWordStart: number;
  refWordEnd: number;
}

type AlignStatus = "idle" | "pending" | "done" | "error";
type ValidationStatus = "valid" | "invalid";

/** Color palette for segment highlights in the modal */
const SEGMENT_COLORS = [
  "bg-blue-200/60 dark:bg-blue-800/40",
  "bg-emerald-200/60 dark:bg-emerald-800/40",
  "bg-amber-200/60 dark:bg-amber-800/40",
  "bg-purple-200/60 dark:bg-purple-800/40",
  "bg-pink-200/60 dark:bg-pink-800/40",
  "bg-cyan-200/60 dark:bg-cyan-800/40",
  "bg-orange-200/60 dark:bg-orange-800/40",
  "bg-lime-200/60 dark:bg-lime-800/40",
  "bg-rose-200/60 dark:bg-rose-800/40",
  "bg-indigo-200/60 dark:bg-indigo-800/40",
];

// ─── Utils ────────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  const ms = ((seconds % 1) * 10).toFixed(0);
  return m > 0 ? `${m}:${s}.${ms}` : `0:${s}.${ms}`;
}

function segmentUrl(outputDir: string, fileName: string) {
  return `/api/audio/segment?dir=${encodeURIComponent(outputDir)}&file=${encodeURIComponent(fileName)}`;
}

const ACCEPTED = ".mp3,.wav,.m4a,.flac,.ogg,.aac,.wma,.opus,.aiff,.webm,.mp4";
const FORMATS = ["MP3", "WAV", "M4A", "FLAC", "OGG", "AAC", "OPUS", "AIFF"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Page() {
  // ── Upload state ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Split parameters ──
  const [silenceThreshold, setSilenceThreshold] = useState("-40dB");
  const [silenceDuration, setSilenceDuration] = useState("0.3");
  const [minDuration, setMinDuration] = useState("3");
  const [maxDuration, setMaxDuration] = useState("9");

  // ── Audio player state ──
  const segAudioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);

  // ── Transcription state ──
  /** Per-segment transcription text (keyed by segment index) */
  const [transcriptions, setTranscriptions] = useState<Record<number, string>>({});
  /** Per-segment transcription status */
  const [transcribeStatus, setTranscribeStatus] = useState<Record<number, TranscribeStatus>>({});
  /** Global "transcribe all" in progress */
  const [isTranscribingAll, setIsTranscribingAll] = useState(false);
  /** Number of segments transcribed so far (for progress) */
  const [transcribeProgress, setTranscribeProgress] = useState(0);

  // ── Reference text state ──
  const refFileInputRef = useRef<HTMLInputElement>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceText, setReferenceText] = useState<string | null>(null);

  // ── Alignment state ──
  const [alignments, setAlignments] = useState<Record<number, AlignedSegmentItem>>({});
  const [alignStatus, setAlignStatus] = useState<AlignStatus>("idle");
  const [alignError, setAlignError] = useState<string | null>(null);
  const [alignStats, setAlignStats] = useState<{
    totalSegments: number;
    alignedSegments: number;
    averageScore: number;
    lowConfidenceCount: number;
  } | null>(null);

  // ── Validation state ──
  /** Per-segment human validation of Gemini transcription */
  const [validations, setValidations] = useState<Record<number, ValidationStatus>>({});

  // ── Download state ──
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  // ── Modal state ──
  const [alignModalOpen, setAlignModalOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Player helpers ──
  const playSegment = useCallback(
    (index: number) => {
      if (!result) return;
      const seg = result.segments[index];
      const audio = segAudioRef.current;
      if (!audio) return;

      audio.src = segmentUrl(result.outputDir, seg.fileName);
      audio.load();
      audio.play().catch(() => {});
      setPlayingIndex(index);
      setIsPlaying(true);
      setPlayerTime(0);
      setPlayerDuration(seg.duration);
    },
    [result]
  );

  const togglePlay = useCallback(() => {
    const audio = segAudioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const playPrev = useCallback(() => {
    if (playingIndex === null || !result) return;
    const prev = playingIndex - 1;
    if (prev >= 0) playSegment(prev);
  }, [playingIndex, result, playSegment]);

  const playNext = useCallback(() => {
    if (playingIndex === null || !result) return;
    const next = playingIndex + 1;
    if (next < result.segments.length) playSegment(next);
  }, [playingIndex, result, playSegment]);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = segAudioRef.current;
      const bar = progressBarRef.current;
      if (!audio || !bar) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      audio.currentTime = ratio * audio.duration;
    },
    []
  );

  // Audio element event handlers
  const onTimeUpdate = useCallback(() => {
    const audio = segAudioRef.current;
    if (audio) setPlayerTime(audio.currentTime);
  }, []);

  const onEnded = useCallback(() => {
    setIsPlaying(false);
    if (result && playingIndex !== null && playingIndex + 1 < result.segments.length) {
      playSegment(playingIndex + 1);
    }
  }, [result, playingIndex, playSegment]);

  const onLoadedMetadata = useCallback(() => {
    const audio = segAudioRef.current;
    if (audio) setPlayerDuration(audio.duration);
  }, []);

  // ── Upload handlers ──
  const handleFile = useCallback(
    (f: File) => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setFile(f);
      setAudioUrl(URL.createObjectURL(f));
      setStage("selected");
      setResult(null);
      setError(null);
      setUploadProgress(0);
    },
    [audioUrl]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleProcess = useCallback(() => {
    if (!file) return;
    setStage("processing");
    setUploadProgress(0);
    setError(null);

    const formData = new FormData();
    formData.append("audio", file);
    formData.append("silenceThreshold", silenceThreshold);
    formData.append("silenceDuration", silenceDuration);
    formData.append("minDuration", minDuration);
    formData.append("maxDuration", maxDuration);

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && data.success) {
          setResult(data.data);
          setStage("done");
        } else {
          setError(data.error || `Erreur ${xhr.status}`);
          setStage("error");
        }
      } catch {
        setError("Réponse invalide du serveur");
        setStage("error");
      }
    });
    xhr.addEventListener("error", () => {
      setError("Erreur réseau — vérifiez que le serveur est lancé");
      setStage("error");
    });
    xhr.open("POST", "/api/audio/split");
    xhr.send(formData);
  }, [file, silenceThreshold, silenceDuration, minDuration, maxDuration]);

  const reset = useCallback(() => {
    const audio = segAudioRef.current;
    if (audio) { audio.pause(); audio.src = ""; }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setFile(null);
    setAudioUrl(null);
    setStage("idle");
    setResult(null);
    setError(null);
    setUploadProgress(0);
    setPlayingIndex(null);
    setIsPlaying(false);
    setPlayerTime(0);
    setTranscriptions({});
    setTranscribeStatus({});
    setIsTranscribingAll(false);
    setTranscribeProgress(0);
    setReferenceFile(null);
    setReferenceText(null);
    setAlignments({});
    setAlignStatus("idle");
    setAlignError(null);
    setAlignStats(null);
    setValidations({});
    setIsDownloadingZip(false);
  }, [audioUrl]);

  // ── Transcription handlers ──
  const transcribeSingle = useCallback(
    async (seg: SegmentResult) => {
      if (!result) return;
      setTranscribeStatus((prev) => ({ ...prev, [seg.index]: "pending" }));

      try {
        const res = await fetch("/api/audio/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "single",
            segmentsDir: result.outputDir,
            segment: seg,
          }),
        });
        const json = await res.json();

        if (json.success && json.data) {
          setTranscriptions((prev) => ({
            ...prev,
            [seg.index]: json.data.geminiText,
          }));
          setTranscribeStatus((prev) => ({ ...prev, [seg.index]: "done" }));
        } else {
          setTranscribeStatus((prev) => ({ ...prev, [seg.index]: "error" }));
        }
      } catch {
        setTranscribeStatus((prev) => ({ ...prev, [seg.index]: "error" }));
      }
    },
    [result]
  );

  const transcribeAll = useCallback(async () => {
    if (!result) return;
    setIsTranscribingAll(true);
    setTranscribeProgress(0);

    for (let i = 0; i < result.segments.length; i++) {
      const seg = result.segments[i];
      // Skip already-done segments
      if (transcribeStatus[seg.index] === "done") {
        setTranscribeProgress(i + 1);
        continue;
      }

      setTranscribeStatus((prev) => ({ ...prev, [seg.index]: "pending" }));

      try {
        const res = await fetch("/api/audio/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "single",
            segmentsDir: result.outputDir,
            segment: seg,
          }),
        });
        const json = await res.json();

        if (json.success && json.data) {
          setTranscriptions((prev) => ({
            ...prev,
            [seg.index]: json.data.geminiText,
          }));
          setTranscribeStatus((prev) => ({ ...prev, [seg.index]: "done" }));
        } else {
          setTranscribeStatus((prev) => ({ ...prev, [seg.index]: "error" }));
        }
      } catch {
        setTranscribeStatus((prev) => ({ ...prev, [seg.index]: "error" }));
      }

      setTranscribeProgress(i + 1);
    }

    setIsTranscribingAll(false);
  }, [result, transcribeStatus]);

  // ── Reference file handler ──
  const handleReferenceFile = useCallback(async (f: File) => {
    setReferenceFile(f);
    const text = await f.text();
    setReferenceText(text);
    // Reset any previous alignment
    setAlignments({});
    setAlignStatus("idle");
    setAlignError(null);
    setAlignStats(null);
  }, []);

  // ── Alignment handler ──

  const downloadSegmentsZip = useCallback(async () => {
    if (!result) return;
    setIsDownloadingZip(true);
    try {
      const url = `/api/audio/download-segments?dir=${encodeURIComponent(result.outputDir)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Erreur lors du téléchargement");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `segments_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // silently fail — user can retry
    } finally {
      setIsDownloadingZip(false);
    }
  }, [result]);

  const alignAll = useCallback(async () => {
    if (!result || !referenceText) return;

    // Build transcription results from what we have
    const transcriptionResults = result.segments
      .filter((seg) => transcribeStatus[seg.index] === "done" && transcriptions[seg.index])
      .map((seg) => ({
        segmentId: seg.id,
        segmentIndex: seg.index,
        fileName: seg.fileName,
        geminiText: transcriptions[seg.index],
        duration: seg.duration,
        startTime: seg.startTime,
        endTime: seg.endTime,
      }));

    if (transcriptionResults.length === 0) {
      setAlignError("Aucune transcription disponible. Transcrivez d'abord les segments.");
      return;
    }

    setAlignStatus("pending");
    setAlignError(null);

    try {
      const res = await fetch("/api/audio/align", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptions: transcriptionResults,
          referenceText,
          outputDir: result.outputDir,
          minConfidence: 0.4,
        }),
      });
      const json = await res.json();

      if (json.success && json.data) {
        const newAlignments: Record<number, AlignedSegmentItem> = {};
        for (const seg of json.data.segments) {
          newAlignments[seg.segmentIndex] = {
            segmentIndex: seg.segmentIndex,
            referenceText: seg.referenceText,
            matchScore: seg.matchScore,
            refWordStart: seg.refWordStart,
            refWordEnd: seg.refWordEnd,
          };
        }
        setAlignments(newAlignments);
        setAlignStats({
          totalSegments: json.data.totalSegments,
          alignedSegments: json.data.alignedSegments,
          averageScore: json.data.averageScore,
          lowConfidenceCount: json.data.lowConfidenceCount,
        });
        setAlignStatus("done");
      } else {
        setAlignError(json.error || "Erreur d'alignement");
        setAlignStatus("error");
      }
    } catch {
      setAlignError("Erreur réseau lors de l'alignement");
      setAlignStatus("error");
    }
  }, [result, referenceText, transcriptions, transcribeStatus]);

  const progress = playerDuration > 0 ? (playerTime / playerDuration) * 100 : 0;
  const playingSegment = result && playingIndex !== null ? result.segments[playingIndex] : null;

  const transcribedCount = Object.values(transcribeStatus).filter((s) => s === "done").length;
  const alignedCount = Object.keys(alignments).length;
  const validationCount = Object.keys(validations).length;
  const validCount = Object.values(validations).filter((v) => v === "valid").length;
  const invalidCount = Object.values(validations).filter((v) => v === "invalid").length;

  // ── Report generation ──
  const generateReport = useCallback(() => {
    if (!result) return;
    const totalValidated = validCount + invalidCount;
    const successRate = totalValidated > 0 ? ((validCount / totalValidated) * 100).toFixed(1) : "0.0";

    const report = {
      generatedAt: new Date().toISOString(),
      model: "gemini-3-flash-preview",
      summary: {
        totalSegments: result.segmentCount,
        transcribedSegments: transcribedCount,
        evaluatedSegments: totalValidated,
        correct: validCount,
        incorrect: invalidCount,
        successRate: `${successRate}%`,
      },
      segments: result.segments.map((seg) => ({
        index: seg.index + 1,
        fileName: seg.fileName,
        startTime: seg.startTime,
        endTime: seg.endTime,
        duration: seg.duration,
        geminiText: transcriptions[seg.index] ?? null,
        transcriptionStatus: transcribeStatus[seg.index] ?? "idle",
        validation: validations[seg.index] ?? "not_evaluated",
      })),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport-gemini-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, validations, transcriptions, transcribeStatus, transcribedCount, validCount, invalidCount]);

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center py-16 px-4">
      {/* Hidden audio element for segments */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={segAudioRef}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onLoadedMetadata={onLoadedMetadata}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      <div className={cn(
        "w-full space-y-5 transition-all duration-300",
        stage === "done" ? "max-w-7xl" : "max-w-xl"
      )}>

        {/* ── Header ── */}
        <div className="text-center space-y-1.5 mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <HugeiconsIcon icon={AudioWave01Icon} size={28} className="text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Speeckle</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Découpe ton audio en segments par détection de silence
          </p>
        </div>

        {/* ── Upload zone ── */}
        {stage === "idle" && (
          <button
            className={cn(
              "w-full border-2 border-dashed rounded-xl p-14 flex flex-col items-center gap-5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40 hover:bg-primary/2"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center transition-colors",
              dragging ? "bg-primary/20" : "bg-primary/10"
            )}>
              <HugeiconsIcon icon={CloudUploadIcon} size={32} className="text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-semibold">Déposer un fichier audio ici</p>
              <p className="text-sm text-muted-foreground">
                ou{" "}
                <span className="text-primary underline underline-offset-2">cliquer pour choisir</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {FORMATS.map((fmt) => (
                <Badge key={fmt} variant="secondary" className="text-xs font-mono">{fmt}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Fichiers volumineux acceptés</p>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />

        {/* Hidden reference file input */}
        <input
          ref={refFileInputRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleReferenceFile(f);
            e.target.value = "";
          }}
        />

        {/* ── File preview ── */}
        {file && audioUrl && stage !== "idle" && (
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <HugeiconsIcon icon={FileMusicIcon} size={20} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>
              </div>
              {(stage === "selected" || stage === "error") && (
                <Button variant="ghost" size="icon-sm" onClick={reset} className="shrink-0">
                  <HugeiconsIcon icon={Cancel01Icon} size={16} />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <WaveformPlayer src={audioUrl} />
            </CardContent>
          </Card>
        )}

        {/* ── Parameters + Process ── */}
        {stage === "selected" && (
          <div className="space-y-4">
            {/* Reference text upload */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <HugeiconsIcon icon={FileAttachmentIcon} size={16} className="text-primary" />
                  Texte de référence (optionnel)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {referenceFile ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <HugeiconsIcon icon={TextIcon} size={16} className="text-primary shrink-0" />
                      <span className="text-sm truncate">{referenceFile.name}</span>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {formatFileSize(referenceFile.size)}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setReferenceFile(null);
                        setReferenceText(null);
                      }}
                      className="shrink-0"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={14} />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full gap-2 text-sm"
                    onClick={() => refFileInputRef.current?.click()}
                  >
                    <HugeiconsIcon icon={FileAttachmentIcon} size={16} />
                    Charger un fichier .txt
                  </Button>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Fichier de transcription de référence pour l'alignement fuzzy (Phase 3)
                </p>
              </CardContent>
            </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Paramètres de découpage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="threshold" className="text-xs text-muted-foreground">Seuil silence (dB)</Label>
                  <Input id="threshold" value={silenceThreshold} onChange={(e) => setSilenceThreshold(e.target.value)} placeholder="-40dB" className="text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="silence-dur" className="text-xs text-muted-foreground">Pause min détectée (s)</Label>
                  <Input id="silence-dur" type="number" value={silenceDuration} onChange={(e) => setSilenceDuration(e.target.value)} min="0.1" max="2" step="0.05" className="text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="min-dur" className="text-xs text-muted-foreground">Segment min (s)</Label>
                  <Input id="min-dur" type="number" value={minDuration} onChange={(e) => setMinDuration(e.target.value)} min="1" max="30" step="0.5" className="text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max-dur" className="text-xs text-muted-foreground">Segment max (s)</Label>
                  <Input id="max-dur" type="number" value={maxDuration} onChange={(e) => setMaxDuration(e.target.value)} min="1" max="30" step="0.5" className="text-sm" />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full gap-2" onClick={handleProcess}>
                <HugeiconsIcon icon={SplitIcon} size={16} />
                Découper l'audio
              </Button>
            </CardFooter>
          </Card>
          </div>
        )}

        {/* ── Processing ── */}
        {stage === "processing" && (
          <Card>
            <CardContent className="py-8 space-y-4">
              <div className="flex items-center gap-3">
                <HugeiconsIcon icon={Loading02Icon} size={20} className="text-primary animate-spin shrink-0" />
                <span className="text-sm font-medium">
                  {uploadProgress < 100 ? `Envoi du fichier… ${uploadProgress}%` : "Analyse et découpage en cours…"}
                </span>
              </div>
              {uploadProgress < 100 && <Progress value={uploadProgress} className="h-1.5" />}
            </CardContent>
          </Card>
        )}

        {/* ── Error ── */}
        {stage === "error" && error && (
          <Card className="border-destructive/40">
            <CardContent className="py-5 flex items-start gap-3">
              <HugeiconsIcon icon={Alert01Icon} size={20} className="text-destructive mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-medium text-destructive">Erreur de traitement</p>
                <p className="text-xs text-muted-foreground wrap-break-word">{error}</p>
              </div>
            </CardContent>
            <CardFooter className="pt-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => setStage("selected")}>Réessayer</Button>
              <Button variant="ghost" size="sm" onClick={reset}>Changer de fichier</Button>
            </CardFooter>
          </Card>
        )}

        {/* ── Results — 2-column layout ── */}
        {stage === "done" && result && (
          <div className="space-y-4">

            {/* Summary */}
            <div className="flex items-center gap-2 flex-wrap">
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={18} className="text-primary shrink-0" />
              <span className="text-sm font-medium">Découpage terminé</span>
              <div className="flex gap-1.5 ml-auto">
                <Badge variant="secondary">{result.segmentCount} segments</Badge>
                <Badge variant="secondary">{formatDuration(result.totalDuration)}</Badge>
                {transcribedCount > 0 && (
                  <Badge variant="default" className="gap-1">
                    <HugeiconsIcon icon={LanguageCircleIcon} size={12} />
                    {transcribedCount}/{result.segmentCount} transcrits
                  </Badge>
                )}
                {validationCount > 0 && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "gap-1",
                      validCount + invalidCount === transcribedCount && transcribedCount > 0
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                        : ""
                    )}
                  >
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={12} />
                    {validCount}✓ {invalidCount}✗ évalués
                  </Badge>
                )}
                {alignedCount > 0 && (
                  <Badge variant="default" className="gap-1 bg-emerald-600">
                    <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} size={12} />
                    {alignedCount} alignés
                    {alignStats && ` · ${(alignStats.averageScore * 100).toFixed(0)}%`}
                  </Badge>
                )}
              </div>
            </div>

            {/* ── Now Playing ── */}
            {playingSegment && (
              <Card className="border-primary/30 bg-card">
                <CardContent className="py-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={AudioWave01Icon} size={16} className="text-primary" />
                      <span className="text-sm font-medium">
                        Segment {String(playingSegment.index + 1).padStart(3, "0")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        / {result.segmentCount}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {playingSegment.startTime.toFixed(2)}s → {playingSegment.endTime.toFixed(2)}s
                    </span>
                  </div>

                  <div
                    ref={progressBarRef}
                    className="relative h-1.5 bg-primary/15 rounded-full cursor-pointer group"
                    onClick={handleSeek}
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-primary rounded-full transition-[width] duration-100"
                      style={{ width: `${progress}%` }}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                      style={{ left: `calc(${progress}% - 6px)` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                    <span>{formatTime(playerTime)}</span>
                    <span>{formatTime(playerDuration)}</span>
                  </div>

                  <div className="flex items-center justify-center gap-3">
                    <Button variant="ghost" size="icon-sm" onClick={playPrev} disabled={playingIndex === 0} className="text-muted-foreground hover:text-foreground">
                      <HugeiconsIcon icon={Backward01Icon} size={18} />
                    </Button>
                    <Button size="icon" onClick={togglePlay} className="w-10 h-10 rounded-full">
                      <HugeiconsIcon icon={isPlaying ? PauseIcon : PlayIcon} size={20} />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={playNext} disabled={playingIndex === result.segments.length - 1} className="text-muted-foreground hover:text-foreground">
                      <HugeiconsIcon icon={NextIcon} size={18} />
                    </Button>
                  </div>

                  {/* Validation buttons */}
                  {transcriptions[playingSegment.index] && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setValidations((prev) => ({ ...prev, [playingSegment.index]: "invalid" }))
                        }
                        className={cn(
                          "flex-1 gap-1.5 text-xs transition-colors",
                          validations[playingSegment.index] === "invalid"
                            ? "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20"
                            : "text-muted-foreground hover:border-destructive hover:text-destructive"
                        )}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} size={14} />
                        Incorrect
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setValidations((prev) => ({ ...prev, [playingSegment.index]: "valid" }))
                        }
                        className={cn(
                          "flex-1 gap-1.5 text-xs transition-colors",
                          validations[playingSegment.index] === "valid"
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                            : "text-muted-foreground hover:border-emerald-500 hover:text-emerald-600"
                        )}
                      >
                        <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} />
                        Correct
                      </Button>
                    </div>
                  )}

                  {/* Show transcription of playing segment */}
                  {transcriptions[playingSegment.index] && (
                    <div className="pt-2 border-t border-border">
                      <p className="text-sm text-muted-foreground italic">
                        {transcriptions[playingSegment.index]}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Three-column grid: Segments | Transcriptions | Alignement ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* ── Left column — Segments ── */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <HugeiconsIcon icon={AudioWave01Icon} size={16} className="text-primary" />
                      Segments audio
                    </CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={downloadSegmentsZip}
                      disabled={isDownloadingZip}
                      className="gap-1.5 text-xs"
                      title="Télécharger tous les segments en ZIP"
                    >
                      {isDownloadingZip ? (
                        <>
                          <HugeiconsIcon icon={Loading02Icon} size={14} className="animate-spin" />
                          ZIP…
                        </>
                      ) : (
                        <>
                          <HugeiconsIcon icon={FileAttachmentIcon} size={14} />
                          Tout télécharger
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="px-4 py-2 grid grid-cols-[2rem_1fr_auto_2rem] gap-3 items-center border-b border-border">
                    <span className="text-xs text-muted-foreground font-medium">#</span>
                    <span className="text-xs text-muted-foreground font-medium">Intervalle</span>
                    <span className="text-xs text-muted-foreground font-medium text-right">Durée</span>
                    <span />
                  </div>

                  <ScrollArea className="h-96">
                    <div className="divide-y divide-border">
                      {result.segments.map((seg) => {
                        const active = playingIndex === seg.index;
                        return (
                          <div
                            key={seg.id}
                            onClick={() => playSegment(seg.index)}
                            className={cn(
                              "px-4 py-2.5 grid grid-cols-[2rem_1fr_auto_2rem] gap-3 items-center cursor-pointer transition-colors",
                              active ? "bg-primary/8" : "hover:bg-muted/40"
                            )}
                          >
                            <span className={cn(
                              "font-mono text-xs",
                              active ? "text-primary font-semibold" : "text-muted-foreground"
                            )}>
                              {String(seg.index + 1).padStart(3, "0")}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {seg.startTime.toFixed(2)}s → {seg.endTime.toFixed(2)}s
                            </span>
                            <Badge variant={active ? "default" : "outline"} className="text-xs font-mono justify-center min-w-14">
                              {seg.duration.toFixed(2)}s
                            </Badge>
                            <div className="flex justify-center">
                              {active && isPlaying ? (
                                <HugeiconsIcon icon={PauseIcon} size={14} className="text-primary" />
                              ) : active ? (
                                <HugeiconsIcon icon={ReplayIcon} size={14} className="text-primary" />
                              ) : (
                                <HugeiconsIcon icon={PlayIcon} size={14} className="text-muted-foreground" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* ── Right column — Transcriptions ── */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <HugeiconsIcon icon={LanguageCircleIcon} size={16} className="text-primary" />
                      Transcriptions
                    </CardTitle>
                    <Button
                      size="sm"
                      variant={isTranscribingAll ? "secondary" : "default"}
                      disabled={isTranscribingAll}
                      onClick={transcribeAll}
                      className="gap-1.5 text-xs"
                    >
                      {isTranscribingAll ? (
                        <>
                          <HugeiconsIcon icon={Loading02Icon} size={14} className="animate-spin" />
                          {transcribeProgress}/{result.segmentCount}
                        </>
                      ) : (
                        <>
                          <HugeiconsIcon icon={LanguageCircleIcon} size={14} />
                          Tout transcrire
                        </>
                      )}
                    </Button>
                  </div>
                  {isTranscribingAll && (
                    <Progress value={(transcribeProgress / result.segmentCount) * 100} className="h-1 mt-2" />
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  <div className="px-4 py-2 grid grid-cols-[2rem_1fr_auto] gap-3 items-center border-b border-border">
                    <span className="text-xs text-muted-foreground font-medium">#</span>
                    <span className="text-xs text-muted-foreground font-medium">Texte transcrit</span>
                    <span className="text-xs text-muted-foreground font-medium">Action</span>
                  </div>

                  <ScrollArea className="h-96">
                    <div className="divide-y divide-border">
                      {result.segments.map((seg) => {
                        const status = transcribeStatus[seg.index] || "idle";
                        const text = transcriptions[seg.index];
                        const active = playingIndex === seg.index;
                        const validation = validations[seg.index];

                        return (
                          <div
                            key={seg.id}
                            className={cn(
                              "px-4 py-2.5 grid grid-cols-[2rem_1fr_auto] gap-3 items-center transition-colors",
                              active ? "bg-primary/8" : "",
                              validation === "valid" ? "bg-emerald-500/5" : "",
                              validation === "invalid" ? "bg-destructive/5" : ""
                            )}
                          >
                            <span className={cn(
                              "font-mono text-xs",
                              active ? "text-primary font-semibold" : "text-muted-foreground"
                            )}>
                              {String(seg.index + 1).padStart(3, "0")}
                            </span>

                            <div className="min-w-0">
                              {status === "pending" && (
                                <div className="flex items-center gap-2">
                                  <HugeiconsIcon icon={Loading02Icon} size={14} className="text-primary animate-spin shrink-0" />
                                  <span className="text-xs text-muted-foreground">Transcription…</span>
                                </div>
                              )}
                              {status === "done" && text && (
                                <p className="text-sm leading-relaxed wrap-break-word">{text}</p>
                              )}
                              {status === "error" && (
                                <div className="flex items-center gap-1.5">
                                  <HugeiconsIcon icon={Alert01Icon} size={14} className="text-destructive shrink-0" />
                                  <span className="text-xs text-destructive">Erreur</span>
                                </div>
                              )}
                              {status === "idle" && (
                                <span className="text-xs text-muted-foreground italic">En attente…</span>
                              )}
                            </div>

                            <div className="shrink-0">
                              {(status === "idle" || status === "error") && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => transcribeSingle(seg)}
                                  disabled={isTranscribingAll}
                                  title="Transcrire ce segment"
                                >
                                  <HugeiconsIcon icon={LanguageCircleIcon} size={14} className="text-primary" />
                                </Button>
                              )}
                              {status === "pending" && (
                                <HugeiconsIcon icon={Loading02Icon} size={14} className="text-muted-foreground animate-spin" />
                              )}
                              {status === "done" && (
                                <div className="flex flex-col items-center gap-0.5">
                                  {validation === "valid" && (
                                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} className="text-emerald-500" />
                                  )}
                                  {validation === "invalid" && (
                                    <HugeiconsIcon icon={Cancel01Icon} size={14} className="text-destructive" />
                                  )}
                                  {!validation && (
                                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} className="text-primary" />
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* ── Third column — Alignement ── */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} size={16} className="text-primary" />
                      Alignement
                    </CardTitle>
                    {referenceText ? (
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant={alignStatus === "pending" ? "secondary" : "default"}
                          disabled={alignStatus === "pending" || transcribedCount === 0}
                          onClick={alignAll}
                          className="gap-1.5 text-xs"
                        >
                          {alignStatus === "pending" ? (
                            <>
                              <HugeiconsIcon icon={Loading02Icon} size={14} className="animate-spin" />
                              Alignement…
                            </>
                          ) : (
                            <>
                              <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} size={14} />
                              {alignStatus === "done" ? "Re-aligner" : "Aligner"}
                            </>
                          )}
                        </Button>
                        {alignStatus === "done" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAlignModalOpen(true)}
                            className="gap-1.5 text-xs"
                          >
                            <HugeiconsIcon icon={ViewIcon} size={14} />
                            Voir
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refFileInputRef.current?.click()}
                        className="gap-1.5 text-xs"
                      >
                        <HugeiconsIcon icon={FileAttachmentIcon} size={14} />
                        Charger .txt
                      </Button>
                    )}
                  </div>
                  {alignStatus === "done" && alignStats && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        Score moyen: {(alignStats.averageScore * 100).toFixed(0)}%
                      </Badge>
                      {alignStats.lowConfidenceCount > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {alignStats.lowConfidenceCount} faible confiance
                        </Badge>
                      )}
                    </div>
                  )}
                  {alignError && (
                    <p className="text-xs text-destructive mt-2">{alignError}</p>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  {!referenceText ? (
                    <div className="px-4 py-8 text-center">
                      <HugeiconsIcon icon={FileAttachmentIcon} size={24} className="text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">
                        Chargez un fichier de référence (.txt) pour activer l'alignement
                      </p>
                    </div>
                  ) : alignStatus === "idle" && transcribedCount === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <HugeiconsIcon icon={LanguageCircleIcon} size={24} className="text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">
                        Transcrivez d'abord les segments avant d'aligner
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="px-4 py-2 grid grid-cols-[2rem_1fr_auto] gap-3 items-center border-b border-border">
                        <span className="text-xs text-muted-foreground font-medium">#</span>
                        <span className="text-xs text-muted-foreground font-medium">Texte de référence</span>
                        <span className="text-xs text-muted-foreground font-medium">Score</span>
                      </div>

                      <ScrollArea className="h-96">
                        <div className="divide-y divide-border">
                          {result.segments.map((seg) => {
                            const aligned = alignments[seg.index];
                            const active = playingIndex === seg.index;

                            return (
                              <div
                                key={seg.id}
                                className={cn(
                                  "px-4 py-2.5 grid grid-cols-[2rem_1fr_auto] gap-3 items-center transition-colors",
                                  active ? "bg-primary/8" : ""
                                )}
                              >
                                <span className={cn(
                                  "font-mono text-xs",
                                  active ? "text-primary font-semibold" : "text-muted-foreground"
                                )}>
                                  {String(seg.index + 1).padStart(3, "0")}
                                </span>

                                <div className="min-w-0">
                                  {alignStatus === "pending" && (
                                    <div className="flex items-center gap-2">
                                      <HugeiconsIcon icon={Loading02Icon} size={14} className="text-primary animate-spin shrink-0" />
                                      <span className="text-xs text-muted-foreground">Alignement…</span>
                                    </div>
                                  )}
                                  {aligned ? (
                                    <p className="text-sm leading-relaxed wrap-break-word">{aligned.referenceText || <span className="text-xs text-muted-foreground italic">Aucun match</span>}</p>
                                  ) : alignStatus !== "pending" ? (
                                    <span className="text-xs text-muted-foreground italic">—</span>
                                  ) : null}
                                </div>

                                <div className="shrink-0">
                                  {aligned ? (
                                    <Badge
                                      variant={aligned.matchScore >= 0.6 ? "default" : "outline"}
                                      className={cn(
                                        "text-xs font-mono min-w-12 justify-center",
                                        aligned.matchScore >= 0.6
                                          ? "bg-emerald-600 hover:bg-emerald-700"
                                          : aligned.matchScore >= 0.4
                                            ? "border-amber-500 text-amber-600"
                                            : "border-destructive text-destructive"
                                      )}
                                    >
                                      {(aligned.matchScore * 100).toFixed(0)}%
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Footer */}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Nouveau fichier
              </Button>
              {transcribedCount > 0 && (
                <Button
                  variant="default"
                  className={cn(
                    "gap-2",
                    validCount + invalidCount === transcribedCount
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : ""
                  )}
                  onClick={generateReport}
                  disabled={validationCount === 0}
                  title={validationCount === 0 ? "Évaluez au moins un segment pour générer un rapport" : undefined}
                >
                  <HugeiconsIcon icon={FileAttachmentIcon} size={16} />
                  Rapport
                  {validationCount > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                      {((validCount / (validCount + invalidCount)) * 100).toFixed(0)}%
                    </Badge>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Alignment visualization modal ── */}
      <Dialog open={alignModalOpen} onOpenChange={setAlignModalOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} size={18} className="text-primary" />
              Visualisation de l'alignement
            </DialogTitle>
            <DialogDescription>
              Le texte de référence est affiché ci-dessous. Les portions alignées avec les transcriptions Gemini sont surlignées.
              Passez la souris sur une zone surlignée pour voir la transcription Gemini correspondante.
            </DialogDescription>
            {alignStats && (
              <div className="flex gap-2 flex-wrap pt-1">
                <Badge variant="secondary" className="text-xs">
                  {alignStats.alignedSegments}/{alignStats.totalSegments} alignés
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  Score moyen: {(alignStats.averageScore * 100).toFixed(0)}%
                </Badge>
                {alignStats.lowConfidenceCount > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {alignStats.lowConfidenceCount} faible confiance
                  </Badge>
                )}
              </div>
            )}
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0 border rounded-lg p-4">
            {referenceText && (() => {
              // Split reference text into words
              const refWords = referenceText.split(/\s+/).filter((w) => w.length > 0);

              // Build a map: word index → segment info
              const wordToSegment = new Map<number, { segmentIndex: number; colorIdx: number; geminiText: string; matchScore: number }>();
              let colorCounter = 0;
              const segmentEntries = Object.values(alignments)
                .filter((a) => a.referenceText.length > 0)
                .sort((a, b) => a.refWordStart - b.refWordStart);

              for (const seg of segmentEntries) {
                const colorIdx = colorCounter % SEGMENT_COLORS.length;
                colorCounter++;
                for (let i = seg.refWordStart; i < seg.refWordEnd; i++) {
                  const gemini = transcriptions[seg.segmentIndex] || "";
                  wordToSegment.set(i, {
                    segmentIndex: seg.segmentIndex,
                    colorIdx,
                    geminiText: gemini,
                    matchScore: seg.matchScore,
                  });
                }
              }

              // Render words with highlights
              const elements: React.ReactNode[] = [];
              let i = 0;
              while (i < refWords.length) {
                const segInfo = wordToSegment.get(i);
                if (segInfo) {
                  // Collect all consecutive words for this segment
                  const startIdx = i;
                  while (
                    i < refWords.length &&
                    wordToSegment.get(i)?.segmentIndex === segInfo.segmentIndex
                  ) {
                    i++;
                  }
                  const matchedWords = refWords.slice(startIdx, i).join(" ");
                  elements.push(
                    <span
                      key={`seg-${startIdx}`}
                      className={cn(
                        "relative rounded px-0.5 py-0.5 cursor-help transition-all inline group/seg",
                        SEGMENT_COLORS[segInfo.colorIdx]
                      )}
                      title={`Segment ${segInfo.segmentIndex + 1} (${(segInfo.matchScore * 100).toFixed(0)}%)\n\nGemini: ${segInfo.geminiText}`}
                    >
                      <span className="text-[10px] font-mono font-bold text-primary/70 align-super mr-0.5 select-none">
                        {segInfo.segmentIndex + 1}
                      </span>
                      {matchedWords}
                    </span>
                  );
                } else {
                  // Unhighlighted word
                  elements.push(
                    <span key={`w-${i}`} className="text-muted-foreground/70">
                      {refWords[i]}
                    </span>
                  );
                  i++;
                }
                // Space between words
                if (i < refWords.length) {
                  elements.push(<span key={`sp-${i}`}>{" "}</span>);
                }
              }

              return (
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {elements}
                </div>
              );
            })()}
          </ScrollArea>

          <DialogFooter showCloseButton>
            <div className="flex items-center gap-3 mr-auto">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block w-3 h-3 rounded bg-blue-200/60 dark:bg-blue-800/40" />
                Aligné
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block w-3 h-3 rounded bg-muted" />
                Non couvert
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
