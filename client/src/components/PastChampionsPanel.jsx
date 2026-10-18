import { useEffect, useState } from 'react';
import './PastChampionsPanel.css';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load champions');
  return data;
}

function ChampionshipRosterPicker({ roster, playerIds, disabled, onMove }) {
  const selected = new Set(playerIds);
  return <fieldset className="championship-roster-picker" disabled={disabled}>
    <legend>Championship players</legend>
    <p className="past-champions-note">Choose exactly five players to receive this season's trophies.
      Players are limited to appearances for this team in this season.</p>
    {roster.source === 'inferred' && <p className="past-champions-note">Suggested players are based on match appearances. Confirm the five actual team members before saving.</p>}
    <div className="championship-roster-lists">
      {[false, true].map(active => {
        const players = roster.players.filter(player => selected.has(player.PlayerId) === active);
        return <section key={String(active)} aria-label={active ? 'Active players' : 'Available players'}>
          <h3>{active ? `Active players (${playerIds.length}/5)` : `Available players (${players.length})`}</h3>
          <ul>{players.map(player => <li key={player.PlayerId}>
            <button type="button" disabled={!active && playerIds.length >= 5}
              aria-label={`${active ? 'Remove' : 'Add'} ${player.PlayerName} (${player.PlayerId}) ${active ? 'from' : 'to'} active players`}
              onClick={() => onMove(player.PlayerId, !active)}>
              {active && <span aria-hidden="true">←</span>}
              <span className="championship-roster-player"><strong>{player.PlayerName}</strong>
                <small>{player.PlayerId} · {player.Games} {player.Games === 1 ? 'game' : 'games'}</small></span>
              {!active && <span aria-hidden="true">→</span>}
            </button>
          </li>)}</ul>
          {!players.length && <p className="past-champions-note">{active ? 'Move players here from the left.' : 'No other players.'}</p>}
        </section>;
      })}
    </div>
    <p role="status" className="past-champions-note">{playerIds.length}/5 selected.
      {playerIds.length !== 5 && ' Select five players to save.'}</p>
  </fieldset>;
}

