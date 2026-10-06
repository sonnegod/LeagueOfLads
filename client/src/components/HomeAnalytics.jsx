import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function HomeAnalytics({ leagueId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    const url = leagueId ? `/api/homeAnalytics?leagueId=${leagueId}` : '/api/homeAnalytics';
    fetch(url).then(response => response.ok ? response.json() : null)
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [leagueId]);
  if (!data || (!data.feed.length && !data.leaders.some(item => item.players.length))) return null;
  return <section className="home-analytics" aria-label="League analytics">
    <div className="home-analytics-intro">
      <p className="home-eyebrow">Around the league</p>
      <h2>Matches and player numbers</h2>
      <p>Historical league matches through {data.lastMatchDate || 'the latest recorded date'}.
        Player leaders cover all recorded league seasons, not just current signups or projected results.</p>
    </div>
    {data.feed.length > 0 && <div className="home-analytics-section">
      <h3>Latest recorded match moments</h3>
      <div className="home-analytics-feed">{data.feed.map(item => <article key={`${item.type}:${item.date}:${item.matchId || item.playerId}`}>
        <small>{item.date}</small>
        <strong>{item.matchId ? <Link to={`/match/${item.matchId}`}>{item.headline}</Link>
          : item.playerId ? <Link to={`/player/${item.playerId}`}>{item.headline}</Link> : item.headline}</strong>
        <span>{item.summary}</span>
      </article>)}</div>
    </div>}
    <div className="home-analytics-section">
      <h3>Historical player leaders</h3>
      <div className="home-analytics-leaders">{data.leaders.map(metric => <article key={metric.key}>
        <h4>{metric.label}</h4>
        <ol>{metric.players.map(player => <li key={player.playerId}>
          <Link to={`/player/${player.playerId}`}>{player.playerName}</Link>
          <strong>{Number(player.value).toLocaleString()} {metric.unit}</strong>
          <small>{player.games} games</small>
        </li>)}</ol>
      </article>)}</div>
    </div>
  </section>;
}
