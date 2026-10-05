import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import './App.css';
import { db, ensureWordsSeeded } from './db/database';
import { supabase } from './lib/supabase';
import { syncNow } from './lib/sync';
import ModePicker from './components/ModePicker';
import PinGate from './components/PinGate';
import ParentsHome from './components/ParentsHome';
import KidHome from './components/KidHome';
import Quiz from './components/Quiz';

export type KidProfile = 'arya' | 'anjali';
export type Screen =
  | { name: 'mode' }
  | { name: 'pin' }
  | { name: 'parents' }
  | { name: 'kid'; profile: KidProfile }
  | { name: 'quiz'; profile: KidProfile };

export const KID_NAMES: Record<KidProfile, string> = {
  arya: 'Arya',
  anjali: 'Anjali',
};

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'mode' });
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    ensureWordsSeeded()
      .then(() => db.words.count())
      .then((n) => {
        console.log(`words ready: ${n}`);
        setReady(true);
      })
      .catch((e) => {
        console.error('word seeding failed', e);
        setReady(true); // still render; quiz will show an error
      });
  }, []);

  // Parent auth + background sync. Sync runs on sign-in, on reconnect,
  // and after every finished round — always silent, never blocking.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) void syncNow().catch((e) => console.warn('sync failed', e));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      if (s) void syncNow().catch((e) => console.warn('sync failed', e));
    });
    const onOnline = () => {
      void syncNow().catch(() => {});
    };
    window.addEventListener('online', onOnline);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('online', onOnline);
    };
  }, []);

  function exitQuiz(profile: KidProfile) {
    setScreen({ name: 'kid', profile });
    // A finished round is the handoff unit: push it now so the next
    // device sees the full history when its next round starts.
    void syncNow().catch(() => {});
  }

  if (!ready) {
    return (
      <div className="app loading">
        <p>Loading words…</p>
      </div>
    );
  }

  return (
    <div className="app">
      {screen.name === 'mode' && (
        <ModePicker
          onPick={(profile) =>
            setScreen(profile === 'parents' ? { name: 'pin' } : { name: 'kid', profile })
          }
        />
      )}
      {screen.name === 'pin' && (
        <PinGate
          onBack={() => setScreen({ name: 'mode' })}
          onUnlock={() => setScreen({ name: 'parents' })}
        />
      )}
      {screen.name === 'parents' && (
        <ParentsHome session={session} onBack={() => setScreen({ name: 'mode' })} />
      )}
      {screen.name === 'kid' && (
        <KidHome
          profile={screen.profile}
          onBack={() => setScreen({ name: 'mode' })}
          onStart={() => setScreen({ name: 'quiz', profile: screen.profile })}
        />
      )}
      {screen.name === 'quiz' && (
        <Quiz profile={screen.profile} onExit={() => exitQuiz(screen.profile)} />
      )}
    </div>
  );
}

export default App;
