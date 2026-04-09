import { NextRequest, NextResponse } from "next/server";

// ============================================================
// ASR — endpoint déployé (POST multipart/form-data)
// Entrée : FormData avec un champ "audio" (Blob webm/wav/ogg)
// Sortie : { transcription: string }
// ============================================================

const DEFAULT_ASR_URL = "https://asr.pscl.space/transcribe";
const LOCAL_ASR_URLS = ["http://127.0.0.1:8000/transcribe", "http://localhost:8000/transcribe"];
const ASR_FETCH_TIMEOUT_MS = Number.parseInt(process.env.ASR_FETCH_TIMEOUT_MS || "300000", 10);
const ASR_ENABLE_LOCAL_FALLBACK =
  (process.env.ASR_ENABLE_LOCAL_FALLBACK || "false").toLowerCase() === "true";

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  return "webm";
}

function extractTranscription(payload: unknown): string | null {
  if (typeof payload === "string") return payload;

  if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;

    if (typeof data.transcription === "string") return data.transcription;
    if (typeof data.text === "string") return data.text;
    if (typeof data.transcript === "string") return data.transcript;
  }

  return null;
}

function normalizeAsrUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/transcribe";
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function getAsrUrlCandidates(): string[] {
  const fromList = (process.env.ASR_API_URLS || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  const fromSingle = process.env.ASR_API_URL?.trim();
  const configured = fromList.length > 0 ? fromList : fromSingle ? [fromSingle] : [DEFAULT_ASR_URL];

  const localFallbacks = ASR_ENABLE_LOCAL_FALLBACK ? LOCAL_ASR_URLS : [];
  const all = [...configured, ...localFallbacks].map(normalizeAsrUrl);
  return [...new Set(all)];
}

function buildUpstreamFormData(audioFile: Blob, fileName: string): FormData {
  const upstreamFormData = new FormData();
  // L'API distante attend explicitement le champ "file".
  upstreamFormData.append("file", audioFile, fileName);
  // Champ additionnel de compatibilité si l'upstream accepte aussi "audio".
  upstreamFormData.append("audio", audioFile, fileName);
  return upstreamFormData;
}

function getFetchErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const cause = (err as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as Blob | null;

    if (!audioFile) {
      return NextResponse.json({ error: "Aucun fichier audio fourni." }, { status: 400 });
    }

    const incomingName = "name" in audioFile && typeof audioFile.name === "string" ? audioFile.name : "";
    const fallbackName = `recording.${extensionFromMimeType(audioFile.type || "")}`;
    const fileName = incomingName || fallbackName;

    const asrUrlCandidates = getAsrUrlCandidates();
    let asrRes: Response | null = null;
    let lastNetworkError: string | null = null;

    for (let i = 0; i < asrUrlCandidates.length; i += 1) {
      const asrUrl = asrUrlCandidates[i];

      try {
        const requestInit: RequestInit = {
          method: "POST",
          body: buildUpstreamFormData(audioFile, fileName),
        };

        if (Number.isFinite(ASR_FETCH_TIMEOUT_MS) && ASR_FETCH_TIMEOUT_MS > 0) {
          requestInit.signal = AbortSignal.timeout(ASR_FETCH_TIMEOUT_MS);
        }

        const response = await fetch(asrUrl, {
          ...requestInit,
        });

        if (!response.ok) {
          const errText = await response.text();
          const canRetry = response.status >= 500 && i < asrUrlCandidates.length - 1;

          console.error("[ASR] Upstream error:", response.status, errText, "url=", asrUrl);

          if (canRetry) {
            continue;
          }

          return NextResponse.json(
            { error: `Erreur ASR distante ${response.status}: ${errText.slice(0, 200)}` },
            { status: 502 }
          );
        }

        asrRes = response;
        break;
      } catch (err) {
        const errCode = getFetchErrorCode(err);
        lastNetworkError =
          errCode === "EAI_AGAIN"
            ? `EAI_AGAIN (DNS temporairement indisponible) sur ${asrUrl}`
            : err instanceof Error && err.name === "TimeoutError"
              ? `Timeout apres ${ASR_FETCH_TIMEOUT_MS}ms sur ${asrUrl}`
            : `${asrUrl}: ${err instanceof Error ? err.message : "fetch failed"}`;
        console.error("[ASR] Upstream fetch failed:", lastNetworkError);
      }
    }

    if (!asrRes) {
      return NextResponse.json(
        {
          error:
            "Impossible de joindre le service ASR. " +
            (lastNetworkError || "Aucune URL ASR repondante.") +
            " Configure ASR_API_URL (ex: http://127.0.0.1:8000/transcribe).",
        },
        { status: 503 }
      );
    }

    const upstreamContentType = asrRes.headers.get("content-type") || "";
    let transcription = "";

    if (upstreamContentType.includes("application/json")) {
      const data = await asrRes.json();

      if (data && typeof data === "object" && "error" in data) {
        const apiError = (data as { error?: unknown }).error;
        if (typeof apiError === "string") {
          return NextResponse.json({ error: apiError }, { status: 503 });
        }
      }

      const extracted = extractTranscription(data);
      if (!extracted) {
        return NextResponse.json(
          { error: "Réponse ASR invalide: transcription introuvable." },
          { status: 502 }
        );
      }

      transcription = extracted;
    } else {
      const rawText = (await asrRes.text()).trim();

      if (!rawText) {
        return NextResponse.json(
          { error: "Réponse ASR vide." },
          { status: 502 }
        );
      }

      try {
        const asJson = JSON.parse(rawText) as unknown;
        transcription = extractTranscription(asJson) ?? rawText;
      } catch {
        transcription = rawText;
      }
    }

    return NextResponse.json({ transcription });
  } catch (err) {
    console.error("[ASR] Erreur :", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne du serveur ASR." },
      { status: 500 }
    );
  }
}
