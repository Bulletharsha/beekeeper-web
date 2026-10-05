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
- **Sync** runs on parent sign-in, on reconnect, and after every finished
  round — push then pull, both idempotent. Handoff happens *between rounds*:
  finish a round on the Mac and the next round on a phone sees the full
  history (grade events, rounds, Anjali's ladder rung).
- **Conflicts**: grade events and rounds are append-only with stable ids, so
  concurrent writes can't conflict. Anjali's ladder rung is last-write-wins
  by timestamp.
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
      player.ts         Scripps MP3 → Groq TTS (edge function) → speechSynthesis
    lib/
      supabase.ts       Supabase client (null when unconfigured — app runs local)
      sync.ts           Push/pull sync engine (idempotent, last-write-wins rung)
    components/         React UI (ModePicker, PinGate, ParentsHome, KidHome, Quiz)
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

## Status (2026-10-05)

Live at **https://bulletharsha.github.io/beekeeper-web/** (GitHub Pages).

- [x] Backend schema + RLS applied; 4,000 words seeded (oneBee 1000 / twoBee 2000 / threeBee 1000)
- [x] TTS edge function deployed (GROQ_API_KEY secret still needs the Groq key in dashboard → Functions → tts → Secrets; app falls back to system speech until then)
- [x] Core quiz UI, scorecards, adaptive ladder
- [x] Sync layer + parent magic-link auth (Supabase project `beekeeper`, ref `jbkyahhcgosmlvhktqpz`, us-west-2)
- [x] PWA packaging (installable, offline-capable)
- [ ] Cross-device testing: sign in on each device via Parents → Family sync, then verify a round on one device appears on another

## Deploy

`GH_PAT=<token> ./scripts/deploy_pages.sh` — pushes source to `main` and
`web/dist` to `gh-pages` (served by GitHub Pages). Commit `scripts/deploy_pages.sh`
before running it: the orphan-branch flow checks out `main` at the end, which
reverts uncommitted changes. The deploy needs `web/.env.local` present at build
time (gitignored; holds `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`).

## Environment notes (2026-10-05)

- This VM's egress proxy hangs requests carrying JWT-shaped `Authorization`/
  `apikey` header values. Use the `sb_publishable_*` key format (never the
  legacy JWT) from this machine, and send it on the `apikey` header only.
- Git needs the proxy spelled out: `git -c http.proxy="$https_proxy" -c https.proxy="$https_proxy" ...`
- PostgREST upserts demand SELECT + UPDATE policies in addition to INSERT;
  the word seed uses plain inserts (table was empty).
- Deploy-script gotchas (learned the hard way):
  - `git checkout <branch>` at the end of a script reverts UNCOMMITTED changes
    — always commit `scripts/deploy_pages.sh` before running it.
  - `git rm -rf .` on the orphan branch deletes the tracked `.gitignore`
    files; the following `git add -A` then swallows `node_modules/`, `dist/`
    and `.env.local` into the pages commit, and the final checkout back to
    `main` deletes them from the working tree. Restore the ignore files
    (`git checkout main -- web/.gitignore .gitignore`) before `git add -A`,
    then unstage them before committing.
  - The script is hermetic: it runs `npm ci` + `npm run build` itself and
    refuses to run without `web/.env.local`.
