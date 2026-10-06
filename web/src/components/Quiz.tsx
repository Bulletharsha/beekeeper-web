import { useEffect, useRef, useState } from 'react';
import type { KidProfile } from '../App';
import { KID_NAMES } from '../App';
import { db, getMeta, setMeta, type WordRow } from '../db/database';
import { playWordAudio, speakText, stopAudio } from '../audio/player';
import { QuizEngine, hasSavedRound, clearSavedRound, type HintKind } from '../logic/quiz';
import { KidsPolicy } from '../logic/policy';
import type { GradeEvent, WordEntry, WordRecord } from '../logic/types';

interface Props {
  profile: KidProfile;
  onExit: () => void;
  /** When true, pick up the saved in-progress round instead of starting new. */
  resume?: boolean;
}

function toEntry(w: WordRow): WordEntry {
  return {
    id: w.id,
    spelling: w.spelling,
    tier: w.tier,
    definition: w.definition,
    example: w.example,
    languageOrigin: w.languageOrigin,
    partOfSpeech: w.partOfSpeech,
    audioUrl: w.audioUrl,
  };
}

const HINTS: { kind: HintKind; label: string }[] = [
  { kind: 'meaning', label: 'Meaning' },
  { kind: 'sentence', label: 'Sentence' },
  { kind: 'origin', label: 'Origin' },
  { kind: 'kind', label: 'Word kind' },
];

