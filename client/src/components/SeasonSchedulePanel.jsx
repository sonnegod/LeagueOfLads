import { useEffect, useRef, useState } from 'react';
import LeagueScheduleView from './LeagueScheduleView';
import './LeagueSchedule.css';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load the schedule');
  return data;
}

const initialMatchup = { groupId: '', teamAEntryId: '', teamBEntryId: '', windowNumber: 1 };

export default function SeasonSchedulePanel({ seasonId }) {
  const [plan, setPlan] = useState(null);
  const [settings, setSettings] = useState({ startDate: '', seriesPerWindow: 3, weeksPerWindow: 2 });
  const [matchup, setMatchup] = useState(initialMatchup);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const editorRef = useRef(null);
  const base = `/api/admin/seasons/${seasonId}/schedule`;

  function applyPlan(data) {
    setPlan(data);
    if (data.settings) setSettings({ startDate: data.settings.StartDate,
      seriesPerWindow: data.settings.SeriesPerWindow, weeksPerWindow: data.settings.WeeksPerWindow });
  }

  useEffect(() => {
    const controller = new AbortController();
    request(base, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) applyPlan(data);
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base]);

  async function run(url, method, body, success) {
    setBusy(true); setError(''); setMessage('');
    try {
      applyPlan(await request(url, { method, headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) }));
      setMessage(success);
      return true;
    } catch (err) { setError(err.message); return false; }
    finally { setBusy(false); }
  }

  function resetMatchup() { setEditingId(null); setMatchup(initialMatchup); }

  function edit(row) {
    setEditingId(row.MatchupId);
    setMatchup({ groupId: String(row.GroupId), teamAEntryId: String(row.TeamAEntryId),
      teamBEntryId: String(row.TeamBEntryId), windowNumber: row.WindowNumber });
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function saveMatchup(event) {
    event.preventDefault();
    const random = !editingId && (!matchup.teamAEntryId || !matchup.teamBEntryId);
    const path = editingId ? `/${editingId}` : random ? '/random' : '';
    const saved = await run(`${base}/matchups${path}`, editingId ? 'PATCH' : 'POST', {
      ...matchup,
      teamAEntryId: random ? matchup.teamAEntryId || matchup.teamBEntryId || null : matchup.teamAEntryId,
    }, editingId ? 'Matchup updated.' : 'Matchup added.');
    if (saved) resetMatchup();
  }

  const settingsDirty = Boolean(plan?.settings && (settings.startDate !== plan.settings.StartDate
    || Number(settings.seriesPerWindow) !== plan.settings.SeriesPerWindow
    || Number(settings.weeksPerWindow) !== plan.settings.WeeksPerWindow));
  const groupTeams = plan?.teams.filter(team => String(team.GroupId) === matchup.groupId) || [];

  return <section className="league-schedule schedule-admin">
    <h2>Regular Season Matchups</h2>
    <p>Give each team a suggested list of opponents to help pace the regular season.
      {' '}Teams can arrange and play other series as usual.</p>
    {error && <p role="alert" className="schedule-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!plan ? <p>{error ? 'The plan could not be loaded. Reopen Schedule to retry.' : 'Loading matchups...'}</p> : <>
      <form className="schedule-card" onSubmit={event => {
        event.preventDefault();
        run(base, 'PUT', settings, 'Suggested pace saved.');
      }}>
        <h3>Pace of play</h3>
        <div className="schedule-controls">
          <label>First window starts<input type="date" required value={settings.startDate}
            min="2000-01-01" max="2100-12-31" onChange={event => setSettings({ ...settings, startDate: event.target.value })} /></label>
          <label>Series per team<input type="number" min="1" max="20" step="1" required value={settings.seriesPerWindow}
            onChange={event => setSettings({ ...settings, seriesPerWindow: event.target.value })} /></label>
          <label>Weeks per window<input type="number" min="1" max="12" step="1" required value={settings.weeksPerWindow}
            onChange={event => setSettings({ ...settings, weeksPerWindow: event.target.value })} /></label>
          <button disabled={busy} className="ui-button-primary">Save pace</button>
        </div>
        <p className="schedule-note">Dates and counts are guidance only. Save pace changes, then use Re-slot matchups
          to move the existing pairings into their new windows. Small remainders go in the last window.</p>
      </form>
      <div className="schedule-actions">
        <button type="button" className="ui-button-primary" disabled={busy || !plan.settings || settingsDirty}
          onClick={async () => {
            if (plan.matchups.length && !window.confirm('Replace all current matchup suggestions with a new randomized round robin?')) return;
            const saved = await run(`${base}/randomize`, 'POST', { replaceExisting: plan.matchups.length > 0 },
              'In-group matchups randomized.');
            if (saved) resetMatchup();
          }}>Randomize all matchups</button>
        <button type="button" disabled={busy || !plan.settings || settingsDirty || !plan.matchups.length}
          onClick={async()=>{if(await run(`${base}/reslot`,'POST',{},'Matchups re-slotted in their existing order.'))resetMatchup();}}>Re-slot matchups</button>
        <button type="button" disabled={busy} onClick={() => run(base, 'GET', null, 'Schedule refreshed.')}>Refresh</button>
        <span>{plan.matchups.length} / {plan.expectedMatchups} possible in-group pairings assigned</span>
      </div>
      {settingsDirty && <p role="status">Save the pace changes before randomizing or re-slotting matchups.</p>}
      <p className="schedule-note">Re-slotting keeps opponents and their order within each group. A manually arranged order
        may leave some teams with uneven loads; check the series counts and pacing notes below.</p>
      <p className="schedule-note">Randomization suggests one series against every opponent in the same group.
        Re-randomizing replaces the plan, including manual edits. It does not change groups or recorded results.</p>
      {plan.settings && <form ref={editorRef} className="schedule-card" onSubmit={saveMatchup}>
        <h3>{editingId ? 'Edit suggested matchup' : 'Add suggested matchup'}</h3>
        <div className="schedule-controls">
          <label>Group<select required value={matchup.groupId} onChange={event => setMatchup({ ...matchup,
            groupId: event.target.value, teamAEntryId: '', teamBEntryId: '' })}>
            <option value="">Choose a group</option>
            {plan.groups.map(group => <option key={group.GroupId} value={group.GroupId}>{group.GroupName}</option>)}
          </select></label>
          <label>Team<select required={Boolean(editingId)} value={matchup.teamAEntryId}
            onChange={event => setMatchup({ ...matchup, teamAEntryId: event.target.value })}>
            <option value="">{editingId ? 'Choose a team' : 'Random team'}</option>
            {groupTeams.filter(team => String(team.EntryId) !== matchup.teamBEntryId)
              .map(team => <option key={team.EntryId} value={team.EntryId}>{team.TeamName}</option>)}
          </select></label>
          <label>Opponent<select required={Boolean(editingId)} value={matchup.teamBEntryId}
            onChange={event => setMatchup({ ...matchup, teamBEntryId: event.target.value })}>
            <option value="">{editingId ? 'Choose an opponent' : 'Random opponent'}</option>
            {groupTeams.filter(team => String(team.EntryId) !== matchup.teamAEntryId)
              .map(team => <option key={team.EntryId} value={team.EntryId}>{team.TeamName}</option>)}
          </select></label>
          <label>Window<input type="number" min="1" max="104" step="1" required value={matchup.windowNumber}
            onChange={event => setMatchup({ ...matchup, windowNumber: event.target.value })} /></label>
          <button disabled={busy}>{editingId ? 'Save matchup'
            : !matchup.teamAEntryId || !matchup.teamBEntryId ? 'Add random matchup' : 'Add matchup'}</button>
          {editingId && <button type="button" disabled={busy} onClick={resetMatchup}>Cancel edit</button>}
        </div>
      </form>}
      {plan.warnings.length > 0 && <div className="schedule-notices" role="status">
        <strong>Pacing notes (advisory)</strong>
        <ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </div>}
      <LeagueScheduleView plan={plan} busy={busy} onEdit={edit} onRemove={async row => {
        if (!window.confirm(`Remove the suggestion for ${row.TeamAName} vs ${row.TeamBName}?`)) return;
        const saved = await run(`${base}/matchups/${row.MatchupId}`, 'DELETE', null, 'Suggestion removed.');
        if (saved && editingId === row.MatchupId) resetMatchup();
      }} />
    </>}
  </section>;
}
