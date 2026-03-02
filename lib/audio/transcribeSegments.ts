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
  model: "gemini-3-flash-preview",
  delayBetweenCalls: 1000,
  maxRetries: 3,
  seed: 42,
  prompt:
    "Tu es un linguiste expert spécialisé dans la transcription de la langue fongbe (fɔngbè), " +
    "une langue gbe de la famille kwa parlée principalement au sud du Bénin. " +
    "Tu maîtrises parfaitement le système phonologique, l'orthographe standardisée et la grammaire du fongbe.\n\n" +
    "TÂCHE : Écoute attentivement cet extrait audio et produis une transcription fidèle, mot à mot, " +
    "de ce que le locuteur dit.\n\n" +
    "=== SYSTÈME PHONOLOGIQUE DU FONGBE ===\n" +
    "Voyelles orales : a, e, ɛ, i, o, ɔ, u (7 voyelles)\n" +
    "Voyelles nasales : an, ɛn, in, ɔn, un (les voyelles nasalisées s'écrivent avec 'n' après la voyelle)\n" +
    "Consonnes spécifiques : ɖ (d rétroflexe), gb, kp (consonnes labio-vélaires), ny, hw, xw, sx\n" +
    "Tons : le fongbe est une langue tonale à 2 tons principaux (haut et bas) avec des tons modulés ; " +
    "les accents tonaux ne sont pas toujours marqués dans l'orthographe courante, " +
    "ne les ajoute que s'ils apparaissent dans l'usage standard.\n\n" +
    "=== ORTHOGRAPHE ET CARACTÈRES SPÉCIAUX ===\n" +
    "- Utilise systématiquement ɔ (o ouvert) et ɛ (e ouvert), jamais 'o' ou 'e' à leur place.\n" +
    "- Utilise ɖ (d rétroflexe) et non 'd' quand le son l'exige.\n" +
    "- Les digrammes gb, kp, hw, xw, ny comptent chacun comme un seul phonème.\n" +
    "- Les mots fongbe courants : Mawu (Dieu), ɖɔ (dire), nú (pour/chose), " +
    "sín (de/depuis), jí (sur), mɛ (personne/dans), é (il/elle), yé (ils/elles), " +
    "ɖò (être à), wá (venir), yì (aller), ná (donner/futur), kpó...kpó (et...et), " +
    "bɔ (et/alors), ɖé (un/quelque), lɛ (pluriel), tɔn (son/sa), ce (mon/ma), " +
    "towe (ton/ta), gbɛ̀ (vie/monde), axɔ́sú (roi), xwé (maison), nyi (être/je), " +
    "wɛ (c'est), ka (particule interrogative/emphatique).\n\n" +
    "=== CONTEXTE DU CORPUS ===\n" +
    "L'audio provient probablement d'un texte religieux (Bible) ou d'un récit en fongbe. " +
    "Tu peux t'attendre à des noms propres bibliques (Ablaxamu/Abraham, Izaki/Isaac, " +
    "Jakɔbu/Jacob, Mɔyizi/Moïse, Jezu/Jésus, Izlayɛli/Israël, etc.), " +
    "des termes théologiques et du vocabulaire narratif. " +
    "Transcris les noms propres dans leur forme fongbe standard.\n\n" +
    "=== RÈGLES DE TRANSCRIPTION STRICTES ===\n" +
    "1. Écris UNIQUEMENT en fongbe. Ne traduis rien en français, anglais ou toute autre langue.\n" +
    "2. Transcris mot à mot, fidèlement à ce qui est prononcé. Ne reformule pas, ne corrige pas la grammaire.\n" +
    "3. Respecte les pauses naturelles du locuteur : utilise la virgule (,) pour les pauses courtes " +
    "et le point (.) pour les pauses longues ou fins de phrases.\n" +
    "4. Conserve les répétitions si le locuteur répète un mot ou une expression.\n" +
    "5. N'ajoute AUCUN commentaire, explication, note, titre, numérotation, mise en forme, " +
    "balise markdown, guillemet, ou métadonnée.\n" +
    "6. Ne préfixe pas ta réponse avec des mots comme « Transcription : » ou « Voici : ».\n" +
    "7. Si un mot est difficile à identifier, transcris ta meilleure approximation phonétique " +
    "en respectant l'orthographe fongbe.\n" +
    "8. Si l'audio ne contient que du silence, un souffle, de la musique sans parole, " +
    "ou un bruit ambiant sans discours intelligible, réponds UNIQUEMENT : [SILENCE]\n" +
    "9. Retourne la transcription brute seule, rien d'autre.\n\n" +
    "IMPORTANT : Ta réponse doit contenir EXCLUSIVEMENT le texte fongbe transcrit ou [SILENCE]. " +
    "Aucun autre contenu n'est accepté.",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function transcribeSingleSegment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  segment: AudioSegment,
  prompt: string,
  maxRetries: number,
  seed: number
): Promise<{ text: string; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const audioPart = audioToGenerativePart(segment.filePath);
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [audioPart, { text: prompt }] }],
        generationConfig: { seed },
      });
      const response = result.response;
      const text = response.text().trim();

      if (!text) {
        throw new Error("Réponse vide de Gemini");
      }

      return { text };
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error(
        `  ❌ Segment ${segment.index} - tentative ${attempt}/${maxRetries}: ${err.message}`
      );

      if (attempt === maxRetries) {
        return { text: "", error: err.message || "Erreur inconnue" };
      }

      await sleep(2000 * attempt);
    }
  }

  return { text: "", error: "Max retries atteint" };
}

/**
 * Transcrit un seul segment audio via Gemini.
 */
export async function transcribeOneSegment(
  segment: AudioSegment,
  apiKey: string,
  options?: TranscribeOptions
): Promise<TranscriptionResult | { error: string }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: opts.model });

  if (!fs.existsSync(segment.filePath)) {
    return { error: `Fichier introuvable: ${segment.filePath}` };
  }

  const { text, error } = await transcribeSingleSegment(
    model,
    segment,
    opts.prompt,
    opts.maxRetries,
    opts.seed
  );

  if (error || !text || text === "[SILENCE]") {
    return { error: error || "Silence détecté" };
  }

  return {
    segmentId: segment.id,
    segmentIndex: segment.index,
    fileName: segment.fileName,
    geminiText: text,
    duration: segment.duration,
    startTime: segment.startTime,
    endTime: segment.endTime,
  };
}

/**
 * Transcrit tous les segments audio via Gemini.
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

  console.log(
    `\nTranscription de ${segments.length} segments avec ${opts.model}...`
  );

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

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
      opts.maxRetries,
      opts.seed
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
