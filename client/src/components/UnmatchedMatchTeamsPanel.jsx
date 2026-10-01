import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './UnmatchedMatchTeamsPanel.css';

export default function UnmatchedMatchTeamsPanel({ refreshKey, onOpenMatchChanges, onOpenGroupSetup }) {
  const [teams, setTeams] = useState([]);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/admin/unmatchedMatchTeams');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not check match team IDs');
        if (active) {
          setTeams(data.teams || []);
          setError('');
        }
      } catch (cause) {
        if (active) setError(cause.message);
      }
    }
    load();
    const interval = window.setInterval(load, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshKey, retryKey]);

  if (!error && teams.length === 0) return null;

  return <section className="unmatched-match-teams" aria-labelledby="unmatched-match-teams-title">
    <div className="unmatched-match-teams-heading">
      <div>
        <h2 id="unmatched-match-teams-title">Match team IDs need review</h2>
        <p>These teams appeared in active league matches but are not assigned to a current league group.</p>
      </div>
      {teams.length > 0 && <strong className="unmatched-match-teams-count">{teams.length} {teams.length === 1 ? 'team' : 'teams'}</strong>}
    </div>
    {error && <div className="unmatched-match-teams-error" role="alert">
      Could not refresh match team IDs: {error}
      <button type="button" onClick={() => setRetryKey(key => key + 1)}>Retry</button>
    </div>}
    {teams.length > 0 && <>
      <ul className="unmatched-match-teams-list">
        {teams.map(team => <li key={team.teamId}>
          <div className="unmatched-match-teams-name">
            <strong>{team.teamName}</strong><span>Team ID {team.teamId}</span>
          </div>
          <div className="unmatched-match-teams-matches">
            <span>{team.matchIds.length} {team.matchIds.length === 1 ? 'match' : 'matches'}:</span>
            {team.matchIds.slice(0, 5).map(matchId => <Link key={matchId} to={`/match/${matchId}`}>#{matchId}</Link>)}
            {team.matchIds.length > 5 && <details>
              <summary>Show {team.matchIds.length - 5} more</summary>
              <div className="unmatched-match-teams-more">
                {team.matchIds.slice(5).map(matchId => <Link key={matchId} to={`/match/${matchId}`}>#{matchId}</Link>)}
              </div>
            </details>}
          </div>
        </li>)}
      </ul>
      <p className="unmatched-match-teams-help">Correct the match Team ID in Match Changes, or link it to a team in Group Setup.</p>
      <div className="unmatched-match-teams-actions">
        <button type="button" onClick={onOpenMatchChanges}>Open Match Changes</button>
        <button type="button" onClick={onOpenGroupSetup}>Open Group Setup</button>
      </div>
    </>}
  </section>;
}
