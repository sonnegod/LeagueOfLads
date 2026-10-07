import { useCallback, useEffect, useRef, useState } from 'react';
import LeagueRulesCard from './LeagueRulesCard';
import LeagueEndPanel from './LeagueEndPanel';
import { prepareScreenshot, readScreenshot } from '../utils/screenshotUpload';
import './SeasonAdminPanel.css';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function ScreenshotThumbnail({ src, playerName }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <small role="alert">Screenshot preview could not be loaded. Try the full-size link below.</small>;
  return <a href={src} target="_blank" rel="noreferrer" aria-label={`View ${playerName}'s screenshot full size`}>
    <img className="season-screenshot-thumbnail" src={src} loading="lazy" decoding="async"
      alt={`${playerName}'s saved MMR screenshot`} onError={() => setFailed(true)} />
  </a>;
}

function SubmissionCard({ team, seasonId, onChanged }) {
  const [name, setName] = useState(team.TeamName);
  const [average, setAverage] = useState(String(team.ManualAverageMMR ?? ''));
  const [players, setPlayers] = useState(team.players || []);
  const [files, setFiles] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasExpanded, setHasExpanded] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (team.IsManual) {
        await request(`/api/admin/seasons/${seasonId}/manualTeams/${team.TeamSubmissionId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamName: name, averageMMR: average }),
        });
      } else {
        const roster = await Promise.all(players.map(async player => ({
          playerId: player.PlayerId, playerName: player.PlayerName, mmr: player.MMR,
          dotaProfileUrl: player.DotaProfileUrl,
          ...(files[player.Slot] ? { screenshot: await readScreenshot(
            (await prepareScreenshot(files[player.Slot])).file) } : {}),
        })));
        await request(`/api/admin/seasons/${seasonId}/teams/${team.TeamSubmissionId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamName: name, players: roster }),
        });
      }
      onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`Remove ${team.TeamName} from this season?`)) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/admin/seasons/${seasonId}/teams/${team.TeamSubmissionId}`, { method: 'DELETE' });
      onChanged();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  function changePlayer(index, patch) {
    setPlayers(current => current.map((player, slot) => slot === index ? { ...player, ...patch } : player));
  }

  return <details className="season-team-card"
    onToggle={event => { if (event.currentTarget.open) setHasExpanded(true); }}>
    <summary><strong>{team.TeamName}</strong><span>{Number(team.AverageMMR).toFixed(0)} average MMR</span>
      <span>{team.IsManual ? 'Manual team' : `Captain: ${team.CaptainName || team.CaptainId}`}</span></summary>
    <form onSubmit={save} className="season-team-edit">
      <label>Team name<input maxLength="60" required value={name} onChange={event => setName(event.target.value)} /></label>
      {team.IsManual ? <label>Average MMR<input type="number" min="1" step="1" required value={average}
        onChange={event => setAverage(event.target.value)} /></label>
        : players.map((player, index) => <fieldset key={player.Slot}>
          <legend>Player {index + 1}</legend>
          <div className="season-team-player-fields">
            <label>Steam ID<input type="number" min="1" required value={player.PlayerId}
              onChange={event => changePlayer(index, { PlayerId: event.target.value })} /></label>
            <label>Name for a new player<input maxLength="40" value={player.PlayerName || ''}
              onChange={event => changePlayer(index, { PlayerName: event.target.value })} /></label>
            <label>MMR<input type="number" min="5500" required value={player.MMR}
              onChange={event => changePlayer(index, { MMR: event.target.value })} /></label>
            <label>Player profile URL<input type="url" maxLength="500" required value={player.DotaProfileUrl}
              onChange={event => changePlayer(index, { DotaProfileUrl: event.target.value })} /></label>
            <label>Replace screenshot<input type="file" accept="image/jpeg,image/png,image/webp"
              onChange={event => setFiles(current => ({ ...current, [player.Slot]: event.target.files?.[0] }))} /></label>
          </div>
          {hasExpanded && <ScreenshotThumbnail
            src={`/api/admin/seasons/${seasonId}/teams/${team.TeamSubmissionId}/screenshots/${player.PlayerId}`}
            playerName={player.PlayerName || `Player ${index + 1}`} />}
          <a href={`/api/admin/seasons/${seasonId}/teams/${team.TeamSubmissionId}/screenshots/${player.PlayerId}`}
            target="_blank" rel="noreferrer">View screenshot</a>
        </fieldset>)}
      {error && <p role="alert" className="season-error">{error}</p>}
      <div className="season-actions"><button className="ui-button-primary" type="submit" disabled={busy}>Save changes</button>
        <button className="ui-button-danger" type="button" disabled={busy} onClick={remove}>Remove team</button></div>
    </form>
  </details>;
}

function GroupsPanel({ season, teams, groups, spread, refresh, run, busy }) {
  const [name, setName] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualMMR, setManualMMR] = useState('');
  const [dragged, setDragged] = useState(null);
  const [refreshError, setRefreshError] = useState(false);
  const [liveGroups, setLiveGroups] = useState(null);
  const refreshSerial = useRef(0);
  const refreshInFlight = useRef(false);
  const seasonId = season.SeasonId;
  const snapshot = liveGroups?.sourceTeams === teams && liveGroups?.sourceGroups === groups
    ? liveGroups : null;
  const visibleTeams = snapshot?.teams ?? teams;
  const visibleGroups = snapshot?.groups ?? groups;
  const visibleSpread = snapshot?.spread ?? spread;

  const refreshLatest = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const serial = ++refreshSerial.current;
    try {
      const result = await refresh(seasonId);
      if (serial !== refreshSerial.current) return;
      if (result.season?.SeasonId === seasonId && result.season?.Status === 'signup_closed') {
        const signature = JSON.stringify([result.teams, result.groups, result.spread]);
        setLiveGroups(current => current?.sourceTeams === teams && current?.sourceGroups === groups
          && current.signature === signature ? current : {
            sourceTeams: teams, sourceGroups: groups, signature,
            teams: result.teams, groups: result.groups, spread: result.spread,
          });
      }
      setRefreshError(false);
    }
    catch { if (serial === refreshSerial.current) setRefreshError(true); }
    finally { refreshInFlight.current = false; }
  }, [refresh, seasonId, teams, groups]);

  useEffect(() => {
    if (busy || dragged) refreshSerial.current += 1;
  }, [busy, dragged]);

  useEffect(() => {
    if (busy || dragged) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshLatest();
    };
    const interval = window.setInterval(refreshWhenVisible, 1000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [busy, dragged, refreshLatest]);

  function addGroup(event) {
    event.preventDefault();
    run(() => request(`/api/admin/seasons/${seasonId}/groups`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupName: name }),
    }), 'Group added.').then(() => setName(''));
  }

  function addManual(event) {
    event.preventDefault();
    run(() => request(`/api/admin/seasons/${seasonId}/manualTeams`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName: manualName, averageMMR: manualMMR }),
    }), 'Manual team added.').then(() => { setManualName(''); setManualMMR(''); });
  }

  function move(teamId, groupId) {
    run(() => request(`/api/admin/seasons/${seasonId}/teams/${teamId}/group`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    }), 'Team moved.').catch(() => {});
  }

  function drop(event, groupId) {
    event.preventDefault();
    if (dragged) move(dragged, groupId);
    setDragged(null);
  }

  const unassigned = visibleTeams.filter(team => !team.GroupId);
  const columns = [{ GroupId: null, GroupName: 'Unassigned', teams: unassigned, AverageMMR: null }, ...visibleGroups];
  return <section className="season-groups">
    <h3>Groups</h3>
    <p>Create the group structure, then randomize 100 assignments. One of the 10 lowest-spread assignments is chosen at random.</p>
    <div className="season-actions">
      <form onSubmit={addGroup}><input value={name} onChange={event => setName(event.target.value)}
        maxLength="60" placeholder="Group name" required /> <button disabled={busy}>Add group</button></form>
      <form onSubmit={addManual}><input value={manualName} onChange={event => setManualName(event.target.value)}
        maxLength="60" placeholder="Manual team name" required /> <input type="number" min="1" step="1"
        value={manualMMR} onChange={event => setManualMMR(event.target.value)} placeholder="Average MMR" required />
        <button disabled={busy}>Add manual team</button></form>
      <button className="ui-button-primary" type="button" disabled={busy || !visibleGroups.length || visibleTeams.length < visibleGroups.length}
        onClick={() => run(() => request(`/api/admin/seasons/${seasonId}/groups/randomize`, { method: 'POST' }),
          'Groups randomized.')}>Randomize</button>
      <button type="button" disabled={busy || Boolean(dragged)} onClick={refreshLatest}>Refresh</button>
    </div>
    <small role="status">{refreshError ? 'Automatic updates failed. Use Refresh to retry.'
      : 'Group changes from other admins appear automatically.'}</small>
    {visibleSpread !== null && <p><strong>Spread: {Number(visibleSpread).toFixed(0)} MMR</strong></p>}
    <div className="season-group-grid">{columns.map(group => <div key={group.GroupId ?? 'none'}
      className="season-group-column" onDragOver={event => event.preventDefault()}
      onDrop={event => drop(event, group.GroupId)}>
      <div className="season-group-heading"><h4>{group.GroupName}</h4>
        {group.GroupId && <button type="button" disabled={busy} onClick={() => {
          const newName = window.prompt('Group name', group.GroupName)?.trim();
          if (newName && newName !== group.GroupName) run(() => request(
            `/api/admin/seasons/${seasonId}/groups/${group.GroupId}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ groupName: newName }),
            }), 'Group renamed.');
        }}>Rename</button>}
        {group.GroupId && <button type="button" disabled={busy} onClick={() => {
          if (window.confirm(`Remove ${group.GroupName}? Teams will become unassigned.`)) {
            run(() => request(`/api/admin/seasons/${seasonId}/groups/${group.GroupId}`, { method: 'DELETE' }), 'Group removed.');
          }
        }}>Remove</button>}</div>
      {group.GroupId && <small>Average {group.AverageMMR === null ? '—' : Number(group.AverageMMR).toFixed(0)} MMR</small>}
      {group.teams.map(team => <div key={team.TeamSubmissionId} className="season-drag-team" draggable
        onDragStart={event => { event.dataTransfer.setData('text/plain', String(team.TeamSubmissionId)); setDragged(team.TeamSubmissionId); }}
        onDragEnd={() => setDragged(null)}>
        <strong>{team.TeamName}</strong><small>{Number(team.AverageMMR).toFixed(0)} MMR</small>
        <select aria-label={`Group for ${team.TeamName}`} value={team.GroupId ?? ''}
          onChange={event => move(team.TeamSubmissionId, event.target.value ? Number(event.target.value) : null)}>
          <option value="">Unassigned</option>
          {visibleGroups.map(choice => <option key={choice.GroupId} value={choice.GroupId}>{choice.GroupName}</option>)}
        </select>
      </div>)}
    </div>)}</div>
  </section>;
}

