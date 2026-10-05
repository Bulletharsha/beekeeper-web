/**
 * Core domain types for Beekeeper Web.
 *
 * Ported from the Beekeeper2027 Swift models (Models.swift). These are plain
 * data shapes with no framework dependencies so the quiz engine, word pool,
 * and scorecard logic stay UI-agnostic and unit-testable.
 */

/** Which child is practicing. Parents mode is the absence of a kid. */
export type KidProfile = 'arya' | 'anjali';

/** Spelling-bee difficulty tier. */
export type WordTier = 'oneBee' | 'twoBee' | 'threeBee';

/**
 * A word from the 2027 Words of the Champions list, fully enriched.
 * Ported from Swift's `WordEntry`.
 */
export interface WordEntry {
  /** Stable unique id (matches WordRecord.wordID). */
  id: string;
  spelling: string;
  tier: WordTier;
  definition: string;
  example: string;
  languageOrigin: string;
  partOfSpeech: string;
  /** Official Scripps pronunciation MP3, when available. */
  audioUrl?: string;
}

/**
 * Per-word practice state. In the Swift app this was a SwiftData model;
 * here it is a plain record supplied by the storage layer via callbacks.
 */
export interface WordRecord {
  wordID: string;
  spelling: string;
  /** Raw tier string from the dataset, e.g. "one_bee". See {@link tierFromRaw}. */
  tierRaw: string;
  lastGradedSession?: number;
  lastCorrect?: boolean;
  timesSeen: number;
  correctCount: number;
  wrongCount: number;
}

/**
 * One graded answer. The per-kid source of truth for "seen" state —
 * sibling or parents-mode practice must never leak into a kid's pool,
 * so every event carries kid attribution.
 */
export interface GradeEvent {
  wordID: string;
  sessionNumber: number;
  correct: boolean;
  /** Epoch milliseconds. */
  timestamp: number;
  /** 'arya' | 'anjali' | undefined (parents mode). */
  kid?: string;
}

/**
 * One completed kids-mode practice round. Ported from Swift's `KidRound`
 * (SwiftData model).
 */
export interface KidRound {
  id: string;
  /** KidProfile raw value. */
  kid: string;
  /** Epoch milliseconds. */
  startedAt: number;
  wordCount: number;
  correctCount: number;
  stars: number;
}

/**
 * Map a raw tier string from the dataset to a {@link WordTier}.
 * Unknown values fall back to 'oneBee' (the easiest rung).
 */
export function tierFromRaw(tierRaw: string): WordTier {
  switch (tierRaw) {
    case 'two_bee':
    case 'twoBee':
      return 'twoBee';
    case 'three_bee':
    case 'threeBee':
      return 'threeBee';
    case 'one_bee':
    case 'oneBee':
    default:
      return 'oneBee';
  }
}

/** Accuracy of a single round: correctCount / wordCount, 0 when empty. */
export function roundAccuracy(round: Pick<KidRound, 'wordCount' | 'correctCount'>): number {
  return round.wordCount > 0 ? round.correctCount / round.wordCount : 0;
}