export default function PastChampionsPanel({ onChanged }) {
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);
  const [championId, setChampionId] = useState('');
  const [roster, setRoster] = useState(null);
  const [playerIds, setPlayerIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const season = seasons.find(item => String(item.SeasonId) === seasonId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError('');
    request('/api/admin/seasons/completed', { signal: controller.signal, cache: 'no-store' })
      .then(data => {
        if (controller.signal.aborted) return;
        setSeasons(data.seasons || []);
        setSeasonId(current => data.seasons?.some(item => String(item.SeasonId) === current)
          ? current : String(data.seasons?.[0]?.SeasonId ?? ''));
      }).catch(cause => { if (!controller.signal.aborted) setListError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!season) return undefined;
    const controller = new AbortController();
    setResult(null);
    request(`/api/admin/seasons/${season.SeasonId}/championCandidates`, { signal: controller.signal, cache: 'no-store' })
      .then(data => {
        if (controller.signal.aborted) return;
        setResult({ seasonId: season.SeasonId, teams: data.teams || [] });
        setChampionId(String(season.ChampionTeamId ?? ''));
      }).catch(cause => {
        if (!controller.signal.aborted) setResult({ seasonId: season.SeasonId, teams: [], error: cause.message });
      });
    return () => controller.abort();
  }, [season]);

  const current = result?.seasonId === season?.SeasonId ? result : null;
  const teams = current?.teams || [];
  const currentChampion = teams.find(team => team.TeamId === season?.ChampionTeamId);
  const selected = teams.find(team => String(team.TeamId) === championId);
  const rosterKey = season ? `${season.SeasonId}:${championId}` : '';
  const currentRoster = roster?.key === rosterKey ? roster : null;
  const selectedSeasonId = season?.SeasonId;
  const selectedTeamId = selected?.TeamId;

  useEffect(() => {
    if (!selectedSeasonId || !selectedTeamId) return undefined;
    const controller = new AbortController();
    setRoster(null);
    request(`/api/admin/seasons/${selectedSeasonId}/championshipRoster?teamId=${encodeURIComponent(selectedTeamId)}`,
      { signal: controller.signal, cache: 'no-store' })
      .then(data => {
        if (controller.signal.aborted) return;
        setRoster({ ...data, key: `${selectedSeasonId}:${selectedTeamId}` });
        setPlayerIds(data.selectedPlayerIds || []);
      }).catch(cause => {
        if (!controller.signal.aborted) setRoster({ key: `${selectedSeasonId}:${selectedTeamId}`, error: cause.message });
      });
    return () => controller.abort();
  }, [selectedSeasonId, selectedTeamId, refresh]);

  const rosterChanged = currentRoster?.editable && (currentRoster.source !== 'admin'
    || playerIds.length !== currentRoster.selectedPlayerIds.length
    || playerIds.some(id => !currentRoster.selectedPlayerIds.includes(id)));
  const canSave = selected && currentRoster && !currentRoster.error
    && (!currentRoster.editable || playerIds.length === 5)
    && (selected.TeamId !== season.ChampionTeamId || rosterChanged);

  async function save(event) {
    event.preventDefault();
    if (!canSave) return;
    if (!window.confirm(`Save ${selected.TeamName} (${selected.TeamId}) as the champion of ${season.LeagueName}${currentRoster.editable ? ' with these five championship players' : ''}?`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await request(`/api/admin/seasons/${season.SeasonId}/champion`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ championTeamId: selected.TeamId,
          ...(currentRoster.editable ? { playerIds } : {}) }),
      });
      setSeasons(current => current.map(item => item.SeasonId === data.season.SeasonId
        ? { ...item, ...data.season } : item));
      if (currentRoster.editable) setRoster(value => ({ ...value, source: 'admin', selectedPlayerIds: [...playerIds] }));
      setMessage(`${season.LeagueName} champion${currentRoster.editable ? ' and championship players' : ''} saved for ${selected.TeamName} (${selected.TeamId}).`);
      onChanged?.();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  return <section className="ui-panel past-champions-panel">
    <header><div><h2>Champions</h2><p>Review and correct champions for completed seasons.</p></div>
      <button type="button" disabled={busy || loading} onClick={() => { setMessage(''); setError(''); setRefresh(value => value + 1); }}>Refresh</button>
    </header>
    {listError ? <p role="alert">{listError}</p> : loading ? <p role="status">Loading completed seasons...</p>
      : !seasons.length ? <p>No completed seasons yet.</p> : <>
        <label htmlFor="past-champion-season">Season</label>
        <select id="past-champion-season" value={seasonId} disabled={busy} onChange={event => {
          setSeasonId(event.target.value); setMessage(''); setError('');
        }}>
          {seasons.map(item => <option key={item.SeasonId} value={item.SeasonId}>
            {item.LeagueName} (League {item.ExternalLeagueId})
          </option>)}
        </select>
        {!current ? <p role="status">Loading this season's teams...</p>
          : current.error ? <p role="alert">{current.error}</p> : <>
            <p><strong>Current champion:</strong> {season.ChampionTeamId
              ? `${currentChampion?.TeamName || 'Team'} (${season.ChampionTeamId})` : 'Not set'}</p>
            <form onSubmit={save}>
              <label htmlFor="past-champion-team">Champion</label>
              <select id="past-champion-team" value={championId} disabled={busy || !teams.length}
                onChange={event => { setChampionId(event.target.value); setMessage(''); setError(''); }}>
                <option value="">Select champion</option>
                {championId && !selected && <option value={championId} disabled>Saved team {championId} is not in this season's matches</option>}
                {teams.map(team => <option key={team.TeamId} value={team.TeamId}>{team.TeamName} ({team.TeamId})</option>)}
              </select>
              <p className="past-champions-note">Only teams that played in this season are available. Season-specific names are used where recorded.</p>
              {!teams.length && <p>No teams with matches are recorded for this season.</p>}
              {selected && (!currentRoster ? <p role="status">Loading championship players...</p>
                : currentRoster.error ? <p role="alert">{currentRoster.error}</p>
                  : currentRoster.editable ? <ChampionshipRosterPicker roster={currentRoster} playerIds={playerIds}
                    disabled={busy} onMove={(id, active) => {
                      setPlayerIds(current => active ? current.includes(id) || current.length >= 5 ? current : [...current, id]
                        : current.filter(playerId => playerId !== id));
                      setError(''); setMessage('');
                    }} /> : <p className="past-champions-note">This season uses finalized signup rosters for player trophies.</p>)}
              <button className="ui-button-primary" type="submit"
                disabled={busy || !canSave}>
                {busy ? 'Saving...' : currentRoster?.editable ? 'Save champion & players' : 'Save champion'}
              </button>
            </form>
          </>}
      </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
