import { GoogleGenerativeAI } from "@google/generative-ai";
import { distance as levenshtein } from "fastest-levenshtein";
import type {
  TranscriptionResult,
  AlignedSegment,
  AlignmentResult,
  AlignOptions,
} from "./types";

const DEFAULT_OPTIONS: Required<AlignOptions> = {
  minConfidence: 0.3,
  searchMargin: 80,
  windowSizeVariation: 10,
};

// ─── Normalisation ──────────────────────────────────────────────────────────

function normalizeWord(w: string): string {
  return w
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,;:!?'"()\[\]{}\-–—…«»""''\/\\]/g, "")
    .replace(/\d+/g, "")
    .trim();
}

function normalizePhrase(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,;:!?'"()\[\]{}\-–—…«»""''\/\\]/g, " ")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Localisation du texte AI dans la fenêtre de référence ──────────────────

/**
 * Retrouve la position exacte (indices de mots) d'un texte retourné par l'IA
 * dans la fenêtre de référence. On utilise une approche par phrase normalisée
 * (substring match) puis on affine par indices de mots.
 */
function locateInWindow(
  aiMatch: string,
  refWords: string[],
  windowStart: number,
  windowEnd: number
): { start: number; end: number; score: number } | null {
  const aiNorm = normalizePhrase(aiMatch);
  const aiWordCount = aiNorm.split(/\s+/).filter((w) => w.length > 0).length;

  if (aiNorm.length === 0 || aiWordCount === 0) return null;

  let bestStart = -1;
  let bestEnd = -1;
  let bestScore = 0;

  // Essayer chaque position de départ dans la fenêtre
  for (let i = windowStart; i < windowEnd; i++) {
    // Essayer des longueurs de fenêtre autour de aiWordCount
    const minLen = Math.max(1, aiWordCount - 3);
    const maxLen = Math.min(windowEnd - i, aiWordCount + 3);

    for (let len = minLen; len <= maxLen; len++) {
      const candidate = refWords.slice(i, i + len).join(" ");
      const candNorm = normalizePhrase(candidate);

      if (candNorm.length === 0) continue;

      // Score par Levenshtein normalisé sur les phrases
      const maxPhraseLen = Math.max(aiNorm.length, candNorm.length);
      const dist = levenshtein(aiNorm, candNorm);
      const similarity = 1 - dist / maxPhraseLen;

      if (similarity > bestScore) {
        bestScore = similarity;
        bestStart = i;
        bestEnd = i + len;
      }
    }
  }

  if (bestScore >= 0.4 && bestStart >= 0) {
    return { start: bestStart, end: bestEnd, score: bestScore };
  }

  return null;
}

// ─── Appel IA pour l'alignement ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ALIGN_PROMPT = `Tu es un expert en fongbe (fɔngbè), une langue tonale parlée principalement au Bénin. Tu maîtrises parfaitement sa phonologie, sa morphologie et ses variations dialectales.

On te donne deux éléments :
1. Une TRANSCRIPTION AUDIO : retranscription approximative d'un segment audio, produite par un moteur ASR. Elle peut contenir des erreurs phonétiques, des mots mal découpés, des homophones incorrects, des tons omis, ou des syllabes manquantes.
2. Un EXTRAIT DE RÉFÉRENCE : portion du texte officiel et correct, qui couvre la zone temporelle approximative du segment audio.

Ta tâche : identifier dans l'EXTRAIT DE RÉFÉRENCE la séquence de mots qui correspond au contenu prononcé dans la TRANSCRIPTION AUDIO.

─── RÈGLES DE CORRESPONDANCE ───────────────────────────────

• La correspondance est sémantique et phonétique, pas orthographique exacte.
  - Un mot mal transcrit (ex: "dɔ" au lieu de "ɖɔ") compte comme correspondance valide si le sens est cohérent.
  - Des mots manquants ou inversés dans la transcription audio sont tolérés.
  - Des syllabes fusionnées ou découpées différemment sont tolérées.

• La portion extraite doit :
  - Couvrir l'intégralité du contenu reconnaissable dans la transcription audio (ni trop courte, ni trop longue).
  - Commencer et terminer à une frontière de mot naturelle dans la référence.
  - Correspondre au sens général du segment, même si l'ASR a produit plusieurs erreurs.

─── RÈGLES DE RÉPONSE ──────────────────────────────────────

• Retourne UNIQUEMENT le texte copié mot-à-mot depuis la référence, sans aucune modification.
• Ne corrige pas, ne reformule pas, ne résume pas : copie exactement les mots tels qu'ils apparaissent dans la référence.
• N'ajoute aucune ponctuation supplémentaire, aucun guillemet, aucun commentaire, aucune explication.
• Si et seulement si aucune portion de la référence ne correspond au sens de la transcription audio, réponds UNIQUEMENT : [NO_MATCH]

─── EXEMPLES ───────────────────────────────────────────────

Transcription audio : "emi ko dɔ xɔ"
Référence : "...émí kò ɖɔ xɔ̌ ɖé bɔ mì ni yì..."
→ Réponse correcte : émí kò ɖɔ xɔ̌ ɖé

Transcription audio : "gbɛtɔ lɛ bǐ"
Référence : "...gbɛ̌tɔ́ lɛ́ bǐ wɛ ná wá..."
→ Réponse correcte : gbɛ̌tɔ́ lɛ́ bǐ wɛ ná wá

Transcription audio : "blabla incompréhensible xyz"
Référence : "...n'importe quel texte fongbe..."
→ Réponse correcte : [NO_MATCH]`;

interface AIMatchResult {
  matchedText: string;
  isMatch: boolean;
}

/**
 * Demande à Gemini de trouver la portion de référence qui correspond
 * à une transcription audio donnée.
 */
async function aiAlignSegment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  geminiText: string,
  referenceWindow: string,
  retries: number = 2
): Promise<AIMatchResult> {
  const userPrompt =
    `TRANSCRIPTION AUDIO :\n${geminiText}\n\n` +
    `EXTRAIT DE RÉFÉRENCE :\n${referenceWindow}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent([ALIGN_PROMPT, userPrompt]);
      const text = result.response.text().trim();

      if (!text || text === "[NO_MATCH]") {
        return { matchedText: "", isMatch: false };
      }

      return { matchedText: text, isMatch: true };
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error(
        `  ⚠ AI align attempt ${attempt}/${retries}: ${err.message}`
      );
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }

  return { matchedText: "", isMatch: false };
}

