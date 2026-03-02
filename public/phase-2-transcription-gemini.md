# Phase 2 — Transcription des Segments avec Gemini

## Objectif

Envoyer chaque segment audio (3-8s) issu de la Phase 1 à l'API Gemini pour obtenir une transcription approximative en fongbe.

---

## Prérequis

```bash
npm install @google/generative-ai
```

Tu as besoin d'une clé API Gemini. Crée un fichier `.env.local` :

```env
GEMINI_API_KEY=ta-clé-api-gemini
```

---

## Structure des fichiers

```
src/
├── app/
│   └── api/
│       └── audio/
│           ├── split/route.ts          # Phase 1
│           └── transcribe/route.ts     # Phase 2 ← nouveau
├── lib/
│   └── audio/
│       ├── splitAudio.ts               # Phase 1
│       ├── transcribeSegments.ts       # Phase 2 ← nouveau
│       └── types.ts                    # Types partagés (mis à jour)
```

---

## 1. Mettre à jour les types

**Ajouter dans `src/lib/audio/types.ts`**

```typescript
// ... types Phase 1 existants ...

export interface TranscriptionResult {
  segmentId: string;
  segmentIndex: number;
  fileName: string;
  geminiText: string;
  duration: number;
  startTime: number;
  endTime: number;
}

export interface TranscribeOptions {
  /** Modèle Gemini à utiliser */
  model?: string;
  /** Délai entre chaque appel API (ms) pour éviter le rate limiting */
  delayBetweenCalls?: number;
  /** Nombre max de tentatives par segment */
  maxRetries?: number;
  /** Prompt personnalisé */
  prompt?: string;
}

export interface TranscribeBatchResult {
  total: number;
  succeeded: number;
  failed: number;
  transcriptions: TranscriptionResult[];
  errors: Array<{ segmentIndex: number; error: string }>;
}
```

---

## 2. Logique de transcription Gemini

**`src/lib/audio/transcribeSegments.ts`**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import type {
  AudioSegment,
  TranscriptionResult,
  TranscribeOptions,
  TranscribeBatchResult,
} from "./types";

const DEFAULT_OPTIONS: Required<TranscribeOptions> = {
  model: "gemini-2.0-flash",
  delayBetweenCalls: 1000, // 1s entre chaque appel
  maxRetries: 3,
  prompt:
    "Transcris exactement ce qui est dit dans cet audio en langue fongbe. " +
    "Donne uniquement la transcription brute, sans commentaire, sans ponctuation ajoutée, " +
    "sans traduction. Si tu n'entends rien ou que c'est du silence, réponds: [SILENCE]",
};

/**
 * Attend un délai en ms.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convertit un fichier audio en base64 + mime type pour l'API Gemini.
 */
function audioToGenerativePart(filePath: string) {
  const data = fs.readFileSync(filePath);
  const base64 = data.toString("base64");

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".webm": "audio/webm",
  };

  return {
    inlineData: {
      data: base64,
      mimeType: mimeTypes[ext] || "audio/wav",
    },
  };
}

/**
 * Transcrit un seul segment avec retry.
 */
async function transcribeSingleSegment(
  model: any,
  segment: AudioSegment,
  prompt: string,
  maxRetries: number
): Promise<{ text: string; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const audioPart = audioToGenerativePart(segment.filePath);

      const result = await model.generateContent([audioPart, prompt]);

      const response = result.response;
      const text = response.text().trim();

      if (!text) {
        throw new Error("Réponse vide de Gemini");
      }

      return { text };
    } catch (error: any) {
      console.error(
        `  ❌ Segment ${segment.index} - tentative ${attempt}/${maxRetries}: ${error.message}`
      );

      if (attempt === maxRetries) {
        return { text: "", error: error.message };
      }

      // Attente exponentielle avant retry
      await sleep(2000 * attempt);
    }
  }

  return { text: "", error: "Max retries atteint" };
}

/**
 * Transcrit tous les segments audio via Gemini.
 *
 * @param segments - Liste des segments issus de la Phase 1
 * @param apiKey - Clé API Gemini
 * @param options - Options de transcription
 */
