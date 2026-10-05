import { useEffect, useState } from 'react';
import type { KidProfile } from '../App';
import { KID_NAMES } from '../App';
import { db, type KidRoundRow } from '../db/database';
import { KidScorecardStats } from '../logic/scorecard';

interface Props {
  profile: KidProfile;
  onBack: () => void;
  onStart: () => void;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
}

export default function KidHome({ profile, onBack, onStart }: Props) {
  const [rounds, setRounds] = useState<KidRoundRow[]>([]);

  useEffect(() => {
    db.kidRounds.where('kid').equals(profile).reverse().sortBy('startedAt').then(setRounds);
  }, [profile]);

  const stats = new KidScorecardStats(
    profile,
    rounds.map((r) => ({
      id: r.id,
      kid: r.kid,
      startedAt: r.startedAt,
      wordCount: r.wordCount,
      correctCount: r.correctCount,
      stars: r.stars,
    })),
  );

  return (
    <div className="screen scorecard">
      <button className="link" onClick={onBack} style={{ margin: '0 0 8px' }}>
        ← Back
      </button>
      <h1>{KID_NAMES[profile]}'s scorecard</h1>

      <div className="stars-hero">
        <div>
          <span style={{ fontSize: '2rem' }}>⭐</span>{' '}
          <span className="count">{stats.totalStars}</span>
        </div>
        <div className="label">
          {stats.roundCount === 0
            ? 'Stars earned will show up here'
            : `stars earned across ${stats.roundCount} round${stats.roundCount === 1 ? '' : 's'}`}
        </div>
      </div>

      <button className="primary start-btn" onClick={onStart}>
        Start practicing
      </button>

      {stats.roundCount === 0 ? (
        <div className="empty-state">
          No rounds yet — hit Start practicing above
          <br />
          and your scores will live here.
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="value">{stats.roundCount}</div>
              <div className="label">Rounds</div>
            </div>
            <div className="stat-tile">
              <div className="value">{stats.wordsAttempted}</div>
              <div className="label">Words practiced</div>
            </div>
            <div className="stat-tile">
              <div className="value">{pct(stats.accuracy)}</div>
              <div className="label">Accuracy</div>
            </div>
            <div className="stat-tile">
              <div className="value">
                {stats.bestRound ? pct(stats.bestRound.correctCount / stats.bestRound.wordCount) : '—'}
              </div>
              <div className="label">Best round</div>
            </div>
            <div className="stat-tile">
              <div className="value">{stats.currentStreak}</div>
              <div className="label">Day streak</div>
            </div>
            <div className="stat-tile">
              <div className="value">{stats.longestStreak}</div>
              <div className="label">Longest streak</div>
            </div>
          </div>

          {stats.trendLine && <p className="trend-line">{stats.trendLine}</p>}

          <h3 className="section-title">High scores</h3>
          {stats.topRounds.length === 0 ? (
            <p className="empty-state" style={{ padding: '12px' }}>
              Finish a full round to set your first high score.
            </p>
          ) : (
            stats.topRounds.map((r, i) => (
              <RoundRow key={r.id} round={r} rank={i + 1} />
            ))
          )}

          <h3 className="section-title">Recent rounds</h3>
          {stats.recentRounds.map((r) => (
            <RoundRow key={r.id} round={r} />
          ))}
        </>
      )}
    </div>
  );
}

function RoundRow({
  round,
  rank,
}: {
  round: { id: string; startedAt: number; wordCount: number; correctCount: number; stars: number };
  rank?: number;
}) {
  const acc = round.wordCount > 0 ? round.correctCount / round.wordCount : 0;
  return (
    <div className="round-row">
      {rank !== undefined && <span className="rank">{rank}</span>}
      <span className="date">
        {new Date(round.startedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })}
      </span>
      <span className="score">
        {round.correctCount}/{round.wordCount}
      </span>
      <span className="pct">{pct(acc)}</span>
      <span className="stars">{stars(round.stars)}</span>
    </div>
  );
}