export default function Quiz({ profile, onExit, resume }: Props) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [answer, setAnswer] = useState('');
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // In-memory mirrors of IndexedDB for the sync engine callbacks.
  const recordsRef = useRef<WordRecord[]>([]);
  const eventsRef = useRef<GradeEvent[]>([]);
  const entriesRef = useRef<WordEntry[]>([]);
  const engineRef = useRef<QuizEngine | null>(null);
  const beginRoundRef = useRef(() => {});

  useEffect(() => {
    (async () => {
      const [words, records, events] = await Promise.all([
        db.words.toArray(),
        db.wordRecords.toArray(),
        db.gradeEvents.toArray(),
      ]);
      if (words.length === 0) {
        // Word list failed to load (e.g. offline on first run) — say so
        // plainly instead of "completing" an empty round.
        setLoadError(true);
        setReady(true);
        return;
      }
      entriesRef.current = words.map(toEntry);
      recordsRef.current = records.map((r) => ({
        wordID: r.wordID,
        spelling: r.spelling,
        tierRaw: r.tierRaw,
        lastGradedSession: r.lastGradedSession,
        lastCorrect: r.lastCorrect,
        timesSeen: r.timesSeen,
        correctCount: r.correctCount,
        wrongCount: r.wrongCount,
      }));
      eventsRef.current = events.map((e) => ({
        wordID: e.wordID,
        sessionNumber: e.sessionNumber,
        correct: e.correct,
        timestamp: e.timestamp,
        kid: e.kid,
      }));

      // Load persisted adaptive state before the engine is built, so the
      // callbacks close over live mutable values — no patching needed.
      // Level schema v2: the shared 5-rung ladder replaced Anjali's old
      // 4-rung one; reset stored rungs to each kid's start level once.
      const levelSchema = await getMeta<number>('beekeeper.levelSchema', 1);
      let currentLevel: number =
        (await getMeta<number | null>(`beekeeper.level.${profile}`, null)) ??
        KidsPolicy.startLevel[profile] ??
        0;
      if (levelSchema < 2) {
        currentLevel = KidsPolicy.startLevel[profile] ?? 0;
        await setMeta(`beekeeper.level.${profile}`, currentLevel);
        await setMeta('beekeeper.levelSchema', 2);
      }
      let sessionNumber = await getMeta<number>(`beekeeper.session.${profile}`, 0);

      const engine = new QuizEngine(profile, entriesRef.current, {
        getRecords: () => recordsRef.current,
        getEvents: () => eventsRef.current,
        recordGrade: (wordID, correct) => {
          const now = Date.now();
          eventsRef.current.push({
            wordID,
            sessionNumber,
            correct,
            timestamp: now,
            kid: profile,
          });
          void db.gradeEvents.add({
            wordID,
            sessionNumber,
            correct,
            timestamp: now,
            kid: profile,
            synced: false,
          });
          const entry = entriesRef.current.find((e) => e.id === wordID);
          const rec = recordsRef.current.find((r) => r.wordID === wordID);
          if (rec) {
            rec.timesSeen += 1;
            rec.correctCount += correct ? 1 : 0;
            rec.wrongCount += correct ? 0 : 1;
            rec.lastCorrect = correct;
            void db.wordRecords.update(wordID, {
              timesSeen: rec.timesSeen,
              correctCount: rec.correctCount,
              wrongCount: rec.wrongCount,
              lastCorrect: correct,
            });
          } else if (entry) {
            const fresh: WordRecord = {
              wordID,
              spelling: entry.spelling,
              tierRaw: entry.tier,
              timesSeen: 1,
              correctCount: correct ? 1 : 0,
              wrongCount: correct ? 0 : 1,
              lastCorrect: correct,
            };
            recordsRef.current.push(fresh);
            void db.wordRecords.add({
              wordID,
              spelling: entry.spelling,
              tierRaw: entry.tier,
              timesSeen: 1,
              correctCount: correct ? 1 : 0,
              wrongCount: correct ? 0 : 1,
              lastCorrect: correct,
            });
          }
        },
        recordRound: (wordCount, correctCount, stars) => {
          void db.kidRounds.add({
            id: crypto.randomUUID(),
            kid: profile,
            startedAt: Date.now(),
            wordCount,
            correctCount,
            stars,
            synced: false,
          });
        },
        getStoredLevel: () => currentLevel,
        setStoredLevel: (n) => {
          currentLevel = n;
          void setMeta(`beekeeper.level.${profile}`, n);
          // Timestamped for last-write-wins sync of each kid's rung.
          void setMeta(`beekeeper.levelUpdatedAt.${profile}`, Date.now());
        },
        playWord: (e) => playWordAudio(e.audioUrl, e.spelling),
        speakText: (text, cheerful) => {
          void speakText(text, cheerful);
        },
        stopAudio: () => stopAudio(),
      });

      // Each round gets its own session number so the cloud history can
      // group a device's answers into rounds. Resuming keeps the same
      // session — it's a continuation, not a new round.
      beginRoundRef.current = () => {
        const saved = resume ? hasSavedRound(profile) : null;
        if (saved && engine.resumeRound(saved)) {
          return;
        }
        if (saved) clearSavedRound(profile); // stale words; start fresh
        sessionNumber += 1;
        void setMeta(`beekeeper.session.${profile}`, sessionNumber);
        engine.startRound();
      };

      engineRef.current = engine;
      setReady(true);
      beginRoundRef.current();
      force((x) => x + 1);
    })();
    return () => {
      engineRef.current?.quit();
    };
  }, [profile]);

  const engine = engineRef.current;

  function refresh() {
    force((x) => x + 1);
    setTimeout(() => {
      if (engineRef.current?.stage === 'asking') inputRef.current?.focus();
    }, 50);
  }

  function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!engine) return;
    if (engine.stage === 'asking') {
      engine.answer = answer;
      engine.submit();
      setAnswer('');
    } else if (engine.stage === 'feedback') {
      engine.next();
    }
    refresh();
  }

  if (!ready || (!engine && !loadError)) {
    return (
      <div className="screen quiz">
        <p>Loading…</p>
      </div>
    );
  }

  if (loadError || !engine) {
    return (
      <div className="screen quiz">
        <div className="quiz-card">
          <h2>Couldn't load the words</h2>
          <p style={{ color: 'var(--muted)' }}>
            The word list didn't download. Connect to the internet once and try
            again — after that it works offline.
          </p>
          <div className="quiz-actions" style={{ justifyContent: 'center' }}>
            <button className="primary" onClick={onExit}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const entry = engine.currentEntry;
  const isRetry = engine.isRetryPass;

  return (
    <div className="screen quiz">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="progress">
          {engine.stage === 'done'
            ? 'Round complete'
            : engine.queue.length > 0
              ? `${isRetry ? 'Retry' : 'Word'} ${engine.position} of ${engine.queue.length}`
              : ''}
        </span>
        <button
          className="link"
          style={{ margin: 0 }}
          onClick={() => {
            engine.quit();
            stopAudio();
            onExit();
          }}
        >
          Quit
        </button>
      </div>

      {(engine.stage === 'asking' || engine.stage === 'feedback') && entry && (
        <div className="quiz-card">
          <button
            className="speaker-btn"
            onClick={() => playWordAudio(entry.audioUrl, entry.spelling)}
            aria-label="Hear the word"
          >
            🔊
          </button>
          <div className="hint-row">
            {HINTS.map((h) => (
              <button
                key={h.kind}
                onClick={() => {
                  // Hints read slower so young kids can follow.
                  void speakText(engine.hintText(h.kind), false, 0.72);
                }}
              >
                {h.label}
              </button>
            ))}
          </div>
          {engine.stage === 'asking' ? (
            <form onSubmit={onSubmit}>
              <input
                ref={inputRef}
                className="answer-input"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type the spelling"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
              />
              <div className="quiz-actions">
                <button type="submit" className="primary" disabled={answer.trim() === ''}>
                  Check
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className={`feedback ${engine.lastCorrect ? 'correct' : 'wrong'}`}>
                {engine.lastCorrect ? 'Correct! 🎉' : 'Not quite.'}
              </div>
              <div className="quiz-actions">
                <button className="primary" onClick={() => onSubmit()}>
                  Next
                </button>
              </div>
            </>
          )}
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 16 }}>
            {KID_NAMES[profile]} — the spelling is never shown, only heard. 🤫
          </p>
        </div>
      )}

      {engine.stage === 'done' && (
        <div className="quiz-card done-card">
          <div className="big-stars">{'⭐'.repeat(Math.max(1, engine.stars))}</div>
          <h2>
            {engine.mainCorrect} of {engine.mainAnswered} correct
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            {engine.mainCorrect === engine.mainAnswered && engine.mainAnswered > 0
              ? 'Perfect round! 🏆'
              : 'Great practicing!'}
          </p>
          <div className="quiz-actions" style={{ justifyContent: 'center' }}>
            <button
              className="primary"
              onClick={() => {
                beginRoundRef.current();
                setAnswer('');
                refresh();
              }}
            >
              Practice again
            </button>
            <button className="secondary" onClick={onExit}>
              Scorecard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
