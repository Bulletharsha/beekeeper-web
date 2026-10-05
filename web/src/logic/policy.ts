/**
 * Centralized kids-mode tuning constants.
 *
 * Ported from Swift's `KidsPolicy` enum (KidsMode.swift). Nothing else in
 * the app may hardcode these numbers — import them from here instead.
 */
export const KidsPolicy = {
  /** Words in the main pass of a practice round (misses get one retry pass). */
  roundSize: 10,
  /** Anjali's starting pool: One Bee words this short or shorter. */
  anjaliShortWordMaxLength: 7,
  /** Promote to the next rung at or above this rolling accuracy… */
  promoteAccuracy: 0.8,
  /** …over at least this many recent answers at the current rung. */
  promoteMinAnswers: 10,
  /**
   * Below this rolling accuracy, blend easier words into the round instead
   * of demoting — encouragement first, the rung only moves up.
   */
  struggleAccuracy: 0.5,
  /** Rolling window (most recent answers) for accuracy windows. */
  recentWindow: 20,
  /** Share of picks drawn from the previous (easier) rung while struggling. */
  comfortMixRatio: 0.4,
  /** Parent gate PIN length. */
  pinLength: 4,
} as const;

/**
 * Stars awarded for a round's main-pass accuracy. Always at least one —
 * a kid who practiced gets a star.
 */
export function starsFor(accuracy: number): number {
  if (accuracy >= 0.9) return 3;
  if (accuracy >= 0.7) return 2;
  return 1;
}