export async function transcribeSegments(
  segments: AudioSegment[],
  apiKey: string,
  options?: TranscribeOptions
): Promise<TranscribeBatchResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: opts.model });

  const transcriptions: TranscriptionResult[] = [];
  const errors: Array<{ segmentIndex: number; error: string }> = [];

  console.log(`\nTranscription de ${segments.length} segments avec ${opts.model}...`);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // Vérifier que le fichier existe
    if (!fs.existsSync(segment.filePath)) {
      errors.push({
        segmentIndex: segment.index,
        error: `Fichier introuvable: ${segment.filePath}`,
      });
      continue;
    }

    console.log(
      `  [${i + 1}/${segments.length}] Segment ${segment.index} (${segment.duration.toFixed(1)}s)...`
    );

    const { text, error } = await transcribeSingleSegment(
      model,
      segment,
      opts.prompt,
      opts.maxRetries
    );

    if (error) {
      errors.push({ segmentIndex: segment.index, error });
    }

    if (text && text !== "[SILENCE]") {
      transcriptions.push({
        segmentId: segment.id,
        segmentIndex: segment.index,
        fileName: segment.fileName,
        geminiText: text,
        duration: segment.duration,
        startTime: segment.startTime,
        endTime: segment.endTime,
      });
      console.log(`    ✅ "${text.substring(0, 60)}..."`);
    } else if (text === "[SILENCE]") {
      console.log(`    ⏭️  Silence détecté, ignoré`);
    }

    // Rate limiting
    if (i < segments.length - 1) {
      await sleep(opts.delayBetweenCalls);
    }
  }

  return {
    total: segments.length,
    succeeded: transcriptions.length,
    failed: errors.length,
    transcriptions,
    errors,
  };
}

/**
 * Sauvegarde les résultats de transcription dans un fichier JSON.
 */
export function saveTranscriptions(
  result: TranscribeBatchResult,
  outputPath: string
): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`\nTranscriptions sauvegardées: ${outputPath}`);
}
```

---

## 3. API Route Next.js

**`src/app/api/audio/transcribe/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { transcribeSegments, saveTranscriptions } from "@/lib/audio/transcribeSegments";
import type { AudioSegment } from "@/lib/audio/types";
import path from "path";
import fs from "fs";

export const maxDuration = 300; // 5 min timeout (pour Vercel, ajuste si self-hosted)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      segmentsDir,     // Chemin vers le dossier contenant les segments wav
      segments,        // Métadonnées des segments (sortie Phase 1)
      model,           // Optionnel: modèle Gemini
      delayBetweenCalls, // Optionnel: délai en ms
    } = body;

    if (!segmentsDir || !segments || !Array.isArray(segments)) {
      return NextResponse.json(
        { error: "segmentsDir et segments sont requis" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY non configurée" },
        { status: 500 }
      );
    }

    // Reconstruire les chemins complets des segments
    const fullSegments: AudioSegment[] = segments.map((s: any) => ({
      ...s,
      filePath: path.join(segmentsDir, s.fileName),
    }));

    // Transcrire
    const result = await transcribeSegments(fullSegments, apiKey, {
      model: model || "gemini-2.0-flash",
      delayBetweenCalls: delayBetweenCalls || 1000,
    });

    // Sauvegarder les résultats
    const outputPath = path.join(segmentsDir, "transcriptions.json");
    saveTranscriptions(result, outputPath);

    return NextResponse.json({
      success: true,
      data: {
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
        transcriptions: result.transcriptions,
        errors: result.errors,
        savedTo: outputPath,
      },
    });
  } catch (error: any) {
    console.error("Erreur transcription:", error);
    return NextResponse.json(
      { error: error.message || "Erreur interne" },
      { status: 500 }
    );
  }
}
```

---

## 4. Usage — Enchaîner Phase 1 → Phase 2

Exemple côté client ou script :

```typescript
// Après Phase 1
const phase1Response = await fetch("/api/audio/split", {
  method: "POST",
  body: formData, // contient le fichier audio
});
const { data: splitData } = await phase1Response.json();

// Phase 2 : transcrire les segments
const phase2Response = await fetch("/api/audio/transcribe", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    segmentsDir: splitData.outputDir,
    segments: splitData.segments,
    model: "gemini-2.0-flash",
    delayBetweenCalls: 1500,
  }),
});
const { data: transcribeData } = await phase2Response.json();

console.log(`Transcrits: ${transcribeData.succeeded}/${transcribeData.total}`);
console.log(transcribeData.transcriptions);
```

---

## Gestion du rate limiting Gemini

| Plan Gemini | Requêtes/min | Stratégie `delayBetweenCalls` |
|---|---|---|
| Gratuit | 15 RPM | `4000` (4s) |
| Pay-as-you-go | 1000 RPM | `100` (0.1s) |
| Intermédiaire | ~60 RPM | `1000` (1s) |

Si tu as ~140 segments avec le plan gratuit (15 RPM), ça prendra environ **40 minutes**. Avec le plan payant, ~3 minutes.

---

## Sortie attendue

```json
{
  "success": true,
  "data": {
    "total": 142,
    "succeeded": 138,
    "failed": 4,
    "transcriptions": [
      {
        "segmentId": "a1b2c3...",
        "segmentIndex": 0,
        "fileName": "segment_0000.wav",
        "geminiText": "Bɔ Mawu ɖɔ nú Ablaxamu ɖɔ",
        "duration": 5.23,
        "startTime": 0.0,
        "endTime": 5.23
      }
    ],
    "errors": [
      { "segmentIndex": 45, "error": "Rate limit exceeded" }
    ]
  }
}
```

> **Prochaine étape →** Phase 3 : Alignement fuzzy matching avec le texte de référence correct.
