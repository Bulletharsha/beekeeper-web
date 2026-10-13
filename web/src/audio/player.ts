/** Audio playback: Scripps word MP3s first, Groq Orpheus narration for
 *  everything else, Web Speech API as the offline fallback.
 *
 *  In the web app Groq is reached through our own edge function
 *  (POST /api/tts { text, voice, cheerful }) so the API key never touches
 *  the browser. Until the backend exists, speakText falls back to speechSynthesis.
 */

import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/supabase';

export type GroqVoiceId = 'autumn' | 'diana' | 'hannah' | 'austin' | 'daniel' | 'troy';

export const GROQ_VOICES: { id: GroqVoiceId; label: string }[] = [
  { id: 'autumn', label: 'Autumn' },
  { id: 'diana', label: 'Diana' },
  { id: 'hannah', label: 'Hannah' },
  { id: 'austin', label: 'Austin' },
  { id: 'daniel', label: 'Daniel' },
  { id: 'troy', label: 'Troy' },
];

const TTS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/tts` : null;
const VOICE_KEY = 'beekeeper.voice';
const ttsCache = new Map<string, string>(); // cacheKey -> object URL
/** Set when the server reports 503 (no GROQ_API_KEY yet): skip Groq and
 *  go straight to system speech for the rest of this page load. */
let groqKnownMissing = false;

function cacheKey(text: string, voice: GroqVoiceId, cheerful: boolean): string {
  return `${voice}|${cheerful ? 'c' : 'n'}|${text}`;
}

export function getVoice(): GroqVoiceId {
  const v = localStorage.getItem(VOICE_KEY);
  return GROQ_VOICES.some((g) => g.id === v) ? (v as GroqVoiceId) : 'autumn';
}

export function setVoice(v: GroqVoiceId): void {
  localStorage.setItem(VOICE_KEY, v);
}

/** Preview a Groq voice (Parents voice picker): selects it and speaks a
 *  sample hint so you can judge clarity. Tapping a voice IS selecting it. */
export function previewVoice(v: GroqVoiceId): void {
  setVoice(v);
  speakText('The meaning of the word abaft is: toward the back of a ship.', false, 1.0);
}

/** Narration speed: 10% faster than natural (1.0). Word pronunciations
 *  (playWordAudio) stay at natural speed — only the talking-around-it
 *  gets quicker. */
export const NARRATION_RATE = 1.05;

let currentAudio: HTMLAudioElement | null = null;
/**
 * Monotonic generation: every speakText() bumps this. An async Groq fetch
 * that completes after a newer speakText() started is stale — it must not
 * play (it would talk over the new utterance).
 */
let speakGeneration = 0;

/** Groq Orpheus speed for narration (10% up). Words stay untouched. */
const GROQ_NARRATION_SPEED = 1.1;

/**
 * Minimum plausible WAV duration for a TTS text, in seconds. Groq audio
 * sometimes arrives truncated (the stream drops mid-response and
 * res.blob() silently accepts the partial file) — the last second or two
 * goes missing, which is exactly "skips the last 1-2 letters". Anything
 * shorter than this is treated as truncated: retry once, then fall back
 * to system speech rather than play a clipped utterance.
 */
function minDurationSec(text: string): number {
  // ~20 chars/sec is brisk narration; anything under this for the text
  // length means the stream dropped mid-utterance.
  return Math.max(1.5, text.length * 0.05);
}

/** Parse an audio blob's duration in seconds via metadata; null on failure. */
function audioDurationSec(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    const done = (d: number | null) => resolve(d);
    audio.addEventListener('loadedmetadata', () => {
      done(Number.isFinite(audio.duration) ? audio.duration : null);
    }, { once: true });
    audio.addEventListener('error', () => done(null), { once: true });
    setTimeout(() => done(null), 5000);
  });
}

function stopCurrent(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if ('speechSynthesis' in window) {
    const synth = window.speechSynthesis;
    // Only cancel when something is actually queued/playing: on iOS a
    // no-op cancel() immediately followed by speak() can swallow the
    // new utterance.
    if (synth.speaking || synth.pending) synth.cancel();
  }
}

/** Play the official Scripps pronunciation MP3 for a word. */
export function playWordAudio(audioUrl: string | undefined, spelling: string): void {
  stopCurrent();
  if (audioUrl) {
    const audio = new Audio(audioUrl);
    currentAudio = audio;
    audio.play().catch(() => speakWithFallback(`The word is: ${spelling}`));
  } else {
    speakWithFallback(`The word is: ${spelling}`);
  }
}

/** Narrate non-word text. Tries Groq Orpheus via our edge function first
 *  (kids mode included — the function accepts our app's anon key and
 *  rate-limits; no sign-in needed), falling back to the browser's speech
 *  synthesis — called SYNCHRONOUSLY. iOS Safari silently ignores
 *  speechSynthesis.speak() once the user-gesture call stack is gone, so
 *  no await may precede it on the fallback path. */
export function speakText(text: string, cheerful = false, rate = NARRATION_RATE): void {
  const gen = ++speakGeneration;
  stopCurrent();
  const voice = getVoice();
  const key = cacheKey(text, voice, cheerful);
  const cached = ttsCache.get(key);
  if (cached) {
    const audio = new Audio(cached);
    currentAudio = audio;
    audio.play().catch(() => speakWithFallback(text, rate));
    return;
  }
  if (TTS_URL && SUPABASE_ANON_KEY && !groqKnownMissing) {
    // Groq via edge function, in the background. Falls back to system
    // speech if the key isn't configured server-side yet.
    void fetchGroqNarration(text, voice, cheerful, key, rate, gen);
    return;
  }
  speakWithFallback(text, rate);
}

/** Groq Orpheus narration (async by nature). Gets a fresh token (signing in
 *  anonymously if needed) rather than trusting the cached one, and retries
 *  once on 401 in case the session expired. Validates the WAV duration and
 *  retries once on truncation — a clipped utterance is worse than the
 *  system-voice fallback. Stale completions (a newer speakText superseded
 *  this one) never play. */
async function fetchGroqNarration(
  text: string,
  voice: GroqVoiceId,
  cheerful: boolean,
  key: string,
  rate: number,
  gen: number,
): Promise<void> {
  const isStale = () => gen !== speakGeneration;
  try {
    let token: string | null = null;
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token ?? null;
      if (!token) {
        const { data: anon } = await supabase.auth.signInAnonymously();
        token = anon.session?.access_token ?? null;
      }
    }
    if (isStale()) return;
    const doFetch = (t: string | null) =>
      fetch(TTS_URL as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${t ?? SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ text, voice, cheerful, speed: GROQ_NARRATION_SPEED }),
      });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (isStale()) return;
      let res = await doFetch(token);
      if (res.status === 401 && supabase) {
        // Token may have expired — refresh and retry once.
        const { data } = await supabase.auth.refreshSession();
        token = data.session?.access_token ?? null;
        res = await doFetch(token);
      }
      if (!res.ok) {
        if (res.status === 503) groqKnownMissing = true; // no server key yet
        throw new Error(`tts ${res.status}`);
      }
      const blob = await res.blob();
      if (isStale()) return;
      const url = URL.createObjectURL(blob);
      const dur = await audioDurationSec(url);
      const minDur = minDurationSec(text);
      if (dur !== null && dur < minDur) {
        URL.revokeObjectURL(url);
        // Truncated audio — retry once, then fall back to system speech.
        if (attempt === 0) continue;
        throw new Error(`tts truncated (${dur.toFixed(1)}s < ${minDur.toFixed(1)}s)`);
      }
      ttsCache.set(key, url);
      if (isStale()) {
        URL.revokeObjectURL(url);
        return;
      }
      const audio = new Audio(url);
      currentAudio = audio;
      await audio.play().catch(() => speakWithFallback(text, rate));
      return;
    }
  } catch {
    if (!isStale()) speakWithFallback(text, rate);
  }
}

/** Best available system voice, picked once voices load. iOS Safari
 *  populates getVoices() asynchronously, so we (re)pick on voiceschanged.
 *  Without this the utterance gets whatever the default is — often the
 *  most robotic compact voice on the device. */
let preferredVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): void {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return;
  preferredVoice =
    voices.find((v) => v.lang === 'en-US' && /samantha/i.test(v.name)) ??
    voices.find((v) => v.lang === 'en-US' && v.localService && /female/i.test(v.name)) ??
    voices.find((v) => v.lang === 'en-US' && v.localService) ??
    voices.find((v) => v.lang?.startsWith('en-US')) ??
    voices.find((v) => v.lang?.startsWith('en')) ??
    null;
}

if ('speechSynthesis' in window) {
  pickVoice();
  window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

/** Offline / no-backend fallback: the browser's built-in speech. Must run
 *  synchronously inside the tap handler on iOS. */
function speakWithFallback(text: string, rate = 0.95): void {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  if (!preferredVoice) pickVoice();
  if (preferredVoice) u.voice = preferredVoice;
  synth.speak(u);
  // iOS Safari sometimes parks speechSynthesis in a stuck paused state
  // where speak() silently does nothing; resume() unsticks it.
  if (synth.paused) synth.resume();
}

/** Spell a word aloud letter by letter: "A. B. A. F. T" (no trailing
 *  period — see grading.ts). */
export function spelledAloud(spelling: string): string {
  return spelling.toUpperCase().split('').join('. ');
}

export function stopAudio(): void {
  stopCurrent();
}
