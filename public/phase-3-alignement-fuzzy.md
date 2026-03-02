# Phase 3 — Alignement Fuzzy avec le Texte de Référence

## Objectif

Prendre les transcriptions Gemini (approximatives) de la Phase 2 et les **aligner** avec le texte de référence correct (fichier `.txt` de la Bible en fongbe). Chaque segment audio obtient ainsi sa transcription exacte.

---

## Prérequis

```bash
npm install fastest-levenshtein
```

---

## Structure des fichiers

```
src/
├── app/
│   └── api/
│       └── audio/
│           ├── split/route.ts           # Phase 1
│           ├── transcribe/route.ts      # Phase 2
│           └── align/route.ts           # Phase 3 ← nouveau
├── lib/
│   └── audio/
│       ├── splitAudio.ts                # Phase 1
│       ├── transcribeSegments.ts        # Phase 2
│       ├── alignTranscriptions.ts       # Phase 3 ← nouveau
│       └── types.ts                     # Types (mis à jour)
```

---

## 1. Mettre à jour les types

**Ajouter dans `src/lib/audio/types.ts`**

```typescript
// ... types Phase 1 & 2 existants ...

export interface AlignedSegment {
  segmentId: string;
  segmentIndex: number;
  fileName: string;
  /** Timestamps audio */
  startTime: number;
  endTime: number;
  duration: number;
  /** Transcription Gemini (approximative) */
  geminiText: string;
  /** Transcription de référence alignée (correcte) */
  referenceText: string;
  /** Score de confiance de l'alignement (0-1) */
  matchScore: number;
  /** Position dans le texte de référence (indices des mots) */
  refWordStart: number;
  refWordEnd: number;
}

export interface AlignmentResult {
  totalSegments: number;
  alignedSegments: number;
  averageScore: number;
  lowConfidenceCount: number; // score < 0.4
  segments: AlignedSegment[];
  /** Portions du texte de référence non couvertes */
  uncoveredText: string[];
}

export interface AlignOptions {
  /** Score minimum pour considérer un alignement valide */
  minConfidence?: number;
  /** Marge de recherche en nombre de mots avant/après la position attendue */
  searchMargin?: number;
  /** Variation de taille de fenêtre par rapport à la taille Gemini */
  windowSizeVariation?: number;
}
```

---

## 2. Logique d'alignement

**`src/lib/audio/alignTranscriptions.ts`**

