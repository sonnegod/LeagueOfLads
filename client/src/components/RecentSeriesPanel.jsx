import { useState } from 'react';
import { Link } from 'react-router-dom';

const stages = { regular: 'Groups', playoff: 'Playoffs', tiebreaker: 'Tiebreakers', unknown: 'League game' };
const date = value => value ? new Date(value).toLocaleDateString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric',
}) : 'Date unavailable';
const duration = seconds => seconds == null ? '—' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function RecentSeriesPanel({ series = [], loading, error, pageSize, onShowAll }) {
  const [page, setPage] = useState(0);
  const count = Math.max(1, Math.ceil(series.length / pageSize));
  const current = Math.min(page, count - 1);
  return <section className="activity-results activity-panel" aria-label="Recent series and results">
    <div className="highlight-heading"><h2>On the scoreboard</h2>
      <button type="button" className="dashboard-story-link" onClick={onShowAll}>All games →</button></div>
    <p className="dashboard-caption">Series scores · expand for individual games</p>
    <div className="activity-series-list">
      {series.slice(current * pageSize, (current + 1) * pageSize).map(item => <details key={item.key} className="activity-series">
        <summary>
          <Link title={item.team1.teamName} className={item.complete && item.team1.wins > item.team2.wins ? 'series-winning-team' : ''}
            to={`/team/${item.team1.teamId}`}>{item.team1.teamName}</Link>
          <strong className="activity-score">{item.team1.wins}<span>–</span>{item.team2.wins}</strong>
          <Link title={item.team2.teamName} className={item.complete && item.team2.wins > item.team1.wins ? 'series-winning-team' : ''}
            to={`/team/${item.team2.teamId}`}>{item.team2.teamName}</Link>
          <span className="activity-series-meta">{stages[item.stage]} · {date(item.playedAt)}</span>
          <span className="activity-series-status">{item.reverseSweep ? 'Reverse sweep' : item.complete ? 'Final'
            : item.seriesId ? 'Recorded score' : 'Single game'} <span className="activity-expand" aria-hidden="true">⌄</span></span>
        </summary>
        <div className="activity-series-games">
          {item.games.map((game, index) => <div key={game.matchId}>
            <Link to={`/match/${game.matchId}`}>Game {index + 1}</Link>
            <span><Link to={`/team/${game.winner.teamId}`}>{game.winner.teamName}</Link> won</span>
            <span>{duration(game.durationSeconds)}</span>
          </div>)}
          {item.seriesId && <Link className="activity-series-link" to={`/series/${item.seriesId}`}>View series →</Link>}
        </div>
      </details>)}
      {!series.length && <p className="dashboard-caption">{loading ? 'Loading results…' : error
        ? 'Results could not be loaded.' : 'No completed games in this window. Try Last week for a wider view.'}</p>}
    </div>
    {count > 1 && <div className="dashboard-pagination" aria-label="Scoreboard pages">
      <button type="button" disabled={!current} onClick={() => setPage(current - 1)}>Previous</button>
      <span>{current + 1} / {count}</span>
      <button type="button" disabled={current === count - 1} onClick={() => setPage(current + 1)}>Next</button>
    </div>}
  </section>;
}
