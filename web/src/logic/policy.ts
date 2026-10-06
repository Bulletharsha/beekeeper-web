/**
 * Centralized kids-mode tuning constants.
 *
 * Adaptive difficulty: both kids climb/descend a shared 5-rung ladder
 * based on rolling accuracy. Nothing else in the app may hardcode these
 * numbers — import them from here instead.
 */
export const KidsPolicy = {
  /** Words in the main pass of a practice round (misses get one retry pass). */
  roundSize: 10,
  /** Top rung of the shared ladder (0..maxLevel). */
  maxLevel: 4,
  /** Where each kid starts: Anjali on the easiest rung, Arya at the
   *  school-bee rung (average expected level for 4th-grade bee prep). */
  startLevel: { arya: 2, anjali: 0 } as const,
  /** Rung 0 pool: One Bee words this short or shorter (the easiest start). */
  easiestWordMaxLength: 5,
  /** Rung 1 pool: One Bee words this short or shorter. */
  anjaliShortWordMaxLength: 7,
  /** Move up a rung at or above this rolling accuracy… */
  promoteAccuracy: 0.8,
  /** …over at least this many recent answers at the current rung. */
  promoteMinAnswers: 10,
  /**
   * Below this rolling accuracy the rung moves DOWN a level at the next
   * round, and easier words are blended into the current round for
   * encouragement.
   */
  struggleAccuracy: 0.5,
  /**
   * At or above this accuracy (but below promoteAccuracy), blend a few
   * harder words from the next rung into the round — the gentle upward push.
   */
  stretchAccuracy: 0.65,
  /** Rolling window (most recent answers) for accuracy windows. */
  recentWindow: 20,
  /** Share of picks drawn from the previous (easier) rung while struggling. */
  comfortMixRatio: 0.4,
  /** Share of picks drawn from the next (harder) rung while stretching. */
  stretchMixRatio: 0.25,
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
