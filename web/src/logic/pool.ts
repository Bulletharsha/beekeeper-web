/**
 * Pure adaptive word-pool logic for kids mode. No storage, no UI — every
 * function here is unit-testable.
 *
 * Ported from Swift's `KidsWordPool` enum (KidsMode.swift). Behavior is
 * kept identical, including edge cases:
 * - Anjali climbs rungs 0→3; Arya always practices the whole list.
 * - "Seen" state comes only from the kid's own GradeEvents (per-kid
 *   isolation); the shared WordRecord counters are never consulted here.
 * - Rungs only move up, never down; struggling blends easier words instead.
 */

import { KidsPolicy } from './policy';
import { tierFromRaw } from './types';
import type { GradeEvent, KidProfile, WordRecord } from './types';

/** Anjali's top rung: 0 = short One Bee → 1 = all One Bee → 2 = Two Bee → 3 = Three Bee. */
export const maxAnjaliLevel = 3;

/**
 * Whether a word belongs to a rung of the ladder for a kid.
 * Arya always practices the whole list at once.
 */
export function matches(record: WordRecord, level: number, kid: KidProfile): boolean {
  if (kid === 'arya') return true;
  const tier = tierFromRaw(record.tierRaw);
  switch (level) {
    case 0:
      return tier === 'oneBee' && record.spelling.length <= KidsPolicy.anjaliShortWordMaxLength;
    case 1:
      return tier === 'oneBee';
    case 2:
      return tier === 'twoBee';
    default:
      return tier === 'threeBee';
  }
}

/**
 * Rolling accuracy for a kid's most recent answers, optionally restricted
 * to answers on words from one rung of the ladder.
 */
export function recentAccuracy(
  events: GradeEvent[],
  kid: KidProfile,
  records: WordRecord[] = [],
  onlyLevel?: number,
  window: number = KidsPolicy.recentWindow,
): { answered: number; accuracy: number } {
  let mine = events.filter((e) => e.kid === kid);
  if (onlyLevel !== undefined) {
    const byID = new Map(records.map((r) => [r.wordID, r] as const));
    mine = mine.filter((e) => {
      const record = byID.get(e.wordID);
      return record !== undefined && matches(record, onlyLevel, kid);
    });
  }
  const recent = mine.slice(-window);
  if (recent.length === 0) return { answered: 0, accuracy: 0 };
  const correct = recent.filter((e) => e.correct).length;
  return { answered: recent.length, accuracy: correct / recent.length };
}

/**
 * How many times one kid has been graded on each word, from their own
 * GradeEvents. This is the per-kid "seen" that keeps pools independent:
 * parents-mode or sibling practice never marks a word seen for this kid.
 */
export function seenCounts(events: GradeEvent[], kid: KidProfile): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    if (e.kid === kid) counts[e.wordID] = (counts[e.wordID] ?? 0) + 1;
  }
  return counts;
}

/**
 * Resolve the persisted rung against performance. Promotes on mastery
 * (≥80% over ≥10 recent answers at the rung) or when the rung's pool is
 * exhausted (every word seen at least once by this kid). Rungs never
 * move down; struggling blends easier words via comfortMixing instead.
 */
export function resolvedLevel(
  stored: number,
  kid: KidProfile,
  events: GradeEvent[],
  records: WordRecord[],
): number {
  if (kid !== 'anjali') return 0;
  let level = Math.min(Math.max(stored, 0), maxAnjaliLevel);
  if (level >= maxAnjaliLevel) return level;
  const { answered, accuracy } = recentAccuracy(events, kid, records, level);
  const mastered =
    answered >= KidsPolicy.promoteMinAnswers && accuracy >= KidsPolicy.promoteAccuracy;
  const pool = records.filter((r) => matches(r, level, kid));
  const seenByKid = new Set(events.filter((e) => e.kid === kid).map((e) => e.wordID));
  const exhausted = pool.length > 0 && pool.every((r) => seenByKid.has(r.wordID));
  if (mastered || exhausted) level += 1;
  return level;
}

/**
 * True when the kid is finding the current rung hard: blend in words
 * from the previous rung to keep the round encouraging.
 */
export function comfortMixing(
  events: GradeEvent[],
  kid: KidProfile,
  records: WordRecord[],
  level: number,
): boolean {
  if (kid !== 'anjali' || level <= 0) return false;
  const { answered, accuracy } = recentAccuracy(events, kid, records, level);
  return answered >= KidsPolicy.promoteMinAnswers && accuracy < KidsPolicy.struggleAccuracy;
}

/**
 * Pick the next word: words this kid hasn't seen first, then least-seen
 * by this kid; never repeats a word already practiced this round.
 * Seen-ness comes from this kid's own GradeEvents — the shared counters
 * must not leak one kid's (or the parents') practice into another's pool.
 * Returns null when the pool is dry.
 *
 * @param rng Uniform random in [0, 1). Defaults to Math.random; pass a
 *            seeded function for deterministic tests.
 */
export function nextWord(
  records: WordRecord[],
  events: GradeEvent[],
  kid: KidProfile,
  level: number,
  comfortMixingFlag: boolean,
  practiced: Set<string>,
  rng: () => number = Math.random,
): WordRecord | null {
  let rung = level;
  if (comfortMixingFlag && rung > 0 && rng() < KidsPolicy.comfortMixRatio) {
    rung -= 1;
  }
  const pool = records.filter((r) => matches(r, rung, kid) && !practiced.has(r.wordID));
  if (pool.length === 0) return null;
  const seen = seenCounts(events, kid);
  const unseen = pool.filter((r) => (seen[r.wordID] ?? 0) === 0);
  const candidates = unseen.length > 0 ? unseen : pool;
  const minSeen = Math.min(...candidates.map((r) => seen[r.wordID] ?? 0));
  const best = candidates.filter((r) => (seen[r.wordID] ?? 0) === minSeen);
  return best[Math.floor(rng() * best.length)] ?? null;
}
