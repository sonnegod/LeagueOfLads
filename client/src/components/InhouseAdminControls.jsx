import {useEffect, useRef, useState} from 'react';
import {useInhouses, useInhouseNow} from '../hooks/useInhouses';
import {InhouseAdminContext, useInhouseAdmin} from '../hooks/useInhouseAdmin';
import {inhouseAvailabilityLabels as availabilityLabels} from '../utils/inhouseDisplay';
import '../pages/InhousesPage.css';

export function InhouseAdminProvider({children}) {
  const controls = useInhouses(null, {admin: true});
  return <InhouseAdminContext.Provider value={controls}>{children}</InhouseAdminContext.Provider>;
}

export function InhouseAvailability() {
  const {state, busy, run, error} = useInhouseAdmin();
  const settings = state?.settings;
  const menu = useRef(null);
  const [mode, setMode] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => {setMode(settings?.availability || ''); setSaved(false);}, [settings?.availability]);
  useEffect(() => {
    const outside = event => {if (menu.current && !menu.current.contains(event.target)) menu.current.open = false;};
    const escape = event => {if (event.key === 'Escape' && menu.current?.open) {menu.current.open = false; menu.current.querySelector('summary').focus();}};
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);};
  }, []);
  async function save(event) {
    event.preventDefault();
    if (await run('/admin/inhouses/availability', 'PUT', {availability: mode, version: settings.version})) setSaved(true);
  }
  return <div className="inhouse-availability-control">
    <details ref={menu} className="inhouse-availability" data-availability={settings?.availability}>
      <summary aria-label={`Inhouse availability: ${availabilityLabels[settings?.availability] || 'Loading'}`}><span className="inhouse-availability-label">Inhouses</span> <strong>{availabilityLabels[settings?.availability] || 'Loading…'}</strong></summary>
      <form onSubmit={save} className="inhouse-availability-menu">
        <label>Inhouse availability<select value={mode} disabled={!settings || busy} onChange={event => {setMode(event.target.value); setSaved(false);}}>
          {!settings && <option value="">Loading…</option>}
          {Object.entries(availabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <p>Controls who can view and join inhouses. Closing or switching to admin testing clears the waiting queue; reserved games continue.</p>
        <button type="submit" disabled={!settings || busy || mode === settings.availability}>Apply availability</button>
        {saved && <span role="status">Availability saved.</span>}
      </form>
    </details>
    {error && <p className="inhouse-control-error" role="alert">{error}</p>}
  </div>;
}

export function InhouseWorkerStatus() {
  const {state, busy, refresh, setError, connected} = useInhouseAdmin();
  const now = useInhouseNow(state?.serverNow);
  if (!state) return null;
  const healthy = state.worker.lastTick && now - state.worker.lastTick < 45000;
  const active = state.games.filter(game => !['completed', 'cancelled'].includes(game.status)).length;
  const bots = state.bots || [];
  return <aside className="inhouse-worker-sidebar" aria-label="Inhouse worker and bot status">
    <section className="inhouse-card inhouse-worker-status">
      <header className="inhouse-card-heading"><h2>Worker & bots</h2>
        <button type="button" disabled={busy} onClick={() => refresh().catch(error => setError(error.message))} aria-label="Refresh worker and bot status">Refresh</button></header>
      <p className="inhouse-health" data-healthy={Boolean(healthy)}><span aria-hidden="true" />Worker {healthy ? 'connected' : 'not reporting'}</p>
      <p className="inhouse-muted">{state.queue.length} waiting · {active} active · {bots.filter(bot => bot.status === 'idle' && !bot.gameId).length} bots available</p>
      <ul className="inhouse-bot-status-list">{bots.map(bot => <li key={bot.id}>
        <div><strong>Bot {bot.id}</strong><span data-status={bot.status}>{bot.status}</span></div>
        {bot.gameId && <small>Inhouse #{bot.gameId}</small>}
        {bot.lastError && <small className="inhouse-control-error">{bot.lastError}</small>}
      </li>)}</ul>
      <details className="inhouse-worker-details"><summary>Connection details</summary>
        <p>{connected ? 'Live status updates' : 'Checking for updates'}</p>
        <p>Worker heartbeat: {state.worker.lastTick ? new Date(state.worker.lastTick).toLocaleString() : 'Not received'}</p>
        <p>Last Steam update: {state.worker.lastSuccess ? new Date(state.worker.lastSuccess).toLocaleString() : 'Not received'}</p>
        {bots.map(bot => <p key={bot.id}>Bot {bot.id}: {bot.steamId || 'Not authenticated'}</p>)}
      </details>
      {state.worker.lastError && <p className="inhouse-control-error">{state.worker.lastError}</p>}
    </section>
  </aside>;
}
