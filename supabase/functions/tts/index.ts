// Supabase Edge Function: Groq Orpheus TTS proxy.
// POST /api/tts { text, voice, cheerful }
// The Groq API key lives in the function's secrets (GROQ_API_KEY) — it never
// touches the browser. Requires an authenticated user (parents sign in; kids
// use the app on a parent's signed-in device).
//
// Simple rate limiting: 10 req/min per user (Groq free tier is 10 req/min,
// 100 req/day account-wide). Responses are cached client-side, so repeats
// never hit this function twice.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!;
const GROQ_MODEL = 'canopylabs/orpheus-v1-english';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/speech';

const VOICES = new Set(['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};


// In-memory per-user rate limiter (per isolate; fine for our volume).
const hits = new Map<string, number[]>();
function rateLimited(userId: string): boolean {
  const now = Date.now();
  const window = hits.get(userId) ?? [];
  const fresh = window.filter((t) => now - t < 60_000);
  hits.set(userId, fresh);
  if (fresh.length >= 10) return true;
  fresh.push(now);
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: CORS });
  }

  // Auth: must be a signed-in parent.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('unauthorized', { status: 401, headers: CORS });
  if (rateLimited(user.id)) {
    return new Response('rate limited — try again shortly', { status: 429, headers: CORS });
  }

  const { text, voice, cheerful } = await req.json();
  if (typeof text !== 'string' || text.length === 0 || text.length > 180) {
    return new Response('text must be 1–180 chars', { status: 400, headers: CORS });
  }
  if (!VOICES.has(voice)) return new Response('unknown voice', { status: 400, headers: CORS });

  // Cheerful tone: prefix with a delivery hint Orpheus understands.
  const input = cheerful ? `*cheerful* ${text}` : text;

  const groqRes = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: GROQ_MODEL, input, voice, response_format: 'wav' }),
  });

  if (!groqRes.ok) {
    const body = await groqRes.text();
    console.error('groq error', groqRes.status, body.slice(0, 200));
    return new Response('tts provider error', { status: 502, headers: CORS });
  }

  const audio = await groqRes.arrayBuffer();
  return new Response(audio, {
    headers: {
      ...CORS,
      'Content-Type': 'audio/wav',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});