```typescript
import { distance as levenshtein } from "fastest-levenshtein";
import type {
  TranscriptionResult,
  AlignedSegment,
  AlignmentResult,
  AlignOptions,
} from "./types";

const DEFAULT_OPTIONS: Required<AlignOptions> = {
  minConfidence: 0.4,
  searchMargin: 25,
  windowSizeVariation: 5,
};

/**
 * Normalise un texte pour la comparaison :
 * - minuscules
 * - supprime la ponctuation
 * - normalise les espaces
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:!?'"()\[\]{}\-–—…«»""'']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calcule un score de similarité entre deux chaînes (0-1).
 * Basé sur la distance de Levenshtein normalisée.
 */
function similarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);

  if (normA === normB) return 1;
  if (!normA || !normB) return 0;

  const maxLen = Math.max(normA.length, normB.length);
  const dist = levenshtein(normA, normB);

  return 1 - dist / maxLen;
}

/**
 * Algorithme principal d'alignement par fenêtre glissante.
 *
 * Pour chaque transcription Gemini, on cherche dans le texte de référence
 * la sous-séquence de mots qui maximise la similarité.
 *
 * On avance séquentiellement dans le texte de référence (le curseur avance
 * après chaque match trouvé), ce qui exploite le fait que l'audio et le
 * texte sont dans le même ordre.
 */
export function alignTranscriptions(
  transcriptions: TranscriptionResult[],
  referenceText: string,
  options?: AlignOptions
): AlignmentResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Découper le texte de référence en mots
  const refWords = referenceText.split(/\s+/).filter((w) => w.length > 0);
  const totalRefWords = refWords.length;

  const aligned: AlignedSegment[] = [];
  let cursor = 0; // Position courante dans le texte de référence

  console.log(`\nAlignement de ${transcriptions.length} segments sur ${totalRefWords} mots de référence...\n`);

  for (const trans of transcriptions) {
    const geminiWords = trans.geminiText.split(/\s+/).filter((w) => w.length > 0);
    const geminiWordCount = geminiWords.length;

    if (geminiWordCount === 0) {
      aligned.push({
        segmentId: trans.segmentId,
        segmentIndex: trans.segmentIndex,
        fileName: trans.fileName,
        startTime: trans.startTime,
        endTime: trans.endTime,
        duration: trans.duration,
        geminiText: trans.geminiText,
        referenceText: "",
        matchScore: 0,
        refWordStart: cursor,
        refWordEnd: cursor,
      });
      continue;
    }

    let bestScore = 0;
    let bestStart = cursor;
    let bestEnd = cursor + geminiWordCount;

    // Zone de recherche : autour du curseur actuel
    const searchStart = Math.max(0, cursor - opts.searchMargin);
    const searchEnd = Math.min(
      totalRefWords,
      cursor + geminiWordCount * 3 + opts.searchMargin
    );

    // Tester différentes tailles de fenêtre
    const minWindowSize = Math.max(1, geminiWordCount - opts.windowSizeVariation);
    const maxWindowSize = geminiWordCount + opts.windowSizeVariation;

    for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize++) {
      for (let i = searchStart; i <= searchEnd - windowSize; i++) {
        const candidate = refWords.slice(i, i + windowSize).join(" ");
        const score = similarity(trans.geminiText, candidate);

        if (score > bestScore) {
          bestScore = score;
          bestStart = i;
          bestEnd = i + windowSize;
        }
      }
    }

    const matchedText = refWords.slice(bestStart, bestEnd).join(" ");

    aligned.push({
      segmentId: trans.segmentId,
      segmentIndex: trans.segmentIndex,
      fileName: trans.fileName,
      startTime: trans.startTime,
      endTime: trans.endTime,
      duration: trans.duration,
      geminiText: trans.geminiText,
      referenceText: matchedText,
      matchScore: parseFloat(bestScore.toFixed(4)),
      refWordStart: bestStart,
      refWordEnd: bestEnd,
    });

    // Avancer le curseur
    cursor = bestEnd;

    // Log
    const icon = bestScore >= 0.6 ? "✅" : bestScore >= 0.4 ? "⚠️" : "❌";
    console.log(
      `  ${icon} [${trans.segmentIndex}] score=${bestScore.toFixed(2)} | ` +
      `Gemini: "${trans.geminiText.substring(0, 40)}..." → ` +
      `Réf: "${matchedText.substring(0, 40)}..."`
    );
  }

  // Calculer les stats
  const scores = aligned.map((a) => a.matchScore);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const lowConf = aligned.filter((a) => a.matchScore < opts.minConfidence);

  // Détecter les portions de texte non couvertes
  const coveredRanges = aligned
    .filter((a) => a.matchScore >= opts.minConfidence)
    .map((a) => ({ start: a.refWordStart, end: a.refWordEnd }));

  const uncovered: string[] = [];
  let lastEnd = 0;
  for (const range of coveredRanges) {
    if (range.start > lastEnd) {
      uncovered.push(refWords.slice(lastEnd, range.start).join(" "));
    }
    lastEnd = Math.max(lastEnd, range.end);
  }
  if (lastEnd < totalRefWords) {
    uncovered.push(refWords.slice(lastEnd).join(" "));
  }

  return {
    totalSegments: transcriptions.length,
    alignedSegments: aligned.filter((a) => a.matchScore >= opts.minConfidence).length,
    averageScore: parseFloat(avgScore.toFixed(4)),
    lowConfidenceCount: lowConf.length,
    segments: aligned,
    uncoveredText: uncovered,
  };
}

/**
 * Exporte le dataset final au format utilisable pour le fine-tuning / TTS.
 */
export function exportDataset(
  alignment: AlignmentResult,
  minConfidence: number = 0.4
): Array<{
  audio: string;
  text: string;
  duration: number;
  confidence: number;
}> {
  return alignment.segments
    .filter((s) => s.matchScore >= minConfidence && s.referenceText.length > 0)
    .map((s) => ({
      audio: s.fileName,
      text: s.referenceText,
      duration: s.duration,
      confidence: s.matchScore,
    }));
}
```

---

## 3. API Route Next.js

**`src/app/api/audio/align/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  alignTranscriptions,
  exportDataset,
} from "@/lib/audio/alignTranscriptions";
import type { TranscriptionResult } from "@/lib/audio/types";
import fs from "fs";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      transcriptions,  // Sortie Phase 2 : TranscriptionResult[]
      referenceText,   // Texte complet de référence (string)
      referenceFile,   // OU chemin vers le fichier .txt
      minConfidence,
      outputDir,       // Où sauvegarder le dataset final
    } = body;

    if (!transcriptions || (!referenceText && !referenceFile)) {
      return NextResponse.json(
        { error: "transcriptions et referenceText (ou referenceFile) sont requis" },
        { status: 400 }
      );
    }

    // Charger le texte de référence
    let refText = referenceText;
    if (!refText && referenceFile) {
      refText = fs.readFileSync(referenceFile, "utf-8").trim();
    }

    // Aligner
    const alignment = alignTranscriptions(
      transcriptions as TranscriptionResult[],
      refText,
      { minConfidence: minConfidence || 0.4 }
    );

    // Exporter le dataset
    const dataset = exportDataset(alignment, minConfidence || 0.4);

    // Sauvegarder si outputDir fourni
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });

      // Dataset complet avec toutes les métadonnées
      fs.writeFileSync(
        path.join(outputDir, "alignment_full.json"),
        JSON.stringify(alignment, null, 2),
        "utf-8"
      );

      // Dataset propre pour fine-tuning
      fs.writeFileSync(
        path.join(outputDir, "dataset.json"),
        JSON.stringify(dataset, null, 2),
        "utf-8"
      );

      // Format TSV (compatible avec beaucoup d'outils TTS/ASR)
      const tsv = dataset
        .map((d) => `${d.audio}\t${d.text}\t${d.duration}\t${d.confidence}`)
        .join("\n");
      fs.writeFileSync(
        path.join(outputDir, "dataset.tsv"),
        `audio\ttext\tduration\tconfidence\n${tsv}`,
        "utf-8"
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        totalSegments: alignment.totalSegments,
        alignedSegments: alignment.alignedSegments,
        averageScore: alignment.averageScore,
        lowConfidenceCount: alignment.lowConfidenceCount,
        datasetSize: dataset.length,
        segments: alignment.segments,
        uncoveredText: alignment.uncoveredText,
        dataset,
      },
    });
  } catch (error: any) {
    console.error("Erreur alignement:", error);
    return NextResponse.json(
      { error: error.message || "Erreur interne" },
      { status: 500 }
    );
  }
}
```

