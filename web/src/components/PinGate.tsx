import { useState } from 'react';

interface Props {
  onBack: () => void;
  onUnlock: () => void;
}

const PIN_KEY = 'beekeeper.parentsPinHash';

/** Simple SHA-256 hash for the parents PIN (UI gate, not a security boundary —
 *  real auth is the parent's device + Supabase login). */
async function hashPin(pin: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('beekeeper:' + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function PinGate({ onBack, onUnlock }: Props) {
  const [pin, setPin] = useState('');
  const [creating] = useState(!localStorage.getItem(PIN_KEY));
  const [error, setError] = useState('');

  async function submit() {
    if (pin.length !== 4) {
      setError('Enter a 4-digit PIN');
      return;
    }
    const hash = await hashPin(pin);
    const stored = localStorage.getItem(PIN_KEY);
    if (creating) {
      localStorage.setItem(PIN_KEY, hash);
      onUnlock();
    } else if (hash === stored) {
      onUnlock();
    } else {
      setError('Wrong PIN — try again');
      setPin('');
    }
  }

  function press(d: string) {
    setError('');
    if (d === 'clear') setPin('');
    else if (d === 'back') setPin((p) => p.slice(0, -1));
    else if (pin.length < 4) setPin((p) => p + d);
  }

  return (
    <div className="screen pin-gate">
      <h2>{creating ? 'Create a parents PIN' : 'Parents PIN'}</h2>
      <div className="pin-dots">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? 'dot filled' : 'dot'} />
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((d) => (
          <button key={d} onClick={() => press(d)}>
            {d === 'clear' ? 'C' : d === 'back' ? '⌫' : d}
          </button>
        ))}
      </div>
      <button className="primary" onClick={submit} disabled={pin.length !== 4}>
        {creating ? 'Create PIN' : 'Unlock'}
      </button>
      <button className="link" onClick={onBack}>
        Back
      </button>
    </div>
  );
}
