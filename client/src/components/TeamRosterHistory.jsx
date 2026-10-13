import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DotabuffLink from './DotabuffLink';

function formatDate(value) {
  if (!value) return 'Unknown';
  const utcValue = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(utcValue);
  return Number.isNaN(date.getTime()) ? 'Unknown'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function endLabel(roster) {
  if (roster.EffectiveTo) return formatDate(roster.EffectiveTo);
  return roster.SeasonStatus === 'ended' || roster.Source === 'match_lineup' ? 'Unknown' : 'Present';
}

export function RosterDates({ roster }) {
  return <small className="team-roster-dates">
    Effective {formatDate(roster.EffectiveFrom)}{roster.FromEstimated && roster.EffectiveFrom ? ' (estimated)' : ''}
    {' – '}{endLabel(roster)}
  </small>;
}

export default function TeamRosterHistory({ roster, leagueId = 'all' }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const baseUrl = roster.TeamId ? `/api/teams/${roster.TeamId}/rosterHistory`
    : `/api/teamRosters/${roster.TeamSubmissionId}/history`;
  const url = `${baseUrl}?leagueId=${encodeURIComponent(leagueId)}`;

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setResult(null);
    fetch(url, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load roster history');
      return data.history;
    }).then(history => {
      if (!controller.signal.aborted) setResult({ url, history });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ url, error: error.message });
    });
    return () => controller.abort();
  }, [open, url]);

  const current = result?.url === url ? result : null;
  return <details className="team-roster-history" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Roster history</summary>
    {open && (!current ? <p>Loading roster history...</p>
      : current.error ? <p role="alert">{current.error}</p>
        : !current.history.length ? <p>No roster history recorded.</p>
          : <>
            <p className="team-roster-history-note">Signup dates show effective roster periods. Match lineups show the dates those players were observed together.</p>
            <div className="detail-table-scroll"><table className="team-roster-history-table">
              <thead><tr><th>Roster</th><th>From</th><th>To</th></tr></thead>
              <tbody>{current.history.map(period => <tr key={`${period.Source}:${period.TeamSubmissionId ?? period.MatchId}`}>
                <td>
                  <div className="team-roster-history-meta">
                    <Link to={`/league/${period.LeagueId}`}>{period.LeagueName || `League ${period.LeagueId}`}</Link>
                    {period.Source === 'signup' ? <small>Signup roster</small>
                      : <small>Match lineup · {period.GamesPlayed} {period.GamesPlayed === 1 ? 'game' : 'games'}</small>}
                  </div>
                  <ul className="team-active-roster-players">{period.players.map(player => <li key={player.PlayerId}>
                    <Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link>
                    <DotabuffLink playerId={player.PlayerId} name={player.PlayerName} />
                  </li>)}</ul>
                </td>
                <td>{formatDate(period.EffectiveFrom)}
                  {period.Source === 'signup' && period.FromEstimated && period.EffectiveFrom
                    ? <small className="team-roster-dates">Estimated</small> : null}
                </td>
                <td>{endLabel(period)}</td>
              </tr>)}</tbody>
            </table></div>
          </>)}
  </details>;
}
