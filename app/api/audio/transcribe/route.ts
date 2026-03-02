import { NextRequest, NextResponse } from "next/server";
import {
  transcribeSegments,
  transcribeOneSegment,
  saveTranscriptions,
} from "@/lib/audio/transcribeSegments";
import type { AudioSegment } from "@/lib/audio/types";
import path from "path";

export const maxDuration = 300;

/**
 * POST /api/audio/transcribe
 *
 * Body JSON :
 *   - mode: "all" | "single"
 *   - segmentsDir: string (chemin vers le dossier des segments wav)
 *   - segments: AudioSegment[]  (pour mode "all")
 *   - segment: AudioSegment     (pour mode "single")
 *   - model?: string
 *   - delayBetweenCalls?: number
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY non configurée dans .env.local" },
        { status: 500 }
      );
    }

    const {
      mode = "all",
      segmentsDir,
      segments,
      segment,
      model,
      delayBetweenCalls,
    } = body;

    if (!segmentsDir) {
      return NextResponse.json(
        { error: "segmentsDir est requis" },
        { status: 400 }
      );
    }

    const opts = {
      model: model || "gemini-3-flash-preview",
      delayBetweenCalls: delayBetweenCalls || 1000,
    };

    // ── Single segment transcription ──
    if (mode === "single") {
      if (!segment) {
        return NextResponse.json(
          { error: "segment est requis en mode single" },
          { status: 400 }
        );
      }

      const fullSegment: AudioSegment = {
        ...segment,
        filePath: path.join(segmentsDir, segment.fileName),
      };

      const result = await transcribeOneSegment(fullSegment, apiKey, opts);

      if ("error" in result) {
        return NextResponse.json({
          success: false,
          error: result.error,
          segmentIndex: segment.index,
        });
      }

      return NextResponse.json({
        success: true,
        data: result,
      });
    }

    // ── All segments transcription ──
    if (!segments || !Array.isArray(segments)) {
      return NextResponse.json(
        { error: "segments (array) est requis en mode all" },
        { status: 400 }
      );
    }

    const fullSegments: AudioSegment[] = segments.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => ({
        ...s,
        filePath: path.join(segmentsDir, s.fileName),
      })
    );

    const result = await transcribeSegments(fullSegments, apiKey, opts);

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
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error("Erreur transcription:", error);
    return NextResponse.json(
      { error: err.message || "Erreur interne" },
      { status: 500 }
    );
  }
}
