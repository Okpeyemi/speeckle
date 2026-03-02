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
      transcriptions,
      referenceText,
      referenceFile,
      minConfidence,
      outputDir,
    } = body;

    if (!transcriptions || (!referenceText && !referenceFile)) {
      return NextResponse.json(
        {
          error:
            "transcriptions et referenceText (ou referenceFile) sont requis",
        },
        { status: 400 }
      );
    }

    // Clé API Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY non configurée" },
        { status: 500 }
      );
    }

    // Charger le texte de référence
    let refText: string = referenceText;
    if (!refText && referenceFile) {
      refText = fs.readFileSync(referenceFile, "utf-8").trim();
    }

    // Aligner (hybride IA + algo)
    const alignment = await alignTranscriptions(
      transcriptions as TranscriptionResult[],
      refText,
      apiKey,
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
        .map(
          (d) => `${d.audio}\t${d.text}\t${d.duration}\t${d.confidence}`
        )
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
  } catch (error: unknown) {
    console.error("Erreur alignement:", error);
    const message =
      error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
