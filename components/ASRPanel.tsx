"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Mic02Icon,
  StopIcon,
  Delete01Icon,
  Copy01Icon,
  CheckmarkCircle02Icon,
  AudioWave01Icon,
  ArrowRight02Icon,
} from "@hugeicons/core-free-icons";
import LatencyBadge from "./LatencyBadge";
import ModelBadge from "./ModelBadge";

interface ASRPanelProps {
  onTranscription: (text: string) => void;
}

type ASRState = "idle" | "recording" | "processing" | "done" | "error";

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  return "webm";
}

function writeWavString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function encodeAudioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeWavString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeWavString(view, 8, "WAVE");
  writeWavString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeWavString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function convertToWav(inputBlob: Blob): Promise<Blob> {
  const audioContext = new AudioContext();
  try {
    const source = await inputBlob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(source.slice(0));
    return encodeAudioBufferToWav(decoded);
  } finally {
    await audioContext.close();
  }
}

export default function ASRPanel({ onTranscription }: ASRPanelProps) {
  const [state, setState] = useState<ASRState>("idle");
  const [transcription, setTranscription] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processingMs, setProcessingMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingStartRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = MediaRecorder.isTypeSupported("audio/wav")
        ? "audio/wav"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
          ? "audio/ogg;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "";

      const mediaRecorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const recordedMimeType = mediaRecorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const originalBlob = new Blob(chunksRef.current, { type: recordedMimeType });

        try {
          const wavBlob = recordedMimeType.includes("wav")
            ? originalBlob
            : await convertToWav(originalBlob);
          await sendToASR(wavBlob);
        } catch (err) {
          console.error("[ASR] Conversion vers WAV impossible", err);
          setError("Format audio non supporte par ce navigateur. Essaie Chrome ou Edge.");
          setState("error");
        }
      };

      mediaRecorder.start(200);
      setState("recording");
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      setError("Impossible d'accéder au microphone.");
      setState("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
    setState("processing");
    setElapsedMs(null);
    setProcessingMs(0);
    processingStartRef.current = performance.now();
    if (processingTimerRef.current) clearInterval(processingTimerRef.current);
    processingTimerRef.current = setInterval(() => {
      if (processingStartRef.current !== null) {
        setProcessingMs(performance.now() - processingStartRef.current);
      }
    }, 50);
  }, []);

  const stopProcessingTimer = () => {
    if (processingTimerRef.current) {
      clearInterval(processingTimerRef.current);
      processingTimerRef.current = null;
    }
    if (processingStartRef.current !== null) {
      setElapsedMs(performance.now() - processingStartRef.current);
      processingStartRef.current = null;
    }
  };

  const sendToASR = async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      const extension = extensionFromMimeType(audioBlob.type);
      formData.append("audio", audioBlob, `recording.${extension}`);
      const response = await fetch("/api/asr", { method: "POST", body: formData });
      if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      stopProcessingTimer();
      setTranscription(data.transcription);
      setState("done");
      onTranscription(data.transcription);
    } catch (err) {
      stopProcessingTimer();
      setError(err instanceof Error ? err.message : "Erreur ASR inconnue.");
      setState("error");
    }
  };

  const reset = () => {
    setTranscription("");
    setError("");
    setState("idle");
    setRecordingTime(0);
    setElapsedMs(null);
    setProcessingMs(0);
  };

  const copyText = () => {
    if (!transcription) return;
    navigator.clipboard.writeText(transcription);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (processingTimerRef.current) clearInterval(processingTimerRef.current);
  }, []);

  return (
    <div className={`flex flex-col h-full rounded-2xl border bg-panel transition-all duration-500 overflow-hidden
      ${state === "recording" ? "border-accent-asr/40 panel-asr-active" : "border-border"}
      ${state === "done" ? "border-accent-asr/30" : ""}
    `}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-border">
        <div className={`w-2 h-2 rounded-full bg-accent-asr transition-all duration-300
          ${state === "recording" ? "shadow-[0_0_10px_rgba(0,212,170,0.9)] animate-pulse" : "shadow-[0_0_6px_rgba(0,212,170,0.5)]"}`}
        />
        <span className="font-display text-xs font-semibold tracking-[0.15em] uppercase text-text-secondary">
          ASR
        </span>
        <span className="text-text-dim text-xs font-body ml-auto hidden sm:inline">
          Reconnaissance vocale · Fon
        </span>
        <LatencyBadge
          color="accent-asr"
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
          name="asrDIL/mms-fongbe-finetuned-v4"
          url="https://huggingface.co/asrDIL/mms-fongbe-finetuned-v4"
          color="accent-asr"
        />
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 items-center justify-between p-4 sm:p-6 gap-4 sm:gap-6">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full">

          {/* RECORDING */}
          {state === "recording" && (
            <div className="flex flex-col items-center gap-4 animate-fade-in">
              <span className="text-xs font-mono text-accent-asr tracking-[0.2em]">
                ● REC {formatTime(recordingTime)}
              </span>
              <div className="flex items-center gap-1 h-10">
                {[...Array(9)].map((_, i) => (
                  <div
                    key={i}
                    className="wave-bar bg-accent-asr rounded-full"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* PROCESSING */}
          {state === "processing" && (
            <div className="flex flex-col items-center gap-3 animate-fade-in">
              <HugeiconsIcon icon={AudioWave01Icon} size={36} className="text-accent-asr animate-spin-slow" />
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="thinking-dot bg-accent-asr" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
              <span className="text-xs font-body text-text-secondary">Transcription en cours…</span>
            </div>
          )}

          {/* IDLE */}
          {state === "idle" && (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 rounded-full bg-accent-asr/10 flex items-center justify-center border border-accent-asr/20">
                <HugeiconsIcon icon={Mic02Icon} size={28} className="text-accent-asr" />
              </div>
              <p className="text-xs font-body text-text-secondary max-w-[160px]">
                Appuie sur le bouton pour commencer l&apos;enregistrement
              </p>
            </div>
          )}

          {/* ERROR */}
          {state === "error" && (
            <div className="flex flex-col items-center gap-3 animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/30">
                <HugeiconsIcon icon={Mic02Icon} size={24} className="text-red-400" />
              </div>
              <p className="text-xs font-body text-red-400 text-center max-w-[180px]">{error}</p>
            </div>
          )}

          {/* DONE */}
          {state === "done" && transcription && (
            <div className="w-full flex flex-col gap-3 animate-slide-up">
              <div className="flex items-center justify-between">
                <span className="text-xs font-body text-text-secondary uppercase tracking-wider">Transcription</span>
                <button onClick={copyText} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Copier">
                  <HugeiconsIcon
                    icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
                    size={14}
                    className={copied ? "text-accent-asr" : "text-text-secondary"}
                  />
                </button>
              </div>

              <div className="relative rounded-xl border border-accent-asr/20 bg-accent-asr/5 p-4">
                <p className="font-mono text-sm text-text-primary leading-relaxed">{transcription}</p>
                <span className="absolute top-2 right-2 text-[9px] font-display font-semibold tracking-wider text-accent-asr/60 bg-accent-asr/10 px-2 py-0.5 rounded-full">
                  FON
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-accent-asr/60 font-body">
                <HugeiconsIcon icon={ArrowRight02Icon} size={12} />
                <span>Envoyé au modèle Général</span>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="w-full">
          {state !== "recording" ? (
            <button
              onClick={state === "error" || state === "done" ? reset : startRecording}
              disabled={state === "processing"}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-display font-semibold text-sm tracking-wide transition-all duration-200
                ${state === "processing" ? "bg-muted text-text-dim cursor-not-allowed" : "bg-accent-asr text-night hover:bg-accent-asr/90 active:scale-95"}`}
            >
              {state === "processing" ? (
                <><HugeiconsIcon icon={AudioWave01Icon} size={16} /> Traitement…</>
              ) : state === "done" || state === "error" ? (
                <><HugeiconsIcon icon={Delete01Icon} size={16} /> Recommencer</>
              ) : (
                <><HugeiconsIcon icon={Mic02Icon} size={16} /> Enregistrer</>
              )}
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 font-display font-semibold text-sm tracking-wide hover:bg-red-500/30 transition-all duration-200 active:scale-95 recording-pulse"
            >
              <HugeiconsIcon icon={StopIcon} size={16} />
              Arrêter l&apos;enregistrement
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
