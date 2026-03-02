import { execFileSync, spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import type { Silence, AudioSegment, SplitResult, SplitOptions } from "./types";

const DEFAULT_OPTIONS: Required<SplitOptions> = {
  silenceThreshold: "-30dB",  // seuil adapté aux respirations dans la parole
  silenceDuration: 0.3,       // pause de respiration naturelle ≈ 0.3–0.5 s
  minSegmentDuration: 3,
  maxSegmentDuration: 9,
  segmentPadding: 0.25,       // 250ms de contexte de chaque côté pour Gemini
};

function getAudioDuration(inputPath: string): number {
  const result = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ], { stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
  return parseFloat(result);
}

function detectSilences(
  inputPath: string,
  threshold: string,
  minDuration: number
): Silence[] {
  // spawnSync donne accès à stderr même quand ffmpeg réussit (exit 0)
  const proc = spawnSync("ffmpeg", [
    "-nostdin",
    "-i", inputPath,
    "-af", `silencedetect=noise=${threshold}:d=${minDuration}`,
    "-f", "null",
    "-",
  ], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

  // silencedetect écrit toujours dans stderr
  const output = proc.stderr || "";

  const silences: Silence[] = [];
  for (const line of output.split("\n")) {
    if (line.includes("silence_end")) {
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      const durMatch = line.match(/silence_duration:\s*([\d.]+)/);
      if (endMatch && durMatch) {
        const end = parseFloat(endMatch[1]);
        const duration = parseFloat(durMatch[1]);
        silences.push({ start: end - duration, end, duration });
      }
    }
  }

  console.log(`Silences bruts détectés: ${silences.length}`);
  return silences;
}

/**
 * Construit les segments en respectant les silences naturels (respirations).
 *
 * Points de coupe propres :
 *   - segment se termine à `silence.start` (fin de parole)
 *   - segment suivant commence à `silence.end` (reprise de parole)
 *
 * Stratégie gloutonne :
 *   1. Prend le dernier silence valide dans [min, max]
 *   2. Si aucun silence dans [min, max] mais un au-delà du max → force-coupe à max
 *   3. Si aucun silence du tout → force-coupe en parts égales
 */
function computeSegments(
  silences: Silence[],
  totalDuration: number,
  options: Required<SplitOptions>
): Array<{ start: number; end: number }> {
  const cuts = silences.map((s) => ({ segEnd: s.start, segStart: s.end }));

  const segments: Array<{ start: number; end: number }> = [];
  let segStart = 0;

  while (segStart < totalDuration - 0.05) {
    const remaining = totalDuration - segStart;

    // ── 1. Silences dans [min, max] ──────────────────────────────────────────
    const goodCuts = cuts.filter((c) => {
      const d = c.segEnd - segStart;
      return d >= options.minSegmentDuration && d <= options.maxSegmentDuration;
    });

    if (goodCuts.length > 0) {
      // Dernier bon silence → segment le plus long dans [min, max]
      const cut = goodCuts[goodCuts.length - 1];
      segments.push({ start: segStart, end: cut.segEnd });
      segStart = cut.segStart;
      continue;
    }

    // ── 2. Silence trop loin (> max) → force-coupe à max ────────────────────
    const overCuts = cuts.filter((c) => c.segEnd - segStart > options.maxSegmentDuration);

    if (overCuts.length > 0) {
      const forcedEnd = segStart + options.maxSegmentDuration;
      segments.push({ start: segStart, end: forcedEnd });
      segStart = forcedEnd;
      continue;
    }

    // ── 3. Aucun silence devant nous ─────────────────────────────────────────
    if (remaining <= options.maxSegmentDuration) {
      // Tout le reste tient dans un segment
      if (remaining >= options.minSegmentDuration) {
        segments.push({ start: segStart, end: totalDuration });
      } else if (segments.length > 0) {
        // Queue trop courte → absorber dans le dernier segment
        segments[segments.length - 1] = {
          ...segments[segments.length - 1],
          end: totalDuration,
        };
      } else {
        segments.push({ start: segStart, end: totalDuration });
      }
      break;
    }

    // Reste trop long sans silences → force-coupe en parts égales
    const parts = Math.ceil(remaining / options.maxSegmentDuration);
    const partDur = remaining / parts;
    for (let i = 0; i < parts; i++) {
      segments.push({
        start: segStart + i * partDur,
        end: segStart + (i + 1) * partDur,
      });
    }
    break;
  }

  return segments;
}

function extractSegment(
  inputPath: string,
  outputPath: string,
  start: number,
  end: number,
  totalDuration: number,
  padding: number
): void {
  const paddedStart = Math.max(0, start - padding);
  const paddedEnd = Math.min(totalDuration, end + padding);
  execFileSync("ffmpeg", [
    "-nostdin",
    "-y",
    "-i", inputPath,
    "-ss", paddedStart.toFixed(6),
    "-to", paddedEnd.toFixed(6),
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    outputPath,
  ], { stdio: ["pipe", "pipe", "pipe"] });
}

export async function splitAudio(
  inputPath: string,
  outputDir: string,
  options?: SplitOptions
): Promise<SplitResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  fs.mkdirSync(outputDir, { recursive: true });

  const totalDuration = getAudioDuration(inputPath);
  console.log(`Durée totale: ${totalDuration.toFixed(2)}s`);

  if (isNaN(totalDuration) || totalDuration <= 0) {
    throw new Error(`Impossible de lire la durée du fichier audio (format non supporté ?)`);
  }

  const silences = detectSilences(inputPath, opts.silenceThreshold, opts.silenceDuration);
  console.log(`Silences retenus: ${silences.length} (seuil ${opts.silenceThreshold}, durée min ${opts.silenceDuration}s)`);

  const segmentRanges = computeSegments(silences, totalDuration, opts);
  console.log(`Segments calculés: ${segmentRanges.length}`);

  const segments: AudioSegment[] = [];
  for (let i = 0; i < segmentRanges.length; i++) {
    const { start, end } = segmentRanges[i];
    const id = uuidv4();
    const fileName = `segment_${String(i).padStart(4, "0")}.wav`;
    const filePath = path.join(outputDir, fileName);
    extractSegment(inputPath, filePath, start, end, totalDuration, opts.segmentPadding);
    segments.push({
      id,
      index: i,
      filePath,
      fileName,
      startTime: parseFloat(start.toFixed(3)),
      endTime: parseFloat(end.toFixed(3)),
      duration: parseFloat((end - start).toFixed(3)),
    });
  }

  return { totalDuration, segments, silencesDetected: silences.length };
}
