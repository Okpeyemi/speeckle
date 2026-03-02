import { NextRequest, NextResponse } from "next/server";
import { splitAudio } from "@/lib/audio/splitAudio";
import path from "path";
import fs from "fs";

// Serverless max execution time (seconds)
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const silenceThreshold = formData.get("silenceThreshold") as string | null;
    const silenceDuration = formData.get("silenceDuration") as string | null;
    const minSegDur = formData.get("minDuration") as string | null;
    const maxSegDur = formData.get("maxDuration") as string | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: "Aucun fichier audio fourni" },
        { status: 400 }
      );
    }

    const tempDir = path.join(process.cwd(), "tmp");
    fs.mkdirSync(tempDir, { recursive: true });

    const ext = audioFile.name.split(".").pop() || "bin";
    const inputPath = path.join(tempDir, `input_${Date.now()}.${ext}`);
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);

    const outputDir = path.join(
      process.cwd(),
      "output",
      "segments",
      `session_${Date.now()}`
    );

    const result = await splitAudio(inputPath, outputDir, {
      silenceThreshold: silenceThreshold || "-30dB",
      silenceDuration:  silenceDuration  ? parseFloat(silenceDuration)  : 0.3,
      minSegmentDuration: minSegDur ? parseFloat(minSegDur) : 3,
      maxSegmentDuration: maxSegDur ? parseFloat(maxSegDur) : 9,
    });

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
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error("Erreur découpage:", error);
    return NextResponse.json(
      { error: err.message || "Erreur interne" },
      { status: 500 }
    );
  }
}
