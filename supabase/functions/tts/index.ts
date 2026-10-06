// Supabase Edge Function: Groq Orpheus TTS proxy.
// POST /functions/v1/tts { text, voice, cheerful }
// The Groq API key lives in the function's secrets (GROQ_API_KEY) — it never
// touches the browser.
//
// Auth: kids mode calls this WITHOUT sign-in. The request must carry the
// project's anon key (proves it's our app, not a random bot). A signed-in
// parent's JWT is accepted too and gets per-user rate limiting; anonymous
// calls are rate-limited per IP.
//
// Simple rate limiting: 10 req/min per identity. Responses are cached
// client-side, so repeats never hit this function twice.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const GROQ_MODEL = 'canopylabs/orpheus-v1-english';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/speech';

const VOICES = new Set(['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']);

// In-memory per-identity rate limiter (per isolate; fine for our volume).
const hits = new Map<string, number[]>();
function rateLimited(identity: string): boolean {
  const now = Date.now();
  const window = hits.get(identity) ?? [];
  const fresh = window.filter((t) => now - t < 60_000);
  hits.set(identity, fresh);
  if (fresh.length >= 10) return true;
  fresh.push(now);
  return false;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  // Must be our app: the anon key is public but proves the call comes
  // from the Beekeeper client, not a drive-by.
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!anonKey || req.headers.get('apikey') !== anonKey) {
    return new Response('unauthorized', { status: 401 });
  }

  // Identity for rate limiting: signed-in parent when available, else IP.
  let identity = 'ip:' + (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ') && authHeader !== `Bearer ${anonKey}`) {
    try {
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) identity = 'user:' + user.id;
    } catch {
      // Fall through to IP-based limiting.
    }
  }
  if (rateLimited(identity)) {
    return new Response('rate limited — try again shortly', { status: 429 });
  }

  if (!GROQ_API_KEY) {
    return new Response('tts not configured', { status: 503 });
  }

  const { text, voice, cheerful } = await req.json();
  if (typeof text !== 'string' || text.length === 0 || text.length > 180) {
    return new Response('text must be 1–180 chars', { status: 400 });
  }
  if (!VOICES.has(voice)) return new Response('unknown voice', { status: 400 });

  // Cheerful tone: prefix with a delivery hint Orpheus understands.
  const input = cheerful ? `*cheerful* ${text}` : text;

  const groqRes = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: GROQ_MODEL, input, voice, response_format: 'wav' }),
  });

  if (!groqRes.ok) {
    const body = await groqRes.text();
    console.error('groq error', groqRes.status, body.slice(0, 200));
    return new Response('tts provider error', { status: 502 });
  }

  const audio = await groqRes.arrayBuffer();
  return new Response(audio, {
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});
