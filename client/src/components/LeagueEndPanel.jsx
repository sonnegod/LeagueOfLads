import { useCallback, useEffect, useState } from 'react';
import './LeagueEndPanel.css';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function currentStage(data) {
  const boundaries = data.stageInfo || data[0] || {};
  if (boundaries.TieBreakerEndMatchId != null) return 'playoffs';
  if (boundaries.GroupEndMatchId != null) return 'tiebreakers';
  return 'groups';
}

export default function LeagueEndPanel({ season, onEnded }) {
  const [stage, setStage] = useState(null);
  const [hasTiebreaker, setHasTiebreaker] = useState(false);
  const [teams, setTeams] = useState([]);
  const [championId, setChampionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStage = useCallback(async () => {
    const [stageData, rulesData] = await Promise.all([
      request(`/api/leagueStage?leagueId=${encodeURIComponent(season.ExternalLeagueId)}`),
      request('/api/admin/leagueRules'),
    ]);
    setStage(currentStage(stageData));
    setHasTiebreaker(Boolean(Number(rulesData.rules?.HasTiebreaker)));
  }, [season.ExternalLeagueId]);

  useEffect(() => {
    loadStage().catch(err => setError(err.message));
    request(`/api/admin/seasons/${season.SeasonId}/championCandidates`)
      .then(data => setTeams(data.teams || []))
      .catch(err => setError(err.message));
  }, [loadStage, season.SeasonId]);

  async function advanceStage() {
    const toTiebreakers = stage === 'groups' && hasTiebreaker;
    const nextStage = toTiebreakers ? 'tiebreakers' : 'playoffs';
    const closingStage = stage === 'tiebreakers' ? 'tiebreaker' : 'group';
    if (!window.confirm(`Start ${nextStage}? This closes the ${closingStage} stage at the latest recorded match.`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await request(toTiebreakers
        ? '/api/admin/activateTiebreakers' : '/api/admin/activatePlayoffs', { method: 'POST' });
      if (!result.success) throw new Error(result.error || `Could not start ${nextStage}`);
      await loadStage();
      setMessage(`${nextStage === 'playoffs' ? 'Playoffs' : 'Tiebreakers'} started.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function endLeague() {
    if (!window.confirm('End this league and publish the selected champion?')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request(`/api/admin/seasons/${season.SeasonId}/end`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ championTeamId: championId }),
      });
      onEnded?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const stageLabel = { groups: 'Group stage', tiebreakers: 'Tiebreakers', playoffs: 'Playoffs' }[stage];
  const nextLabel = stage === 'groups' && hasTiebreaker ? 'Start tiebreakers' : 'Start playoffs';

  return <section className="league-stage-panel">
    <h2>League stages</h2>
    <p>Control stage changes and end {season.LeagueName} here.</p>
    <div className="league-stage-current">
      <strong>Current stage:</strong> {stageLabel || 'Loading...'}
    </div>
    {stage && stage !== 'playoffs' && <div className="league-stage-actions">
      <button className="ui-button-primary" type="button" disabled={busy} onClick={advanceStage}>
        {nextLabel}
      </button>
    </div>}
    {stage === 'playoffs' && <p>Playoffs are in progress.</p>}
    <div className="league-stage-end">
      <h3>End league</h3>
      <p>Select the champion when the league is finished.</p>
      <div className="league-stage-actions">
        <label htmlFor="league-champion">Champion</label>
        <select id="league-champion" value={championId} onChange={event => setChampionId(event.target.value)}>
          <option value="">Select champion</option>
          {teams.map(team => <option key={team.TeamId} value={team.TeamId}>{team.TeamName} ({team.TeamId})</option>)}
        </select>
        <button className="ui-button-danger" type="button" disabled={!championId || busy}
          onClick={endLeague}>End league</button>
      </div>
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="league-stage-error">{error}</p>}
  </section>;
}