---

## 4. Pipeline complet — Enchaîner les 3 phases

```typescript
async function runFullPipeline(audioFile: File, referenceTextFile: File) {
  // ===== PHASE 1 : Découpage =====
  const splitForm = new FormData();
  splitForm.append("audio", audioFile);
  splitForm.append("silenceThreshold", "-40dB");
  splitForm.append("minDuration", "3");
  splitForm.append("maxDuration", "8");

  const splitRes = await fetch("/api/audio/split", {
    method: "POST",
    body: splitForm,
  });
  const { data: splitData } = await splitRes.json();
  console.log(`Phase 1: ${splitData.segmentCount} segments créés`);

  // ===== PHASE 2 : Transcription Gemini =====
  const transcribeRes = await fetch("/api/audio/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      segmentsDir: splitData.outputDir,
      segments: splitData.segments,
      model: "gemini-2.0-flash",
      delayBetweenCalls: 1500,
    }),
  });
  const { data: transcribeData } = await transcribeRes.json();
  console.log(`Phase 2: ${transcribeData.succeeded}/${transcribeData.total} transcrits`);

  // ===== PHASE 3 : Alignement =====
  const referenceText = await referenceTextFile.text();

  const alignRes = await fetch("/api/audio/align", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcriptions: transcribeData.transcriptions,
      referenceText,
      outputDir: splitData.outputDir,
      minConfidence: 0.4,
    }),
  });
  const { data: alignData } = await alignRes.json();

  console.log(`Phase 3: ${alignData.alignedSegments}/${alignData.totalSegments} alignés`);
  console.log(`Score moyen: ${alignData.averageScore}`);
  console.log(`À vérifier: ${alignData.lowConfidenceCount} segments`);

  return alignData;
}
```

---

## 5. Comprendre et interpréter les résultats

### Scores de confiance

| Score | Signification | Action |
|---|---|---|
| **0.8 - 1.0** | Excellent match | ✅ Aucune action |
| **0.6 - 0.8** | Bon match | ✅ Probablement correct |
| **0.4 - 0.6** | Match partiel | ⚠️ Vérifier manuellement |
| **< 0.4** | Mauvais match | ❌ Rejeter ou corriger à la main |

### Cas problématiques courants

1. **Gemini hallucine** → Le segment audio est du bruit/musique que Gemini interprète comme du texte. Solution : filtrer les segments très courts ou avec un volume moyen faible.

2. **Décalage progressif** → Si un segment est mal aligné, tous les suivants se décalent. Le curseur séquentiel aide, mais si le problème persiste, augmente `searchMargin`.

3. **Texte de référence incomplet** → Si l'audio contient des parties absentes du texte (intro, outro, commentaires), ces segments auront un score bas. C'est normal.

---

## 6. Sortie finale

**`dataset.json`** — Format propre pour fine-tuning :

```json
[
  {
    "audio": "segment_0000.wav",
    "text": "Bɔ Mawu ɖɔ nú Ablaxamu ɖɔ",
    "duration": 5.23,
    "confidence": 0.87
  },
  {
    "audio": "segment_0001.wav",
    "text": "a ni jɛ tɔn sín ayikúngban jí",
    "duration": 4.12,
    "confidence": 0.79
  }
]
```

**`dataset.tsv`** — Format tabulaire :

```
audio	text	duration	confidence
segment_0000.wav	Bɔ Mawu ɖɔ nú Ablaxamu ɖɔ	5.23	0.87
segment_0001.wav	a ni jɛ tɔn sín ayikúngban jí	4.12	0.79
```

---

## Conseils d'optimisation

- **Si les scores sont globalement bas** : essaie `gemini-2.0-pro` au lieu de `flash` pour une meilleure transcription fongbe.
- **Si le texte de référence a des versets numérotés** (ex: "1. ...", "2. ..."), retire les numéros avant l'alignement pour ne pas fausser le matching.
- **Pour un dataset de meilleure qualité**, ne garde que les segments avec `confidence >= 0.6`.
