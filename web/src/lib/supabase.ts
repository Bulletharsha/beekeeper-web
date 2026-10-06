import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Shared Supabase client. Null when the build has no cloud config —
 *  the app then runs fully local (offline-first by design). */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const SUPABASE_URL = url ?? '';
export const SUPABASE_ANON_KEY = anonKey ?? '';
export const isCloudConfigured = !!url && !!anonKey;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

/** Current user's JWT for authenticated edge-function calls. Null when
 *  the cloud isn't configured or no parent is signed in. */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Synchronously-readable auth state. iOS Safari only honors
 *  speechSynthesis.speak() inside the user-gesture call stack, so the
 *  audio layer must know sign-in state WITHOUT awaiting. */
let cachedToken: string | null = null;

if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    cachedToken = data.session?.access_token ?? null;
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedToken = session?.access_token ?? null;
  });
}

/** Sync access token, null when not signed in. May lag a few ms right after
 *  page load; getAccessToken() is authoritative for non-urgent callers. */
export function getCachedToken(): string | null {
  return cachedToken;
}
