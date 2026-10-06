/**
 * Framework-agnostic kids quiz engine.
 *
 * Ported from the quiz flow in Swift's `KidsQuizView.swift`. The engine owns
 * the round state machine; all I/O (storage, audio, speech) goes through
 * callbacks so the same engine runs in React, tests, or anywhere else.
 *
 * Round flow (identical to Swift):
 *  1. `startRound()` builds a 10-word main pass via `nextWord`, resolving
 *     Anjali's adaptive rung and comfort-mixing first.
 *  2. The UI plays each word (`playWord`), collects a typed answer, and
 *     calls `submit()`. Correct → random praise (cheerful tone). Miss →
 *     gentle phrase plus the correct spelling read letter-by-letter.
 *  3. `next()` advances: next word, or the retry pass over main-pass
 *     misses, or `finishRound()`.
 *  4. `finishRound()` computes stars from main-pass accuracy, records the
 *     round (only if at least one word was answered — quitting mid-round
 *     via `quit()` records nothing), and speaks a summary, extra-cheerful
 *     for a perfect round.
 */

import { isCorrect, spelledAloud } from './grading';
import { comfortMixing, nextWord, resolvedLevel, stretchMixing } from './pool';
import { KidsPolicy, starsFor } from './policy';
import type { GradeEvent, KidProfile, WordEntry, WordRecord } from './types';

/** Engine stages. `feedback` is shown after each graded answer. */
export type QuizStage = 'ready' | 'asking' | 'feedback' | 'done';

/** Hint kinds, matching the Swift hint buttons. */
export type HintKind = 'meaning' | 'sentence' | 'origin' | 'kind';

/** Storage + audio capabilities the host app must provide. */
export interface QuizCallbacks {
  getRecords(): WordRecord[];
  getEvents(): GradeEvent[];
  recordGrade(wordID: string, correct: boolean): void;
  recordRound(wordCount: number, correctCount: number, stars: number): void;
  getStoredLevel(): number;
  setStoredLevel(n: number): void;
  /** Play the official pronunciation audio for a word (TTS fallback inside). */
  playWord(entry: WordEntry): void;
  /** Speak non-word narration; cheerful lifts the tone for praise. */
  speakText(text: string, cheerful?: boolean): void;
  stopAudio(): void;
}

/**
 * Spoken praise for correct answers (cheerful tone).
 *
 * NOTE: reconstructed in the spirit of the Swift originals — the Mac is
 * offline, so diff against KidsQuizView.swift before shipping if the exact
 * wording matters.
 */
export const PRAISE_PHRASES = [
  'Nice!',
  'Great spelling!',
  'You got it!',
  'Awesome work!',
  'Exactly right!',
  'Brilliant!',
  'Super!',
];

/** Gentle encouragement for misses, followed by the spelled-aloud answer. */
export const GENTLE_PHRASES = [
  'Good try.',
  'Not quite.',
  'Almost.',
  'Nice effort.',
];

export class QuizEngine {
  readonly profile: KidProfile;
  private readonly wordEntries: WordEntry[];
  private readonly callbacks: QuizCallbacks;
  private readonly rng: () => number;

  stage: QuizStage = 'ready';
  queue: WordEntry[] = [];
  index = 0;
  isRetryPass = false;
  mainCorrect = 0;
  mainAnswered = 0;
  stars = 0;
  /** The kid's typed answer, bound by the UI. Cleared after each submit. */
  answer = '';
  /** Whether the last graded answer was correct (for feedback UI). */
  lastCorrect: boolean | null = null;
  private missed: WordEntry[] = [];

  constructor(
    profile: KidProfile,
    wordEntries: WordEntry[],
    callbacks: QuizCallbacks,
    rng: () => number = Math.random,
  ) {
    this.profile = profile;
    this.wordEntries = wordEntries;
    this.callbacks = callbacks;
    this.rng = rng;
  }

  /** The word currently being asked, if any. */
  get currentEntry(): WordEntry | null {
    return this.queue[this.index] ?? null;
  }

  /** 1-based position within the current pass, for "word 3 of 10" UI. */
  get position(): number {
    return this.index + 1;
  }

  private pick<T>(list: T[]): T {
    return list[Math.floor(this.rng() * list.length)] as T;
  }

