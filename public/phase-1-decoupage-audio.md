# Phase 1 — Découpage Audio par Silence (FFmpeg)

## Objectif

Découper un audio de ~12 minutes en segments de **3 à 8 secondes** en détectant les silences, via une API Route Next.js.

---

## Prérequis

```bash
# FFmpeg doit être installé sur ta machine
brew install ffmpeg        # macOS
sudo apt install ffmpeg    # Ubuntu/Debian

# Dépendances Node
npm install fluent-ffmpeg uuid
npm install -D @types/fluent-ffmpeg
```

---

## Structure des fichiers

```
src/
├── app/
│   └── api/
│       └── audio/
│           └── split/
│               └── route.ts        # API Route
├── lib/
│   └── audio/
│       ├── splitAudio.ts           # Logique FFmpeg
│       └── types.ts                # Types partagés
├── public/
│   └── uploads/                    # Audio source (ou utilise /tmp)
└── output/
    └── segments/                   # Segments générés
```

---

## 1. Types partagés

**`src/lib/audio/types.ts`**

```typescript
export interface Silence {
  start: number;
  end: number;
  duration: number;
}

export interface AudioSegment {
  id: string;
  index: number;
  filePath: string;
  fileName: string;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface SplitResult {
  totalDuration: number;
  segments: AudioSegment[];
  silencesDetected: number;
}

export interface SplitOptions {
  silenceThreshold?: string;   // dB, défaut: "-40dB"
  silenceDuration?: number;    // secondes min de silence, défaut: 0.4
  minSegmentDuration?: number; // secondes, défaut: 3
  maxSegmentDuration?: number; // secondes, défaut: 8
}
```

---

## 2. Logique de découpage

**`src/lib/audio/splitAudio.ts`**

```typescript
import { execSync, execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import type {
  Silence,
  AudioSegment,
  SplitResult,
  SplitOptions,
} from "./types";

const DEFAULT_OPTIONS: Required<SplitOptions> = {
  silenceThreshold: "-40dB",
  silenceDuration: 0.4,
  minSegmentDuration: 3,
  maxSegmentDuration: 8,
};

/**
 * Récupère la durée totale de l'audio en secondes.
 */
function getAudioDuration(inputPath: string): number {
  const result = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]).toString().trim();

  return parseFloat(result);
}

/**
 * Détecte les silences dans l'audio via ffmpeg silencedetect.
 */
function detectSilences(
  inputPath: string,
  threshold: string,
  minDuration: number
): Silence[] {
  const result = execFileSync("ffmpeg", [
    "-i", inputPath,
    "-af", `silencedetect=noise=${threshold}:d=${minDuration}`,
    "-f", "null",
    "-",
  ], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

  // silencedetect écrit dans stderr
  // On doit capturer stderr
  let stderr = "";
  try {
    execSync(
      `ffmpeg -i "${inputPath}" -af "silencedetect=noise=${threshold}:d=${minDuration}" -f null - 2>&1`,
      { encoding: "utf-8" }
    );
  } catch (e: any) {
    // ffmpeg retourne souvent un code non-zero, on récupère quand même stdout
    stderr = e.stdout || e.stderr || "";
  }

  const silences: Silence[] = [];
  const lines = stderr.split("\n");

  for (const line of lines) {
    if (line.includes("silence_end")) {
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      const durMatch = line.match(/silence_duration:\s*([\d.]+)/);

      if (endMatch && durMatch) {
        const end = parseFloat(endMatch[1]);
        const duration = parseFloat(durMatch[1]);
        const start = end - duration;
        silences.push({ start, end, duration });
      }
    }
  }

  return silences;
}

/**
 * Calcule les points de coupe à partir des silences détectés.
 * Fusionne les segments trop courts, respecte min/max duration.
 */
function computeSegments(
  silences: Silence[],
  totalDuration: number,
  options: Required<SplitOptions>
): Array<{ start: number; end: number }> {
  // Points de coupe = milieu de chaque silence
  const cutPoints = [0];
  for (const s of silences) {
    cutPoints.push((s.start + s.end) / 2);
  }
  cutPoints.push(totalDuration);

  // Construire les segments bruts
  const rawSegments: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < cutPoints.length - 1; i++) {
    rawSegments.push({ start: cutPoints[i], end: cutPoints[i + 1] });
  }

  // Fusionner les segments trop courts
  const merged: Array<{ start: number; end: number }> = [];
  let current = rawSegments[0];

  for (let i = 1; i < rawSegments.length; i++) {
    const duration = current.end - current.start;

    if (duration < options.minSegmentDuration) {
      // Fusionne avec le suivant
      current = { start: current.start, end: rawSegments[i].end };
    } else {
      merged.push(current);
      current = rawSegments[i];
    }
  }
  merged.push(current);

  // Découper les segments trop longs (coupe simple au milieu)
  const final: Array<{ start: number; end: number }> = [];
  for (const seg of merged) {
    const duration = seg.end - seg.start;
    if (duration > options.maxSegmentDuration) {
      // Diviser en parts égales
      const parts = Math.ceil(duration / options.maxSegmentDuration);
      const partDuration = duration / parts;
      for (let i = 0; i < parts; i++) {
        final.push({
          start: seg.start + i * partDuration,
          end: seg.start + (i + 1) * partDuration,
        });
      }
    } else {
      final.push(seg);
    }
  }

  return final;
}

/**
 * Extrait un segment audio avec ffmpeg.
 */
function extractSegment(
  inputPath: string,
  outputPath: string,
  start: number,
  end: number
): void {
  execSync(
    `ffmpeg -y -i "${inputPath}" -ss ${start} -to ${end} -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`,
    { stdio: "pipe" }
  );
}

/**
 * Fonction principale : découpe l'audio et retourne les métadonnées.
 */
export async function splitAudio(
  inputPath: string,
  outputDir: string,
  options?: SplitOptions
): Promise<SplitResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Créer le dossier de sortie
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Durée totale
  const totalDuration = getAudioDuration(inputPath);
  console.log(`Durée totale: ${totalDuration.toFixed(2)}s`);

  // 2. Détecter les silences
  const silences = detectSilences(
    inputPath,
    opts.silenceThreshold,
    opts.silenceDuration
  );
  console.log(`Silences détectés: ${silences.length}`);

  // 3. Calculer les segments
  const segmentRanges = computeSegments(silences, totalDuration, opts);
  console.log(`Segments calculés: ${segmentRanges.length}`);

  // 4. Extraire chaque segment
  const segments: AudioSegment[] = [];

  for (let i = 0; i < segmentRanges.length; i++) {
    const { start, end } = segmentRanges[i];
    const id = uuidv4();
    const fileName = `segment_${String(i).padStart(4, "0")}.wav`;
    const filePath = path.join(outputDir, fileName);

    extractSegment(inputPath, filePath, start, end);

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

  return {
    totalDuration,
    segments,
    silencesDetected: silences.length,
  };
}
```

