import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isCloudConfigured } from '../lib/supabase';
import { syncNow, pendingCount, lastSyncAt } from '../lib/sync';
import { GROQ_VOICES, getVoice, previewVoice, type GroqVoiceId } from '../audio/player';

interface Props {
  session: Session | null;
  onBack: () => void;
}

/** Parents area: family sync sign-in (magic link) and sync status.
 *  The 4-digit PIN stays a local UI gate; the magic link is the real
 *  authentication that unlocks cloud sync. */
export default function ParentsHome({ session, onBack }: Props) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [voice, setVoiceState] = useState<GroqVoiceId>(() => getVoice());

  function pickVoice(v: GroqVoiceId) {
    setVoiceState(v);
    previewVoice(v);
  }

  useEffect(() => {
    if (session) {
      void pendingCount().then(setPending).catch(() => {});
      void lastSyncAt().then(setLastSync).catch(() => {});
    }
  }, [session]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setSending(true);
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Return to the app itself after the email link is clicked.
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    setSending(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function doSync() {
    setSyncing(true);
    setStatus('');
    setError('');
    try {
      const r = await syncNow();
      setStatus(
        r.pushed === 0 && r.pulled === 0
          ? 'Already up to date.'
          : `Synced — sent ${r.pushed}, received ${r.pulled}.`,
      );
      setPending(await pendingCount());
      setLastSync(await lastSyncAt());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed. Try again.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="screen parents">
      <button className="link" onClick={onBack}>
        ← Back
      </button>
      <h2>Parents</h2>

      <div className="card">
        <h3>Narration voice</h3>
        <p>Tap a voice to hear it — that's the one the kids will get.</p>
        <div className="quiz-actions">
          {GROQ_VOICES.map((v) => (
            <button
              key={v.id}
              className={voice === v.id ? 'primary' : 'secondary'}
              onClick={() => pickVoice(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {!isCloudConfigured ? (
        <p>Cloud sync isn't configured in this build — the app works fully offline.</p>
      ) : !session ? (
        <div className="card">
          <h3>Family sync</h3>
          <p>
            Sign in once on each device with your email address. Arya's and
            Anjali's progress then syncs automatically between the Mac and
            both phones.
          </p>
          {sent ? (
            <p>
              Check your email for the sign-in link — open it on{' '}
              <strong>this device</strong> to finish signing in.
            </p>
          ) : (
            <form onSubmit={sendLink}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
              <div className="quiz-actions">
                <button type="submit" className="primary" disabled={sending}>
                  {sending ? 'Sending…' : 'Email me a sign-in link'}
                </button>
              </div>
            </form>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <div className="card">
          <h3>Family sync</h3>
          <p>Signed in as {session.user.email}</p>
          <p>
            {pending > 0
              ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync.`
              : 'Everything is synced.'}
          </p>
          {lastSync && <p>Last sync: {new Date(lastSync).toLocaleString()}</p>}
          {status && <p>{status}</p>}
          {error && <p className="error">{error}</p>}
          <div className="quiz-actions">
            <button className="primary" onClick={doSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              className="secondary"
              onClick={() => {
                void supabase?.auth.signOut();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