  /** Begin a new round: resolve the rung, build the 10-word queue, ask word one. */
  startRound(): void {
    const records = this.callbacks.getRecords();
    const events = this.callbacks.getEvents();
    const level = resolvedLevel(this.callbacks.getStoredLevel(), this.profile, events, records);
    this.callbacks.setStoredLevel(level);
    const comfort = comfortMixing(events, this.profile, records, level);
    const stretch = stretchMixing(events, this.profile, records, level);

    const byID = new Map(this.wordEntries.map((e) => [e.id, e] as const));
    const practiced = new Set<string>();
    const queue: WordEntry[] = [];
    for (let i = 0; i < KidsPolicy.roundSize; i++) {
      const record = nextWord(records, events, this.profile, level, comfort, stretch, practiced, this.rng);
      if (!record) break;
      practiced.add(record.wordID);
      const entry = byID.get(record.wordID);
      if (entry) queue.push(entry);
    }

    this.queue = queue;
    this.index = 0;
    this.isRetryPass = false;
    this.missed = [];
    this.mainCorrect = 0;
    this.mainAnswered = 0;
    this.stars = 0;
    this.answer = '';
    this.lastCorrect = null;

    if (queue.length === 0) {
      this.stage = 'done';
      this.callbacks.speakText('No words to practice right now.');
      return;
    }
    this.stage = 'asking';
    this.callbacks.playWord(queue[0]);
  }

  /**
   * Grade the typed answer for the current word. Speaks praise (cheerful)
   * or a gentle phrase plus the letter-by-letter spelling, then moves to
   * the `feedback` stage — call `next()` to continue.
   */
  submit(): void {
    if (this.stage !== 'asking') return;
    const entry = this.currentEntry;
    if (!entry) return;
    const correct = isCorrect(this.answer, entry.spelling);
    this.lastCorrect = correct;
    this.callbacks.recordGrade(entry.id, correct);

    if (!this.isRetryPass) {
      this.mainAnswered += 1;
      if (correct) {
        this.mainCorrect += 1;
      } else {
        this.missed.push(entry);
      }
    }

    if (correct) {
      this.callbacks.speakText(this.pick(PRAISE_PHRASES), true);
    } else {
      this.callbacks.speakText(
        `${this.pick(GENTLE_PHRASES)} The correct spelling is: ${spelledAloud(entry.spelling)}`,
      );
    }
    this.answer = '';
    this.stage = 'feedback';
  }

  /**
   * Advance from the `feedback` stage: next word, the retry pass over
   * main-pass misses, or the round summary when everything is done.
   */
  next(): void {
    if (this.stage !== 'feedback') return;
    this.index += 1;
    if (this.index < this.queue.length) {
      this.stage = 'asking';
      this.callbacks.playWord(this.queue[this.index]);
      return;
    }
    if (!this.isRetryPass && this.missed.length > 0) {
      this.queue = [...this.missed];
      this.missed = [];
      this.index = 0;
      this.isRetryPass = true;
      this.stage = 'asking';
      this.callbacks.playWord(this.queue[0]);
      return;
    }
    this.finishRound();
  }

  /** Replay the current word's pronunciation (the 'p' shortcut in Swift). */
  replayWord(): void {
    const entry = this.currentEntry;
    if (entry && (this.stage === 'asking' || this.stage === 'feedback')) {
      this.callbacks.playWord(entry);
    }
  }

  /**
   * Spoken hint text for the current word. The host typically passes the
   * result straight to `speakText`.
   *
   * NOTE: templates reconstructed in the spirit of the Swift originals.
   */
  hintText(kind: HintKind): string {
    const entry = this.currentEntry;
    if (!entry) return '';
    switch (kind) {
      case 'meaning':
        return entry.definition
          ? `Meaning: ${entry.definition}`
          : 'No meaning listed for this word.';
      case 'sentence':
        return entry.example
          ? `Sentence: ${entry.example}`
          : 'No example sentence for this word.';
      case 'origin':
        return entry.languageOrigin
          ? `Language of origin: ${entry.languageOrigin}`
          : 'No origin listed for this word.';
      case 'kind':
        return entry.partOfSpeech
          ? `Kind of word: ${entry.partOfSpeech}`
          : 'No word kind listed.';
    }
  }

  /**
   * Quit mid-round. Stops audio and discards the round — per the Swift
   * app, quitting never records a KidRound.
   */
  quit(): void {
    this.callbacks.stopAudio();
    this.stage = 'ready';
    this.queue = [];
    this.index = 0;
    this.isRetryPass = false;
    this.missed = [];
    this.mainCorrect = 0;
    this.mainAnswered = 0;
    this.stars = 0;
    this.answer = '';
    this.lastCorrect = null;
  }

  private finishRound(): void {
    const accuracy = this.mainAnswered > 0 ? this.mainCorrect / this.mainAnswered : 0;
    this.stars = starsFor(accuracy);
    if (this.mainAnswered > 0) {
      this.callbacks.recordRound(this.mainAnswered, this.mainCorrect, this.stars);
    }
    if (this.mainAnswered === 0) {
      this.callbacks.speakText('Round over!');
    } else if (this.mainCorrect === this.mainAnswered) {
      this.callbacks.speakText(
        `Perfect round! You spelled all ${this.mainAnswered} words right!`,
        true,
      );
    } else {
      this.callbacks.speakText(
        `Round over! You got ${this.mainCorrect} out of ${this.mainAnswered} right. Great practicing!`,
      );
    }
    this.stage = 'done';
  }
}