// ─── Algorithme principal (hybride IA + algo) ───────────────────────────────

/**
 * Alignement hybride IA + algorithmique.
 *
 * Pour chaque transcription Gemini (= une phrase) :
 * 1. On extrait une fenêtre du texte de référence autour du curseur courant.
 * 2. On envoie la phrase Gemini + cette fenêtre à Gemini pour qu'il identifie
 *    la portion correspondante dans la référence.
 * 3. On localise précisément le texte retourné par l'IA dans la fenêtre
 *    (indices de mots) pour avancer le curseur.
 * 4. Si l'IA échoue, on tente un fallback algorithmique (séquence contiguë).
 */
export async function alignTranscriptions(
  transcriptions: TranscriptionResult[],
  referenceText: string,
  apiKey: string,
  options?: AlignOptions
): Promise<AlignmentResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const refWords = referenceText.split(/\s+/).filter((w) => w.length > 0);
  const totalRefWords = refWords.length;

  const aligned: AlignedSegment[] = [];
  let cursor = 0;

  console.log(
    `\n══ Alignement IA de ${transcriptions.length} segments ` +
      `sur ${totalRefWords} mots de référence ══\n`
  );

  for (let i = 0; i < transcriptions.length; i++) {
    const trans = transcriptions[i];
    const geminiWords = trans.geminiText
      .split(/\s+/)
      .filter((w) => w.length > 0);

    // Segment vide → ignorer
    if (geminiWords.length === 0) {
      aligned.push(makeEmpty(trans, cursor));
      console.log(`  ⏭ [${trans.segmentIndex}] texte Gemini vide`);
      continue;
    }

    // ── Fenêtre de recherche ──
    // On prend une marge large pour que l'IA ait du contexte
    const windowWordCount = Math.max(
      geminiWords.length * 4,
      opts.searchMargin
    );
    const windowStart = Math.max(0, cursor - 15); // un peu avant le curseur
    const windowEnd = Math.min(totalRefWords, cursor + windowWordCount);
    const windowText = refWords.slice(windowStart, windowEnd).join(" ");

    // ── Appel IA ──
    const aiResult = await aiAlignSegment(model, trans.geminiText, windowText);

    let matched = false;

    if (aiResult.isMatch && aiResult.matchedText.length > 0) {
      // Localiser le texte retourné par l'IA dans la fenêtre
      const location = locateInWindow(
        aiResult.matchedText,
        refWords,
        windowStart,
        windowEnd
      );

      if (location) {
        aligned.push({
          segmentId: trans.segmentId,
          segmentIndex: trans.segmentIndex,
          fileName: trans.fileName,
          startTime: trans.startTime,
          endTime: trans.endTime,
          duration: trans.duration,
          geminiText: trans.geminiText,
          referenceText: refWords.slice(location.start, location.end).join(" "),
          matchScore: round(location.score),
          refWordStart: location.start,
          refWordEnd: location.end,
        });

        cursor = location.end;
        matched = true;

        const icon = location.score >= 0.6 ? "✅" : "⚠️";
        console.log(
          `  ${icon} [${trans.segmentIndex}] IA match (${(location.score * 100).toFixed(0)}%) | ` +
            `"${shorten(trans.geminiText)}" → "${shorten(aiResult.matchedText)}"`
        );
      }
    }

    // ── Fallback algorithmique si l'IA n'a pas trouvé ──
    if (!matched) {
      const fallback = fallbackContiguousRun(
        geminiWords,
        refWords,
        Math.max(0, cursor - 10),
        Math.min(totalRefWords, cursor + windowWordCount)
      );

      if (fallback) {
        aligned.push({
          segmentId: trans.segmentId,
          segmentIndex: trans.segmentIndex,
          fileName: trans.fileName,
          startTime: trans.startTime,
          endTime: trans.endTime,
          duration: trans.duration,
          geminiText: trans.geminiText,
          referenceText: refWords
            .slice(fallback.refStart, fallback.refEnd)
            .join(" "),
          matchScore: round(fallback.score),
          refWordStart: fallback.refStart,
          refWordEnd: fallback.refEnd,
        });

        cursor = fallback.refEnd;
        matched = true;

        console.log(
          `  🔧 [${trans.segmentIndex}] Fallback algo (${(fallback.score * 100).toFixed(0)}%) | ` +
            `"${shorten(trans.geminiText)}" → ` +
            `"${shorten(refWords.slice(fallback.refStart, fallback.refEnd).join(" "))}"`
        );
      }
    }

    if (!matched) {
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
      console.log(
        `  ❌ [${trans.segmentIndex}] PAS DE MATCH | "${shorten(trans.geminiText)}"`
      );
    }

    // Rate limiting — 500ms entre chaque appel
    if (i < transcriptions.length - 1) {
      await sleep(500);
    }
  }

  // ── Statistiques ──
  const matchedSegs = aligned.filter((a) => a.referenceText.length > 0);
  const scores = aligned.map((a) => a.matchScore);
  const avgScore =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const lowConf = aligned.filter(
    (a) => a.matchScore < opts.minConfidence && a.matchScore > 0
  );

  // Portions non couvertes
  const coveredRanges = matchedSegs.map((a) => ({
    start: a.refWordStart,
    end: a.refWordEnd,
  }));

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

  console.log(
    `\n══ Résultat: ${matchedSegs.length}/${transcriptions.length} alignés ` +
      `(score moyen ${(avgScore * 100).toFixed(1)}%) ══\n`
  );

  return {
    totalSegments: transcriptions.length,
    alignedSegments: matchedSegs.length,
    averageScore: round(avgScore),
    lowConfidenceCount: lowConf.length,
    segments: aligned,
    uncoveredText: uncovered,
  };
}

