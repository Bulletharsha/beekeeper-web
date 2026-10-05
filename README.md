# Beekeeper Web

Spelling-bee practice PWA for Arya and Anjali. Works on iPhones (Add to Home Screen),
any browser on the Mac, anywhere. No Apple Developer account needed.

## Architecture: local-first + background sync

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   iPhone 1  │     │   iPhone 2  │     │     Mac     │
│  IndexedDB  │     │  IndexedDB  │     │  IndexedDB  │
│  (full copy)│     │  (full copy)│     │  (full copy)│
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │ background sync  │                  │
       └──────────────────┼──────────────────┘
                          ▼
                   ┌─────────────┐
                   │  Supabase   │
                   │  Postgres   │
                   │  Realtime   │
                   │  Auth       │
                   └─────────────┘
```

- **Writes** land in IndexedDB instantly (offline-capable), then a background
  queue pushes to Supabase. Reads prefer local.
- **Realtime subscriptions** pull other devices' changes in. Handoff is seamless:
  start a round on the Mac, continue on a phone.
- **Conflicts**: last-write-wins by timestamp. Per-kid data means real conflicts
  basically can't happen (a kid is on one device at a time).
- **Service worker** caches the app shell, all 4,000 words, and played audio.

## Project layout

```
web/                    React + Vite + TypeScript PWA
  src/
    logic/              Pure quiz logic, ported from the Swift app. No React.
      types.ts          WordEntry, WordRecord, GradeEvent, KidRound, KidProfile
      policy.ts         Thresholds + star calculation
      pool.ts           KidsWordPool: adaptive ladder, per-kid seen tracking
      grading.ts        Answer normalization + letter-by-letter spelling
      scorecard.ts      KidScorecardStats: streaks, trends, high scores
      quiz.ts           Framework-agnostic quiz engine state machine
    db/
      database.ts       Dexie IndexedDB schema + word seeding
    audio/
      player.ts         Scripps MP3 → Groq TTS (via /api/tts) → speechSynthesis
    components/         React UI
    sync/               Supabase client, push queue, realtime (Phase 4)
  public/data/
    words.json          4,000 enriched words (1.6MB minified)
supabase/
  migrations/           Postgres schema with RLS
  functions/tts/        Groq Orpheus TTS proxy (key stays server-side)
```

## Data model

- `words` — 4,000 enriched words (spelling, tier, definition, example, origin, POS, audio URL)
- `grade_events` — append-only; every graded answer per kid. Source of truth for progress.
- `kid_rounds` — completed rounds only (quitting mid-round records nothing).
- `kid_state` — Anjali's ladder rung (last-write-wins).

## Security

- Parents sign in with email magic links (Supabase Auth). Kids use the app on a
  signed-in device; there are no kid accounts.
- RLS on all tables: no auth token, no access.
- Groq API key lives in the edge function's secrets, never in the browser.
- TTS endpoint requires auth + rate-limits (10 req/min/user).
- No trackers, no analytics. Kids are `arya`/`anjali` identifiers, not names.

## Status

- [x] Phase 1: Backend schema + TTS edge function drafted (needs Supabase project)
- [ ] Phase 2: Core quiz UI (in progress)
- [ ] Phase 3: Scorecards + adaptive ladder UI
- [ ] Phase 4: Sync layer + auth
- [ ] Phase 5: PWA packaging
- [ ] Phase 6: Cross-device testing
