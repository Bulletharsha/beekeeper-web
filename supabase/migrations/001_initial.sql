-- Beekeeper web backend schema.
-- Local-first: the app writes to IndexedDB instantly and syncs here in the
-- background. RLS requires authentication for all access.

-- 4,000 enriched words, seeded from Words.min.json
create table words (
  id text primary key,
  spelling text not null,
  tier text not null check (tier in ('oneBee', 'twoBee', 'threeBee')),
  definition text not null default '',
  example text not null default '',
  language_origin text not null default '',
  part_of_speech text not null default '',
  audio_url text
);
create index words_tier_idx on words (tier);

-- Append-only grading log. Source of truth for per-kid progress.
create table grade_events (
  id uuid primary key default gen_random_uuid(),
  kid text not null check (kid in ('arya', 'anjali')),
  word_id text not null references words (id),
  correct boolean not null,
  session_number integer not null,
  created_at timestamptz not null default now(),
  device_id text not null default ''
);
create index grade_events_kid_idx on grade_events (kid, created_at desc);

-- Completed practice rounds for scorecards. Only finished rounds recorded.
create table kid_rounds (
  id uuid primary key default gen_random_uuid(),
  kid text not null check (kid in ('arya', 'anjali')),
  started_at timestamptz not null,
  word_count integer not null,
  correct_count integer not null,
  stars integer not null check (stars between 1 and 3),
  device_id text not null default '',
  created_at timestamptz not null default now()
);
create index kid_rounds_kid_idx on kid_rounds (kid, started_at desc);

-- Per-kid mutable state (Anjali's ladder rung). Last-write-wins.
create table kid_state (
  kid text primary key check (kid in ('arya', 'anjali')),
  anjali_level integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Row-level security: authenticated parents only. The kids use the app on
-- a parent's signed-in device; there are no kid accounts.
alter table words enable row level security;
alter table grade_events enable row level security;
alter table kid_rounds enable row level security;
alter table kid_state enable row level security;

create policy "authenticated read words"
  on words for select to authenticated using (true);

create policy "authenticated manage grade_events"
  on grade_events for all to authenticated using (true) with check (true);

create policy "authenticated manage kid_rounds"
  on kid_rounds for all to authenticated using (true) with check (true);

create policy "authenticated manage kid_state"
  on kid_state for all to authenticated using (true) with check (true);
