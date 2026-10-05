// One-time backend bootstrap: applies the migration and seeds the 4,000 words.
// DB password comes from the DB_PASSWORD env var — never written to disk.
const { Client } = require('pg');
const fs = require('fs');

const HOME = '/home/hatch';
const TIER = { one_bee: 'oneBee', two_bee: 'twoBee', three_bee: 'threeBee' };

async function main() {
  const client = new Client({
    host: 'db.jbkyahhcgosmlvhktqpz.supabase.co',
    port: 6543,
    user: 'postgres.jbkyahhcgosmlvhktqpz',
    password: process.env.DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('connected');

  const { rows: t } = await client.query(`select to_regclass('public.words') as tbl`);
  if (!t[0].tbl) {
    const mig = fs.readFileSync(`${HOME}/workspace/beekeeper-web/supabase/migrations/001_initial.sql`, 'utf8');
    await client.query(mig);
    console.log('migration applied');
  } else {
    console.log('tables already exist, skipping migration');
  }

  const data = JSON.parse(fs.readFileSync(`${HOME}/workspace/beekeeper-words/Words.enriched.json`, 'utf8'));
  const words = data.words;
  console.log('source words:', words.length);

  const { rows: c0 } = await client.query('select count(*)::int as c from words');
  console.log('words already in db:', c0[0].c);

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < words.length; i += BATCH) {
    const chunk = words.slice(i, i + BATCH);
    const vals = [];
    const params = [];
    chunk.forEach((w, j) => {
      const o = j * 8;
      vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`);
      params.push(
        w.id,
        w.spelling,
        TIER[w.tier] || 'oneBee',
        w.definition || '',
        w.example || '',
        w.languageOrigin || '',
        w.partOfSpeech || '',
        w.audioURL || null,
      );
    });
    const sql = `insert into words (id, spelling, tier, definition, example, language_origin, part_of_speech, audio_url)
      values ${vals.join(',')}
      on conflict (id) do update set spelling=excluded.spelling, tier=excluded.tier,
        definition=excluded.definition, example=excluded.example,
        language_origin=excluded.language_origin, part_of_speech=excluded.part_of_speech,
        audio_url=excluded.audio_url`;
    const r = await client.query(sql, params);
    inserted += r.rowCount;
  }
  console.log('upserted rows:', inserted);
  const { rows: c1 } = await client.query(`select tier, count(*)::int as c from words group by tier order by tier`);
  console.log('by tier:', JSON.stringify(c1));
  await client.end();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
