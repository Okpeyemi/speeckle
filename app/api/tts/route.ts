import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ============================================================
// TTS — endpoint dedie ou fallback HuggingFace Router
// Entrée : { text_fon: string }
// Sortie : audio/flac (stream binaire)
// ============================================================

const DEFAULT_MODEL_ID = "facebook/mms-tts-fon";
const DEFAULT_HF_INFERENCE_BASE_URL = "https://router.huggingface.co/hf-inference/models";

async function readEnvLocalOverrides(): Promise<Record<string, string>> {
  try {
    const envPath = join(process.cwd(), ".env.local");
    const content = await readFile(envPath, "utf8");
    const overrides: Record<string, string> = {};

    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eqIndex = line.indexOf("=");
      if (eqIndex <= 0) continue;

      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1).trim();
      if (key) overrides[key] = value;
    }

    return overrides;
  } catch {
    return {};
  }
}

async function isModelAvailableOnServerless(modelId: string): Promise<boolean | null> {
  try {
    const metadataUrl =
      `https://huggingface.co/api/models/${encodeURIComponent(modelId)}` +
      "?expand[]=inferenceProviderMapping";
    const metadataRes = await fetch(metadataUrl, { cache: "no-store" });
    if (!metadataRes.ok) return null;

    const metadata = await metadataRes.json() as {
      inferenceProviderMapping?: Record<string, unknown>;
    };
    const mapping = metadata.inferenceProviderMapping;
    if (!mapping || typeof mapping !== "object") return false;
    return Object.keys(mapping).length > 0;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { text_fon } = (await req.json()) as { text_fon: string };

    if (!text_fon || text_fon.trim() === "") {
      return NextResponse.json({ error: "Texte Fon manquant." }, { status: 400 });
    }

    const envOverrides = await readEnvLocalOverrides();
    const modelId = envOverrides.TTS_MODEL_ID || process.env.TTS_MODEL_ID || DEFAULT_MODEL_ID;
    const hfToken = envOverrides.HF_TOKEN || process.env.HF_TOKEN;
    const hfInferenceBaseUrl =
      envOverrides.HF_INFERENCE_BASE_URL ||
      process.env.HF_INFERENCE_BASE_URL ||
      DEFAULT_HF_INFERENCE_BASE_URL;
    const ttsApiUrl = (envOverrides.TTS_API_URL || process.env.TTS_API_URL || "").trim();

    if (ttsApiUrl) {
      const customRes = await fetch(ttsApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text_fon }),
      });

      if (customRes.ok) {
        const customContentType = customRes.headers.get("content-type") || "";

        if (customContentType.includes("audio/")) {
          const audioBuffer = await customRes.arrayBuffer();
          return new NextResponse(audioBuffer, {
            headers: {
              "Content-Type": customContentType,
              "Cache-Control": "no-store",
            },
          });
        }

        const customData = await customRes.json();
        if (typeof customData?.audio_base64 === "string") {
          return NextResponse.json(customData);
        }
      } else {
        const customErr = await customRes.text();
        console.error("[TTS] Custom API error:", customRes.status, customErr);

        // Si un endpoint dedie est configure, on renvoie son erreur telle quelle.
        return NextResponse.json(
          { error: `Erreur TTS distante ${customRes.status}: ${customErr.slice(0, 200)}` },
          { status: 502 }
        );
      }
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (hfToken) headers.Authorization = `Bearer ${hfToken}`;
    const payload = JSON.stringify({ inputs: text_fon });
    const encodedModelId = encodeURIComponent(modelId);

    let hfRes = await fetch(`${hfInferenceBaseUrl}/${encodedModelId}`, {
      method: "POST",
      headers,
      body: payload,
    });

    // Compatibilite: certains routers acceptent encore le model id non encode.
    if (hfRes.status === 404 && encodedModelId !== modelId) {
      hfRes = await fetch(`${hfInferenceBaseUrl}/${modelId}`, {
        method: "POST",
        headers,
        body: payload,
      });
    }

    if (!hfRes.ok) {
      const errText = await hfRes.text();
      console.error("[TTS] HF error:", hfRes.status, errText);

      if (hfRes.status === 404) {
        const serverlessAvailable = await isModelAvailableOnServerless(modelId);
        if (serverlessAvailable === false) {
          return NextResponse.json(
            {
              error:
                `Le modele ${modelId} n'est pas expose via l'inference serverless Hugging Face Router. ` +
                "Solution: deployer un endpoint dedie pour ce modele et configurer TTS_API_URL.",
            },
            { status: 503 }
          );
        }
      }

      return NextResponse.json(
        { error: `Erreur HuggingFace ${hfRes.status}: ${errText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const contentType = hfRes.headers.get("content-type") || "";

    // HF renvoie généralement audio/flac pour MMS-TTS
    if (contentType.includes("audio/")) {
      const audioBuffer = await hfRes.arrayBuffer();
      return new NextResponse(audioBuffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    // Cas où HF renvoie du JSON (erreur ou modèle en cours de chargement)
    const data = await hfRes.json();
    if (data.error) {
      return NextResponse.json(
        { error: data.error, estimated_time: data.estimated_time },
        { status: 503 }
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[TTS] Erreur :", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne du serveur TTS." },
      { status: 500 }
    );
  }
}
