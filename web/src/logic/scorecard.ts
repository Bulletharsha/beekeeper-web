/**
 * Per-kid scorecard statistics: stars, streaks, high scores, and trends.
 *
 * Ported from Swift's `KidScorecardStats` (KidsScorecard.swift). Pure logic —
 * no storage or UI. Rounds are expected newest-first; the constructor sorts
 * defensively so callers can't break streak math by passing them unsorted.
 */

import { roundAccuracy } from './types';
import type { KidProfile, KidRound } from './types';

/** Rounds shorter than this never count toward high scores. */
const HIGH_SCORE_MIN_WORDS = 5;

/** Trend buckets for the improvement indicator. */
export type ScoreTrend = 'improving' | 'steady' | 'dipping' | 'notEnough';

const MS_PER_DAY = 86_400_000;

export class KidScorecardStats {
  readonly kid: KidProfile;
  /** Completed rounds, newest first. */
  readonly rounds: KidRound[];

  constructor(kid: KidProfile, rounds: KidRound[]) {
    this.kid = kid;
    this.rounds = [...rounds].sort((a, b) => b.startedAt - a.startedAt);
  }

  get roundCount(): number {
    return this.rounds.length;
  }

  get wordsAttempted(): number {
    return this.rounds.reduce((sum, r) => sum + r.wordCount, 0);
  }

  get wordsCorrect(): number {
    return this.rounds.reduce((sum, r) => sum + r.correctCount, 0);
  }

  get accuracy(): number {
    return this.wordsAttempted > 0 ? this.wordsCorrect / this.wordsAttempted : 0;
  }

  get totalStars(): number {
    return this.rounds.reduce((sum, r) => sum + r.stars, 0);
  }

  /** Rounds eligible for high scores (excludes tiny warm-up rounds). */
  private get eligibleRounds(): KidRound[] {
    return this.rounds.filter((r) => r.wordCount >= HIGH_SCORE_MIN_WORDS);
  }

  private static compareHighScore(a: KidRound, b: KidRound): number {
    const byAccuracy = roundAccuracy(b) - roundAccuracy(a);
    if (byAccuracy !== 0) return byAccuracy;
    if (b.wordCount !== a.wordCount) return b.wordCount - a.wordCount;
    return b.startedAt - a.startedAt; // more recent wins remaining ties
  }

  /** Best round: highest accuracy, then most words, then most recent. */
  get bestRound(): KidRound | null {
    const eligible = this.eligibleRounds;
    if (eligible.length === 0) return null;
    return [...eligible].sort(KidScorecardStats.compareHighScore)[0];
  }

  /** Top five rounds by the same high-score ordering. */
  get topRounds(): KidRound[] {
    return [...this.eligibleRounds].sort(KidScorecardStats.compareHighScore).slice(0, 5);
  }

  /** The ten most recent rounds. */
  get recentRounds(): KidRound[] {
    return this.rounds.slice(0, 10);
  }

  /** Start of the local-timezone calendar day containing `ts`. */
  private static dayStart(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /**
   * Consecutive days with at least one round, counting back from today.
   * A streak stays alive through today: if the kid hasn't practiced yet
   * today but did yesterday, the streak counts from yesterday.
   */
  get currentStreak(): number {
    const days = new Set(this.rounds.map((r) => KidScorecardStats.dayStart(r.startedAt)));
    if (days.size === 0) return 0;
    const today = KidScorecardStats.dayStart(Date.now());
    let cursor = days.has(today) ? today : today - MS_PER_DAY;
    let streak = 0;
    while (days.has(cursor)) {
      streak += 1;
      cursor -= MS_PER_DAY;
    }
    return streak;
  }

  /** Longest run of consecutive practice days, ever. */
  get longestStreak(): number {
    const days = [...new Set(this.rounds.map((r) => KidScorecardStats.dayStart(r.startedAt)))].sort(
      (a, b) => a - b,
    );
    let best = 0;
    let current = 0;
    let prev = Number.NEGATIVE_INFINITY;
    for (const day of days) {
      current = day - prev === MS_PER_DAY ? current + 1 : 1;
      best = Math.max(best, current);
      prev = day;
    }
    return best;
  }

  /**
   * Improvement trend: compares the average accuracy of the 5 most recent
   * rounds against the 5 before them. Needs at least 8 rounds to say
   * anything; a ±0.05 band counts as steady.
   */
  get trend(): ScoreTrend {
    if (this.rounds.length < 8) return 'notEnough';
    const average = (rs: KidRound[]) =>
      rs.reduce((sum, r) => sum + roundAccuracy(r), 0) / rs.length;
    const recent = average(this.rounds.slice(0, 5));
    const prior = average(this.rounds.slice(5, 10));
    const delta = recent - prior;
    if (delta > 0.05) return 'improving';
    if (delta < -0.05) return 'dipping';
    return 'steady';
  }

  /**
   * Encouraging one-liner for the current trend, in the kid's voice.
   *
   * Matches KidsScorecard.swift exactly.
   */
  get trendLine(): string | null {
    switch (this.trend) {
      case 'improving':
        return 'Trending up — recent rounds are sharper than before. Keep it going!';
      case 'steady':
        return 'Steady practicing — consistency is how champions are made.';
      case 'dipping':
        return 'A little dip lately — no worries, every speller has off days.';
      case 'notEnough':
        return null;
    }
  }
}
