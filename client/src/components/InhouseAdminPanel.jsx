import {useEffect, useState} from 'react';
import {inhouseRequest, useInhouses, useInhouseNow} from '../hooks/useInhouses';
import InhouseGameCard from './InhouseGameCard';
import {inhouseStatus, inhouseRoles} from '../utils/inhouseDisplay';
import '../pages/InhousesPage.css';

export default function InhouseAdminPanel({section = 'settings'}) {
  const {state, error, setError, busy, run, refresh} = useInhouses(null);
  const [form, setForm] = useState(null), [message, setMessage] = useState('');
  const [selectedId, setSelectedId] = useState(''), [lookup, setLookup] = useState(''), [detail, setDetail] = useState(null);
  const [matchId, setMatchId] = useState(''), [reason, setReason] = useState(''), [audit, setAudit] = useState([]);
  const now = useInhouseNow(state?.serverNow);
  useEffect(() => {
    if (!state?.settings) return;
    setForm(previous => previous?.version === state.settings.version ? previous : state.settings);
  }, [state?.settings]);
  useEffect(() => {
    if (section !== 'audit') return;
    const controller = new AbortController();
    inhouseRequest('/admin/inhouses/status', {signal: controller.signal}).then(data => setAudit(data.audit))
      .catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, [section, state?.revision, setError]);
  if (!state) return <p role={error ? 'alert' : 'status'}>{error || 'Loading inhouse administration…'}</p>;
  const selected = state.games.find(g => String(g.id) === selectedId) || (String(detail?.id) === selectedId ? detail : null);
  const active = state.games.filter(g => !['completed', 'cancelled'].includes(g.status));
  const change = (key, value) => {setForm(previous => ({...previous, [key]: value})); setMessage('');};
  async function save(event) {
    event.preventDefault();
    if (await run('/admin/inhouses/settings', 'PUT', form)) setMessage('Inhouse settings saved. New inhouses use these rules.');
  }
  async function findGame(event) {
    event.preventDefault();
    try {const data = await inhouseRequest(`/inhouses/games/${lookup}`); setDetail(data.game); setSelectedId(String(data.game.id)); setError('');}
    catch (e) {setError(e.message);}
  }
  async function recover(action) {
    const result = await run(`/admin/inhouses/games/${selected.id}/${action}`, 'POST', {matchId, reason});
    if (result) {
      setMessage(action === 'cancel' ? 'Inhouse cancelled and players released.' : 'Match verified and linked. Any affected ratings have been reconciled.');
      setReason(''); setMatchId('');
      try {const data = await inhouseRequest(`/inhouses/games/${selected.id}`); setDetail(data.game);} catch { /* Normal stream refresh still updates recent games. */ }
    }
  }
  return <div className="inhouse-admin">
    {error && <p className="inhouse-notice is-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <section className="inhouse-card"><header className="inhouse-card-heading"><h2>Inhouse operations</h2>
      <button disabled={busy} onClick={() => refresh().catch(e => setError(e.message))}>Refresh</button></header>
      <p>{state.queue.length} waiting · {active.length} active · {state.worker.lastTick && now - state.worker.lastTick < 45000 ? 'Worker connected' : 'Worker not reporting'}</p>
      {state.worker.lastSuccess && <p className="inhouse-muted">Last successful match check: {new Date(state.worker.lastSuccess).toLocaleString()}</p>}
      {state.worker.lastError && <p className="inhouse-notice">{state.worker.lastError}</p>}
    </section>
    {section === 'settings' && form && <section className="inhouse-card"><h2>Queue settings</h2><form className="inhouse-settings" onSubmit={save}>
      <label>Shared inhouse ticket / league ID<input required type="number" min="1" max="4294967295" value={form.leagueId || ''} onChange={event => change('leagueId', Number(event.target.value))} /></label>
      <label>Queue selection<select value={form.queueMode} onChange={event => change('queueMode', event.target.value)}>
        <option value="fifo">FIFO — first ten, roles informational</option><option value="preference">Role preference — accepted positions enforced</option></select></label>
      <label>Team formation<select value={form.draftMode} onChange={event => change('draftMode', event.target.value)}>
        <option value="captain">Captain draft</option><option value="automatic">Automatic balanced teams</option></select></label>
      <label>Game launch window (minutes)<input type="number" required min="1" max="120" value={form.launchMinutes} onChange={event => change('launchMinutes', Number(event.target.value))} /></label>
      <p className="inhouse-muted">One ticket is shared by every mode. Existing inhouses keep their saved ticket and rules. Ready checks and draft turns last 60 seconds.</p>
      <div><button type="submit" className="inhouse-primary" disabled={busy}>Save settings</button></div>
    </form></section>}
    {section === 'games' && <>
      <section className="inhouse-card"><h2>Waiting players</h2>{state.queue.length ? <div className="inhouse-ready-list">{state.queue.map(p =>
        <span key={p.playerId}>{p.name} · {inhouseRoles(p)}</span>)}</div> : <p className="inhouse-muted">No players waiting.</p>}</section>
      <section className="inhouse-card"><h2>Games and recovery</h2>
        <div className="inhouse-recovery"><label>Select an inhouse<select value={selectedId} onChange={event => {setSelectedId(event.target.value); setMessage(''); setReason(''); setMatchId('');}}>
          <option value="">Choose a game</option>{state.games.map(g => <option key={g.id} value={g.id}>#{g.id} · {inhouseStatus[g.status]}</option>)}
          {detail && !state.games.some(g => g.id === detail.id) && <option value={detail.id}>#{detail.id} · {inhouseStatus[detail.status]}</option>}</select></label>
          <form className="inhouse-actions" onSubmit={findGame}><label>Find an older inhouse<input aria-label="Older inhouse ID" type="number" min="1" required value={lookup} onChange={event => setLookup(event.target.value)} /></label><button type="submit">Find</button></form>
        </div>
      </section>
      {selected && <>
        <InhouseGameCard game={selected} now={now} busy userId={null} allowReadyPreview />
        {selected.status !== 'cancelled' && <section className="inhouse-card inhouse-recovery"><h2>Recover inhouse #{selected.id}</h2>
          <label>Reason<textarea required rows="2" maxLength="500" value={reason} onChange={event => setReason(event.target.value)} /></label>
          {['awaiting_game', 'playing', 'completed'].includes(selected.status) && <>
            <label>Correct Dota match ID<input type="number" min="1" value={matchId} onChange={event => setMatchId(event.target.value)} /></label>
            <p className="inhouse-muted">The ticket, ten players, and teams must match. Correcting a resolved game recalculates affected records and rating history.</p>
            <div><button disabled={busy || !reason.trim() || !matchId} onClick={() => recover('link')}>Verify and link match</button></div>
          </>}
          {selected.status !== 'completed' && <div><button disabled={busy || !reason.trim()} onClick={() => recover('cancel')}>Cancel inhouse and release players</button></div>}
        </section>}
      </>}
      {!selected && active.map(g => <details key={g.id} className="inhouse-admin-game"><summary>#{g.id} · {inhouseStatus[g.status]}<small>{g.players.map(p => p.name).join(', ')}</small></summary>
        <button onClick={() => setSelectedId(String(g.id))}>Open game and recovery</button></details>)}
    </>}
    {section === 'audit' && <section className="inhouse-card"><h2>Inhouse activity</h2><div className="inhouse-admin-games">
      {audit.map(entry => <div key={entry.id}><strong>{entry.inhouseId ? `#${entry.inhouseId} · ` : ''}{entry.action.replaceAll('-', ' ')}</strong>
        <small className="inhouse-player-note">{new Date(entry.at).toLocaleString()} · {entry.actorId ? `${entry.action === 'pick' ? 'Player' : 'Admin'} ${entry.actorId}` : 'Automatic'}</small>
        {entry.details.reason && <p>{entry.details.reason}</p>}{entry.details.matchId && <p>Match {entry.details.previousMatchId ? `${entry.details.previousMatchId} → ` : ''}{entry.details.matchId}</p>}</div>)}
      {!audit.length && <p className="inhouse-muted">No inhouse activity yet.</p>}
    </div></section>}
  </div>;
}
