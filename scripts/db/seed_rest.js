// One-time seed of the 4,000 words via PostgREST (HTTPS).
// Requires the TEMPORARY "temp seed words" insert policy to exist.
const fs = require('fs');

const URL = 'https://jbkyahhcgosmlvhktqpz.supabase.co';
// New-style publishable key (sb_publishable_*): public by design, and unlike
// the legacy JWT it passes this machine's egress filter.
const ANON = 'sb_publishable_8IxoMEmppHzVQOUkNc1S0Q_TfkVn3fJ';
const TIER = { one_bee: 'oneBee', two_bee: 'twoBee', three_bee: 'threeBee' };

async function main() {
  const data = JSON.parse(fs.readFileSync('/home/hatch/workspace/beekeeper-words/Words.enriched.json', 'utf8'));
  const words = data.words.map((w) => ({
    id: w.id,
    spelling: w.spelling,
    tier: TIER[w.tier] || 'oneBee',
    definition: w.definition || '',
    example: w.example || '',
    language_origin: w.languageOrigin || '',
    part_of_speech: w.partOfSpeech || '',
    audio_url: w.audioURL || null,
  }));
  console.log('words to seed:', words.length);

  const BATCH = 200;
  for (let i = 0; i < words.length; i += BATCH) {
    const chunk = words.slice(i, i + BATCH);
    const res = await fetch(`${URL}/rest/v1/words`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`batch ${i / BATCH} failed: ${res.status} ${t.slice(0, 300)}`);
    }
    if ((i / BATCH) % 5 === 0) console.log(`seeded ${i + chunk.length}/${words.length}`);
  }

  const rc = await fetch(`${URL}/rest/v1/words?select=tier`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  console.log('verify status:', rc.status, '(RLS: anon select should be blocked until auth)');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
