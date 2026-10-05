import type { KidProfile } from '../App';
import { KID_NAMES } from '../App';

interface Props {
  onPick: (profile: KidProfile | 'parents') => void;
}

export default function ModePicker({ onPick }: Props) {
  return (
    <div className="screen mode-picker">
      <h1>🐝 Beekeeper</h1>
      <p className="subtitle">Who's practicing?</p>
      <div className="kid-cards">
        {(['arya', 'anjali'] as KidProfile[]).map((k) => (
          <button key={k} className="kid-card" onClick={() => onPick(k)}>
            <span className="kid-emoji">{k === 'arya' ? '🦋' : '🐞'}</span>
            <span className="kid-name">{KID_NAMES[k]}</span>
          </button>
        ))}
      </div>
      <button className="parents-link" onClick={() => onPick('parents')}>
        Parents
      </button>
    </div>
  );
}
