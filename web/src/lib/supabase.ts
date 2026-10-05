import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Shared Supabase client. Null when the build has no cloud config —
 *  the app then runs fully local (offline-first by design). */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const SUPABASE_URL = url ?? '';
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
