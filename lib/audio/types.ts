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
  silenceThreshold?: string;
  silenceDuration?: number;
  minSegmentDuration?: number;
  maxSegmentDuration?: number;
  /**
   * Padding audio (en secondes) ajouté au début et à la fin de chaque segment.
   * Fournit du contexte supplémentaire à Gemini pour éviter les troncatures
   * en début et fin de segment. Défaut : 0.25s.
   */
  segmentPadding?: number;
}

// ─── Phase 2 — Transcription Gemini ──────────────────────────────────────────

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
  /** Seed pour des réponses déterministes (même seed → même sortie pour un audio donné) */
  seed?: number;
}

export interface TranscribeBatchResult {
  total: number;
  succeeded: number;
  failed: number;
  transcriptions: TranscriptionResult[];
  errors: Array<{ segmentIndex: number; error: string }>;
}

// ─── Phase 3 — Alignement Fuzzy ─────────────────────────────────────────────

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
  lowConfidenceCount: number;
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
