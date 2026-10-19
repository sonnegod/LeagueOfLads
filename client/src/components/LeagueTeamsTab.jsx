import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DotabuffLink from './DotabuffLink';
import { leagueTeamLink } from '../utils/leagueTeamLink';
import './LeagueTeamsTab.css';

export default function LeagueTeamsTab({ leagueId }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/leagues/${leagueId}/teamRosters`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load league rosters');
      return data.groups;
    }).then(groups => {
      if (!controller.signal.aborted) setResult({ leagueId, attempt, groups });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ leagueId, attempt, error: error.message });
    });
    return () => controller.abort();
  }, [leagueId, attempt]);

  if (result?.leagueId !== leagueId || result?.attempt !== attempt) return <p role="status">Loading teams…</p>;
  if (result.error) return <div role="alert"><p>{result.error}</p>
    <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>;
  if (!result.groups.some(group => group.teams.length)) return <p>No teams recorded yet.</p>;

  return <div className="league-roster-groups">{result.groups.map(group => <section
    className="league-roster-group" key={group.GroupId ?? 'other'} aria-label={group.GroupName}>
    <h2>{group.GroupName}</h2>
    <div className="league-roster-cards">{group.teams.map(team => {
      const href = leagueTeamLink(team);
      return <article className="league-roster-card" key={team.EntryId != null ? `entry:${team.EntryId}` : `team:${team.TeamId}`}>
        <header><h3>{href ? <Link to={href} target="_blank" rel="noopener noreferrer">{team.TeamName}</Link> : team.TeamName}</h3>
          <div className="league-roster-header-meta"><DotabuffLink teamId={team.TeamId} name={team.TeamName} />
            <div className="league-roster-record"><span>{team.GamesPlayed ?? 0} GP</span>
              <span>{team.WinPercentage == null ? '—' : `${Number(team.WinPercentage).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`} WR</span>
            </div></div></header>
        {team.players.length || team.pendingSlots.length ? <ul>{team.players.map(player => <li key={player.PlayerId}>
          <Link to={`/player/${player.PlayerId}`} target="_blank" rel="noopener noreferrer">{player.PlayerName}</Link>
          <DotabuffLink playerId={player.PlayerId} name={player.PlayerName} />
        </li>)}{team.pendingSlots.map(slot => <li key={`pending:${slot.Slot}`}><span>Player TBD</span></li>)}</ul>
          : <p className="league-roster-empty">Roster not recorded yet.</p>}
      </article>;
    })}</div>
  </section>)}</div>;
}