---

## 3. API Route Next.js

**`src/app/api/audio/split/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { splitAudio } from "@/lib/audio/splitAudio";
import path from "path";
import fs from "fs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const silenceThreshold = formData.get("silenceThreshold") as string | null;
    const minDuration = formData.get("minDuration") as string | null;
    const maxDuration = formData.get("maxDuration") as string | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: "Aucun fichier audio fourni" },
        { status: 400 }
      );
    }

    // Sauvegarder le fichier uploadé temporairement
    const tempDir = path.join(process.cwd(), "tmp");
    fs.mkdirSync(tempDir, { recursive: true });

    const inputPath = path.join(tempDir, `input_${Date.now()}.wav`);
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);

    // Dossier de sortie pour les segments
    const outputDir = path.join(
      process.cwd(),
      "output",
      "segments",
      `session_${Date.now()}`
    );

    // Découper
    const result = await splitAudio(inputPath, outputDir, {
      silenceThreshold: silenceThreshold || "-40dB",
      minSegmentDuration: minDuration ? parseFloat(minDuration) : 3,
      maxSegmentDuration: maxDuration ? parseFloat(maxDuration) : 8,
    });

    // Nettoyer le fichier temporaire
    fs.unlinkSync(inputPath);

    return NextResponse.json({
      success: true,
      data: {
        totalDuration: result.totalDuration,
        segmentCount: result.segments.length,
        silencesDetected: result.silencesDetected,
        outputDir,
        segments: result.segments.map((s) => ({
          id: s.id,
          index: s.index,
          fileName: s.fileName,
          startTime: s.startTime,
          endTime: s.endTime,
          duration: s.duration,
        })),
      },
    });
  } catch (error: any) {
    console.error("Erreur découpage:", error);
    return NextResponse.json(
      { error: error.message || "Erreur interne" },
      { status: 500 }
    );
  }
}
```

---

## 4. Test rapide

```bash
curl -X POST http://localhost:3000/api/audio/split \
  -F "audio=@./mon_audio_fongbe.wav" \
  -F "silenceThreshold=-40dB" \
  -F "minDuration=3" \
  -F "maxDuration=8"
```

---

## Paramètres à ajuster selon ton audio

| Paramètre | Valeur | Si trop de segments | Si pas assez |
|---|---|---|---|
| `silenceThreshold` | `-40dB` | Monter à `-35dB` | Descendre à `-45dB` |
| `silenceDuration` | `0.4s` | Augmenter à `0.6s` | Réduire à `0.3s` |
| `minSegmentDuration` | `3s` | Augmenter à `4s` | Réduire à `2s` |
| `maxSegmentDuration` | `8s` | — | Augmenter à `10s` |

---

## Sortie attendue

```json
{
  "success": true,
  "data": {
    "totalDuration": 720.5,
    "segmentCount": 142,
    "silencesDetected": 165,
    "segments": [
      {
        "id": "a1b2c3...",
        "index": 0,
        "fileName": "segment_0000.wav",
        "startTime": 0.000,
        "endTime": 5.230,
        "duration": 5.230
      }
    ]
  }
}
```

> **Prochaine étape →** Phase 2 : Envoyer chaque segment à Gemini pour transcription.
