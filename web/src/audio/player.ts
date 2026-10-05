/** Audio playback: Scripps word MP3s first, Groq Orpheus narration for
 *  everything else, Web Speech API as the offline fallback.
 *
 *  In the web app Groq is reached through our own edge function
 *  (POST /api/tts { text, voice, cheerful }) so the API key never touches
 *  the browser. Until the backend exists, speakText falls back to speechSynthesis.
 */

import { getAccessToken, SUPABASE_URL } from '../lib/supabase';

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
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
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

/** Narrate non-word text. Tries Groq via our edge function (parent must be
 *  signed in), falls back to the browser's speech synthesis. */
export async function speakText(text: string, cheerful = false): Promise<void> {
  stopCurrent();
  const voice = getVoice();
  const key = cacheKey(text, voice, cheerful);
  const cached = ttsCache.get(key);
  if (cached) {
    const audio = new Audio(cached);
    currentAudio = audio;
    await audio.play().catch(() => speakWithFallback(text));
    return;
  }
  try {
    if (!TTS_URL) throw new Error('tts not configured');
    const token = await getAccessToken();
    if (!token) throw new Error('not signed in');
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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

/** Offline / no-backend fallback: the browser's built-in speech. */
function speakWithFallback(text: string): void {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

/** Spell a word aloud letter by letter: "A. B. A. F. T." */
export function spelledAloud(spelling: string): string {
  return spelling.toUpperCase().split('').join('. ') + '.';
}

export function stopAudio(): void {
  stopCurrent();
}