// ─── Fallback algorithmique (séquence contiguë) ─────────────────────────────

function wordsMatch(a: string, b: string): boolean {
  const na = normalizeWord(a);
  const nb = normalizeWord(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na === nb) return true;
  const maxLen = Math.max(na.length, nb.length);
  return levenshtein(na, nb) <= Math.max(1, Math.floor(maxLen * 0.35));
}

function fallbackContiguousRun(
  geminiWords: string[],
  refWords: string[],
  searchStart: number,
  searchEnd: number
): { refStart: number; refEnd: number; score: number } | null {
  let bestRunLen = 0;
  let bestRefStart = searchStart;

  for (let gi = 0; gi < geminiWords.length; gi++) {
    for (let ri = searchStart; ri < searchEnd; ri++) {
      if (wordsMatch(geminiWords[gi], refWords[ri])) {
        let len = 0;
        let gj = gi;
        let rj = ri;
        while (
          gj < geminiWords.length &&
          rj < searchEnd &&
          wordsMatch(geminiWords[gj], refWords[rj])
        ) {
          len++;
          gj++;
          rj++;
        }
        if (len > bestRunLen) {
          bestRunLen = len;
          bestRefStart = ri;
        }
        if (bestRunLen >= geminiWords.length * 0.8) break;
      }
    }
    if (bestRunLen >= geminiWords.length * 0.8) break;
  }

  const minRunWords = Math.max(2, Math.ceil(geminiWords.length * 0.25));
  const ratio = bestRunLen / geminiWords.length;

  if (bestRunLen >= minRunWords && ratio >= 0.3) {
    return {
      refStart: bestRefStart,
      refEnd: bestRefStart + bestRunLen,
      score: Math.min(1, ratio),
    };
  }

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEmpty(trans: TranscriptionResult, cursor: number): AlignedSegment {
  return {
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
  };
}

function round(n: number): number {
  return parseFloat(n.toFixed(4));
}

function shorten(s: string, max = 50): string {
  return s.length > max ? s.substring(0, max) + "…" : s;
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
