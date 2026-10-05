import Dexie, { type Table } from 'dexie';

/** IndexedDB tables mirroring the Supabase schema (see supabase/migrations/).
 *  Local-first: all writes land here instantly; the sync layer pushes to
 *  Supabase in the background. Every device holds a full copy.
 */

export interface WordRow {
  id: string; // stable word id
  spelling: string;
  tier: 'oneBee' | 'twoBee' | 'threeBee';
  definition: string;
  example: string;
  languageOrigin: string;
  partOfSpeech: string;
  audioUrl?: string;
}

export interface WordRecordRow {
  wordID: string; // primary key
  spelling: string;
  tierRaw: string;
  lastGradedSession?: number;
  lastCorrect?: boolean;
  timesSeen: number;
  correctCount: number;
  wrongCount: number;
}

export interface GradeEventRow {
  id?: number; // auto-increment local key
  wordID: string;
  sessionNumber: number;
  correct: boolean;
  timestamp: number; // epoch ms
  kid?: string; // 'arya' | 'anjali'
  /** Stable id shared with the cloud row; assigned at first sync. */
  syncId?: string;
  synced?: boolean;
}

export interface KidRoundRow {
  id: string; // uuid
  kid: string;
  startedAt: number; // epoch ms
  wordCount: number;
  correctCount: number;
  stars: number;
  synced?: boolean;
}

export interface MetaRow {
  key: string; // primary key
  value: string; // JSON-encoded
}

class BeekeeperDB extends Dexie {
  words!: Table<WordRow, string>;
  wordRecords!: Table<WordRecordRow, string>;
  gradeEvents!: Table<GradeEventRow, number>;
  kidRounds!: Table<KidRoundRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('beekeeper');
    this.version(1).stores({
      words: 'id, spelling, tier',
      wordRecords: 'wordID, tierRaw',
      gradeEvents: '++id, wordID, kid, timestamp',
      kidRounds: 'id, kid, startedAt',
      meta: 'key',
    });
    // v2: grade events carry the stable cloud id for idempotent sync.
    this.version(2).stores({
      words: 'id, spelling, tier',
      wordRecords: 'wordID, tierRaw',
      gradeEvents: '++id, wordID, kid, timestamp, syncId',
      kidRounds: 'id, kid, startedAt',
      meta: 'key',
    });
  }
}

export const db = new BeekeeperDB();

/** Typed helpers for the meta table (session number, Anjali level, PIN hash…). */
export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value: JSON.stringify(value) });
}

/** Seed the words table from the bundled JSON on first run, and make sure
 *  every word has a WordRecord so the first round has candidates. */
export async function ensureWordsSeeded(): Promise<void> {
  const count = await db.words.count();
  if (count < 4000) {
    const res = await fetch('/data/words.json');
    const data = await res.json();
    const words: WordRow[] = (data.words as any[]).map((w) => ({
      id: w.id,
      spelling: w.spelling,
      tier:
        w.tier === 'one_bee' ? 'oneBee' : w.tier === 'two_bee' ? 'twoBee' : 'threeBee',
      definition: w.definition ?? '',
      example: w.example ?? '',
      languageOrigin: w.languageOrigin ?? '',
      partOfSpeech: w.partOfSpeech ?? '',
      audioUrl: w.audioURL ?? undefined,
    }));
    await db.words.bulkPut(words);
  }
  // One WordRecord per word (all unseen). The adaptive pool draws its
  // candidates from these, so a fresh install must have them.
  const recordCount = await db.wordRecords.count();
  if (recordCount < 4000) {
    const words = await db.words.toArray();
    const existing = new Set(await db.wordRecords.toCollection().primaryKeys());
    const missing: WordRecordRow[] = words
      .filter((w) => !existing.has(w.id))
      .map((w) => ({
        wordID: w.id,
        spelling: w.spelling,
        tierRaw: w.tier,
        timesSeen: 0,
        correctCount: 0,
        wrongCount: 0,
      }));
    if (missing.length > 0) await db.wordRecords.bulkAdd(missing);
  }
}

/**
 * Recompute the shared word-record counters from the full local
 * grade-event log. Used after pulling another device's events so the
 * merged history is reflected everywhere.
 */
export async function rebuildRecordCounters(): Promise<void> {
  const events = await db.gradeEvents.toArray();
  const agg = new Map<
    string,
    { seen: number; correct: number; wrong: number; lastCorrect?: boolean; lastTs: number }
  >();
  for (const e of events) {
    const a = agg.get(e.wordID) ?? { seen: 0, correct: 0, wrong: 0, lastTs: 0 };
    a.seen += 1;
    if (e.correct) a.correct += 1;
    else a.wrong += 1;
    if (e.timestamp >= a.lastTs) {
      a.lastCorrect = e.correct;
      a.lastTs = e.timestamp;
    }
    agg.set(e.wordID, a);
  }
  const updates: WordRecordRow[] = [];
  for (const r of await db.wordRecords.toArray()) {
    const a = agg.get(r.wordID);
    if (!a) continue;
    updates.push({
      ...r,
      timesSeen: a.seen,
      correctCount: a.correct,
      wrongCount: a.wrong,
      lastCorrect: a.lastCorrect,
    });
  }
  if (updates.length > 0) await db.wordRecords.bulkPut(updates);
}