export default function SeasonAdminPanel({ onChanged }) {
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [latestChampionId, setLatestChampionId] = useState('');
  const [latestTeams, setLatestTeams] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const reloadSerial = useRef(0);

  const reload = useCallback(async () => {
    const serial = ++reloadSerial.current;
    const result = await request('/api/admin/seasons/current');
    if (serial !== reloadSerial.current) return null;
    setData(result);
    setTitle(result.season?.SignupTitle || '');
    setDescription(result.season?.SignupDescription || '');
    setLeagueId(result.season?.ExternalLeagueId ? String(result.season.ExternalLeagueId) : '');
    if (result.latest && !result.season) {
      setLatestChampionId(String(result.latest.ChampionTeamId ?? ''));
      request(`/api/admin/seasons/${result.latest.SeasonId}/championCandidates`)
        .then(value => setLatestTeams(value.teams)).catch(() => setLatestTeams([]));
    } else {
      setLatestChampionId('');
      setLatestTeams([]);
    }
    return result;
  }, []);

  const refreshGroups = useCallback(async (seasonId) => {
    const result = await request('/api/admin/seasons/current/groupBoard', { cache: 'no-store' });
    if (result.season?.SeasonId !== seasonId || result.season?.Status !== 'signup_closed') {
      await reload();
      onChanged?.();
    }
    return result;
  }, [reload, onChanged]);

  useEffect(() => { reload().catch(err => setError(err.message)); }, [reload]);

  async function run(action, success) {
    reloadSerial.current += 1;
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); await reload(); onChanged?.(); setMessage(success); }
    catch (err) { setError(err.message); throw err; }
    finally { setBusy(false); }
  }

  const season = data?.season;
  const sid = season?.SeasonId;
  const unassignedTeams = data?.teams.filter(team => !team.GroupId) ?? [];
  const groupSizes = data?.groups.map(group => group.teams.length) ?? [];
  const startBlocker = !data?.groups.length || !data?.teams.length
    ? 'Create groups and add teams before starting the league.'
    : unassignedTeams.length
      ? `Assign ${unassignedTeams.map(team => team.TeamName).join(', ')} to a group before starting the league.`
      : Math.max(...groupSizes) - Math.min(...groupSizes) > 1
        ? 'Balance the groups so their team counts differ by at most one before starting the league.'
        : '';
  return <section className="season-admin-panel">
    {error && <p role="alert" className="season-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!data ? <p>Loading season...</p> : !season ? <form onSubmit={event => {
      event.preventDefault();
      run(() => request('/api/admin/seasons', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueName: name, leagueId: leagueId || null }) }),
      'League draft created.').then(() => setName('')).catch(() => {});
    }} className="season-inline-form">
      <label>League name<input value={name} maxLength="60" required onChange={event => setName(event.target.value)} /></label>
      <label>League ID (optional if known)<input type="number" min="1" step="1" value={leagueId}
        onChange={event => setLeagueId(event.target.value)} /></label>
      <button className="ui-button-primary" disabled={busy}>Create league draft</button>
    </form> : <>
      <p><strong>{season.LeagueName}</strong> · {season.Status.replace('_', ' ')} · Season #{sid}
        {season.ExternalLeagueId ? ` · League ID ${season.ExternalLeagueId}` : ''}</p>
      {season.Status === 'draft' && <form className="season-signup-details" onSubmit={event => {
        event.preventDefault();
        run(() => request(`/api/admin/seasons/${sid}/signup`, { method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description }) }), 'Signup details saved.').catch(() => {});
      }}>
        <h3>Signup details</h3>
        <label>Title<input value={title} maxLength="120" required onChange={event => setTitle(event.target.value)} /></label>
        <label>Description<textarea value={description} maxLength="1000" required rows="3"
          onChange={event => setDescription(event.target.value)} /></label>
        <div className="season-actions"><button disabled={busy}>Save details</button>
          <a href={`/signup/${sid}?preview=1`} target="_blank" rel="noreferrer">Preview signup form</a>
          <button className="ui-button-primary" type="button" disabled={busy || !season.SignupTitle}
            onClick={() => { if (window.confirm('Open signups for this league?')) {
              run(() => request(`/api/admin/seasons/${sid}/signup/open`, { method: 'POST' }), 'Signups are open.').catch(() => {});
            } }}>Open signups</button></div>
      </form>}
      {season.Status === 'signup_open' && <div className="season-actions">
        <p>Signups are open. The homepage signup button is visible.</p>
        <button className="ui-button-danger" disabled={busy} onClick={() => {
          if (window.confirm('End signups? Captains will no longer be able to submit.')) {
            run(() => request(`/api/admin/seasons/${sid}/signup/close`, { method: 'POST' }), 'Signups closed.').catch(() => {});
          }
        }}>End signups</button>
      </div>}
      {['signup_open', 'signup_closed'].includes(season.Status) && <section className="season-submissions">
        <div className="season-submissions-heading">
          <h3>Team submissions ({data.teams.length})</h3>
          <a className="season-submissions-export" href={`/api/admin/seasons/${sid}/submissions.csv`}
            download={`season-${sid}-submissions.csv`}>Export CSV</a>
        </div>
        <div className="season-team-list">{data.teams.map(team => <SubmissionCard key={`${team.TeamSubmissionId}:${team.UpdatedAt}`}
          team={team} seasonId={sid}
          onChanged={() => reload().catch(err => setError(err.message))} />)}</div>
      </section>}
      {season.Status === 'signup_closed' && <>
        <GroupsPanel season={season} teams={data.teams} groups={data.groups} spread={data.spread}
          refresh={refreshGroups} busy={busy}
          run={(action, success) => run(action, success).catch(() => {})} />
        <LeagueRulesCard seasonId={sid} />
        <form className="season-inline-form" onSubmit={event => {
          event.preventDefault();
          if (window.confirm('Start the league with these groups and the entered league ID?')) {
            run(() => request(`/api/admin/seasons/${sid}/start`, { method: 'POST',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId }) }),
            'League started.').catch(() => {});
          }
        }}>
          <label>League ID<input type="number" min="1" step="1" required value={leagueId}
            onChange={event => setLeagueId(event.target.value)} /></label>
          {startBlocker && <p role="status">{startBlocker}</p>}
          <button className="ui-button-primary" disabled={busy || Boolean(startBlocker)}>Start league</button>
        </form>
      </>}
      {season.Status === 'active' && <>
        <p>League ID: {season.ExternalLeagueId}. Use Editor, Playoffs, and Settings for active league operations.</p>
        <LeagueEndPanel season={season} onEnded={() => {
          reload().catch(err => setError(err.message));
          onChanged?.();
        }} />
      </>}
    </>}
    {!season && data?.latest && <div className="season-inline-form">
      <h3>Correct completed league champion: {data.latest.LeagueName}</h3>
      <label>Champion
        <select value={latestChampionId} onChange={event => setLatestChampionId(event.target.value)}>
          <option value="">Select champion</option>
          {latestTeams.map(team => <option key={team.TeamId} value={team.TeamId}>{team.TeamName} ({team.TeamId})</option>)}
        </select>
      </label>
      <button type="button" disabled={busy || !latestChampionId || Number(latestChampionId) === data.latest.ChampionTeamId}
        onClick={() => { if (window.confirm('Change the published champion for this league?')) {
          run(() => request(`/api/admin/seasons/${data.latest.SeasonId}/champion`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ championTeamId: latestChampionId }),
          }), 'Champion corrected.').catch(() => {});
        } }}>{data.latest.ChampionTeamId ? 'Correct champion' : 'Confirm champion'}</button>
    </div>}
  </section>;
}
