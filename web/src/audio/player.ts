/** Audio playback: Scripps word MP3s first, Groq Orpheus narration for
 *  everything else, Web Speech API as the offline fallback.
 *
 *  In the web app Groq is reached through our own edge function
 *  (POST /api/tts { text, voice, cheerful }) so the API key never touches
 *  the browser. Until the backend exists, speakText falls back to speechSynthesis.
 */

import { getCachedToken, SUPABASE_URL } from '../lib/supabase';

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

let currentAudio: HTMLAudioElement | null = null;

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

/** Narrate non-word text. A signed-in parent gets Groq Orpheus narration
 *  via the edge function; everyone else (the kids' normal path) gets the
 *  browser's speech synthesis -- called SYNCHRONOUSLY. iOS Safari silently
 *  ignores speechSynthesis.speak() once the user-gesture call stack is gone,
 *  so no await may precede it on that path. */
export function speakText(text: string, cheerful = false): void {
  stopCurrent();
  const voice = getVoice();
  const key = cacheKey(text, voice, cheerful);
  const cached = ttsCache.get(key);
  if (cached) {
    const audio = new Audio(cached);
    currentAudio = audio;
    audio.play().catch(() => speakWithFallback(text));
    return;
  }
  const token = getCachedToken();
  if (TTS_URL && token) {
    // Signed-in parent path: fetch Groq narration in the background.
    void fetchGroqNarration(text, voice, cheerful, key, token);
    return;
  }
  speakWithFallback(text);
}

/** Groq Orpheus narration for signed-in parents (async by nature). */
async function fetchGroqNarration(
  text: string,
  voice: GroqVoiceId,
  cheerful: boolean,
  key: string,
  token: string,
): Promise<void> {
  try {
    const res = await fetch(TTS_URL as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ text, voice, cheerful }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    ttsCache.set(key, url);
    const audio = new Audio(url);
    currentAudio = audio;
    await audio.play().catch(() => speakWithFallback(text));
  } catch {
    speakWithFallback(text);
  }
}

/** Offline / no-backend fallback: the browser's built-in speech. Must run
 *  synchronously inside the tap handler on iOS. */
function speakWithFallback(text: string): void {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  synth.speak(u);
  // iOS Safari sometimes parks speechSynthesis in a stuck paused state
  // where speak() silently does nothing; resume() unsticks it.
  if (synth.paused) synth.resume();
}

/** Spell a word aloud letter by letter: "A. B. A. F. T." */
export function spelledAloud(spelling: string): string {
  return spelling.toUpperCase().split('').join('. ') + '.';
}

export function stopAudio(): void {
  stopCurrent();
}
