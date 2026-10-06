import { db, getMeta, setMeta, rebuildRecordCounters } from '../db/database';
import { supabase, isCloudConfigured } from './supabase';

/**
 * Local-first sync engine.
 *
 * Every device writes to IndexedDB instantly and treats Supabase as the
 * meeting point: `syncNow()` pushes unsynced local rows, then pulls rows
 * from other devices. Grade events and rounds are append-only with stable
 * ids, so push/pull are idempotent and safe to retry. Anjali's ladder
 * rung is last-write-wins by timestamp.
 *
 * Handoff happens between rounds: a finished round (and every grade in
 * it) syncs, so the next round on another device sees the full history.
 */

export interface SyncResult {
  pushed: number;
  pulled: number;
  at: number;
}

async function deviceId(): Promise<string> {
  let id = await getMeta<string>('beekeeper.deviceId', '');
  if (!id) {
    id = crypto.randomUUID();
    await setMeta('beekeeper.deviceId', id);
  }
  return id;
}

async function signedIn(): Promise<boolean> {
  if (!isCloudConfigured || !supabase) return false;
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

/** Rows waiting to be pushed. */
export async function pendingCount(): Promise<number> {
  const [e, r] = await Promise.all([
    db.gradeEvents.filter((x) => !x.synced).count(),
    db.kidRounds.filter((x) => !x.synced).count(),
  ]);
  return e + r;
}

export async function lastSyncAt(): Promise<number | null> {
  return getMeta<number | null>('beekeeper.lastSyncAt', null);
}

/** Push local changes, then pull remote changes. Safe to call any time;
 *  no-ops when offline, unconfigured, or signed out. */
export async function syncNow(): Promise<SyncResult> {
  if (!(await signedIn()) || !supabase) {
    return { pushed: 0, pulled: 0, at: Date.now() };
  }
  const pushed = await pushChanges();
  const pulled = await pullChanges();
  const at = Date.now();
  await setMeta('beekeeper.lastSyncAt', at);
  return { pushed, pulled, at };
}

async function pushChanges(): Promise<number> {
  const client = supabase!;
  const device = await deviceId();
  let n = 0;

  const events = await db.gradeEvents.filter((e) => !e.synced).toArray();
  for (const e of events) {
    if (!e.kid) {
      // Never misattribute: skip legacy rows without a kid.
      await db.gradeEvents.update(e.id!, { synced: true });
      continue;
    }
    let syncId = e.syncId;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await db.gradeEvents.update(e.id!, { syncId });
    }
    const { error } = await client
      .from('grade_events')
      .upsert(
        {
          id: syncId,
          kid: e.kid,
          word_id: e.wordID,
          correct: e.correct,
          session_number: e.sessionNumber,
          created_at: new Date(e.timestamp).toISOString(),
          device_id: device,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
    if (error) throw new Error(`push grade_events: ${error.message}`);
    await db.gradeEvents.update(e.id!, { synced: true });
    n++;
  }

  const rounds = await db.kidRounds.filter((r) => !r.synced).toArray();
  for (const r of rounds) {
    const { error } = await client
      .from('kid_rounds')
      .upsert(
        {
          id: r.id,
          kid: r.kid,
          started_at: new Date(r.startedAt).toISOString(),
          word_count: r.wordCount,
          correct_count: r.correctCount,
          stars: r.stars,
          device_id: device,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
    if (error) throw new Error(`push kid_rounds: ${error.message}`);
    await db.kidRounds.update(r.id, { synced: true });
    n++;
  }

  // Each kid's ladder rung: last-write-wins by timestamp.
  // NOTE: the column is historically named anjali_level; it stores the
  // rung for whichever kid the row belongs to.
  for (const kid of ['arya', 'anjali'] as const) {
    const localLevel = await getMeta<number>(`beekeeper.level.${kid}`, 0);
    const localTs = await getMeta<number>(`beekeeper.levelUpdatedAt.${kid}`, 0);
    const { data: remote, error: sErr } = await client
      .from('kid_state')
      .select('anjali_level, updated_at')
      .eq('kid', kid)
      .maybeSingle();
    if (sErr) throw new Error(`read kid_state: ${sErr.message}`);
    const remoteTs = remote ? Date.parse(remote.updated_at as string) : 0;
    if (!remote || localTs >= remoteTs) {
      const { error } = await client.from('kid_state').upsert(
        {
          kid,
          anjali_level: localLevel,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'kid' },
      );
      if (error) throw new Error(`push kid_state: ${error.message}`);
    }
  }
  return n;
}

async function pullChanges(): Promise<number> {
  const client = supabase!;
  let n = 0;

  const { data: events, error: eErr } = await client
    .from('grade_events')
    .select('id, kid, word_id, correct, session_number, created_at')
    .order('created_at', { ascending: true });
  if (eErr) throw new Error(`pull grade_events: ${eErr.message}`);
  const knownIds = new Set(
    (await db.gradeEvents.toArray()).map((e) => e.syncId).filter(Boolean),
  );
  const fresh = (events ?? []).filter((r) => !knownIds.has(r.id as string));
  for (const r of fresh) {
    await db.gradeEvents.add({
      wordID: r.word_id as string,
      sessionNumber: r.session_number as number,
      correct: r.correct as boolean,
      timestamp: Date.parse(r.created_at as string),
      kid: r.kid as string,
      syncId: r.id as string,
      synced: true,
    });
    n++;
  }
  // Re-derive the shared word counters from the merged event log so the
  // other device's grades are reflected everywhere.
  if (fresh.length > 0) await rebuildRecordCounters();

  const { data: rounds, error: rErr } = await client
    .from('kid_rounds')
    .select('id, kid, started_at, word_count, correct_count, stars')
    .order('started_at', { ascending: true });
  if (rErr) throw new Error(`pull kid_rounds: ${rErr.message}`);
  const knownRounds = new Set(await db.kidRounds.toCollection().primaryKeys());
  for (const r of rounds ?? []) {
    const id = r.id as string;
    if (knownRounds.has(id)) continue;
    await db.kidRounds.add({
      id,
      kid: r.kid as string,
      startedAt: Date.parse(r.started_at as string),
      wordCount: r.word_count as number,
      correctCount: r.correct_count as number,
      stars: r.stars as number,
      synced: true,
    });
    n++;
  }

  // Each kid's rung: take the remote value when it's newer (last-write-wins).
  for (const kid of ['arya', 'anjali'] as const) {
    const { data: state } = await client
      .from('kid_state')
      .select('anjali_level, updated_at')
      .eq('kid', kid)
      .maybeSingle();
    if (state) {
      const remoteTs = Date.parse(state.updated_at as string);
      const localTs = await getMeta<number>(`beekeeper.levelUpdatedAt.${kid}`, 0);
      if (remoteTs > localTs) {
        await setMeta(`beekeeper.level.${kid}`, state.anjali_level as number);
        await setMeta(`beekeeper.levelUpdatedAt.${kid}`, remoteTs);
      }
    }
  }
  return n;
}
