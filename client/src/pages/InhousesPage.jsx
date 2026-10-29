import {useEffect, useMemo, useState} from 'react';
import {Link, Navigate, useSearchParams} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import {inhouseRequest, useInhouses, useInhouseNow} from '../hooks/useInhouses';
import InhouseGameCard from '../components/InhouseGameCard';
import InhousePlayerSettings from '../components/InhousePlayerSettings';
import InhouseRoleWelcome from '../components/InhouseRoleWelcome';
import InhouseChat from '../components/InhouseChat';
import {inhouseStatus, inhouseRating, inhouseRoles, inhouseCalibration} from '../utils/inhouseDisplay';
import './InhousesPage.css';

function QueuePanel({profile, queued, busy, configured, run, onSettings}) {
  return <section className="inhouse-card"><h2>Your queue</h2>
    <p className="inhouse-muted">Saved preferences: <strong>{inhouseRoles(profile)}</strong></p>
    <div className="inhouse-actions">{queued ? <button disabled={busy} onClick={() => run('/inhouses/queue', 'DELETE')}>Leave queue</button>
        : <button className="inhouse-primary" disabled={busy || !configured}
          onClick={() => run('/inhouses/queue', 'POST', {roles: profile.roles, offRole: profile.offRole})}>Join queue</button>}</div>
    <div className="inhouse-actions"><button onClick={onSettings}>Player Settings</button></div>
  </section>;
}

function Leaderboard({players}) {
  const [search, setSearch] = useState(''), [sort, setSort] = useState({key: 'rating', direction: -1}), [page, setPage] = useState(0);
  const filtered = useMemo(() => players.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || String(p.playerId).includes(search))
    .sort((a, b) => {
      const value = p => sort.key === 'winRate' ? p.games ? p.wins / p.games : -1 : p[sort.key];
      const av = value(a), bv = value(b);
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * sort.direction || a.playerId - b.playerId;
    }), [players, search, sort]);
  const sortBy = key => {setPage(0); setSort(previous => ({key, direction: previous.key === key ? -previous.direction : key === 'name' ? 1 : -1}));};
  const lastPage = Math.max(0, Math.ceil(filtered.length / 20) - 1), current = Math.min(page, lastPage);
  return <section className="inhouse-card"><header className="inhouse-card-heading"><h2>Inhouse standings</h2>
    <input aria-label="Search inhouse players" placeholder="Search players" value={search} onChange={event => {setSearch(event.target.value); setPage(0);}} /></header>
    <div className="inhouse-table-wrap"><table className="inhouse-table"><thead><tr>
      {[['name', 'Player'], ['rating', 'Rating'], ['games', 'Games'], ['wins', 'Wins'], ['losses', 'Losses'], ['winRate', 'Win %']].map(([key, label]) =>
        <th key={key} scope="col" aria-sort={sort.key === key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}>
          <button type="button" className="ui-table-sort-button" title={`Sort by ${label.toLowerCase()}`} onClick={() => sortBy(key)}>
            {label}{sort.key === key && <span aria-hidden="true">{sort.direction === 1 ? '↑' : '↓'}</span>}
          </button></th>)}
    </tr></thead><tbody>{filtered.slice(current * 20, current * 20 + 20).map(p => <tr key={p.playerId}>
      <td><Link to={`/player/${p.playerId}`}>{p.name}</Link>{inhouseCalibration(p.games) && <small className="inhouse-calibration">{inhouseCalibration(p.games)}</small>}</td>
      <td>{inhouseRating(p.rating)}</td><td>{p.games}</td><td>{p.wins}</td><td>{p.losses}</td><td>{p.games ? `${(100 * p.wins / p.games).toFixed(0)}%` : '—'}</td>
    </tr>)}</tbody></table></div>
    {!filtered.length && <p className="inhouse-muted">No players to show yet.</p>}
    {filtered.length > 20 && <div className="inhouse-actions"><button disabled={!current} onClick={() => setPage(current - 1)}>Previous</button>
      <span>{current + 1} / {lastPage + 1}</span><button disabled={current >= lastPage} onClick={() => setPage(current + 1)}>Next</button></div>}
  </section>;
}

export default function InhousesPage() {
  const {user, loading} = useAuth();
  if (loading) return <p>Loading inhouses…</p>;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return <InhousesContent />;
}

function InhousesContent() {
  const {user, loading} = useAuth(), [params, setParams] = useSearchParams();
  const {state, profile, error, setError, busy, run, connected} = useInhouses(user?.accountId);
  const [archive, setArchive] = useState([]), [detail, setDetail] = useState(null), [historyBusy, setHistoryBusy] = useState(false);
  const now = useInhouseNow(state?.serverNow), requestedId = Number(params.get('game')) || null;
  const mine = state?.games.find(g => !['completed', 'cancelled'].includes(g.status) && g.players.some(p => String(p.playerId) === String(user?.accountId)));
  const ownActiveGameId = mine?.id;
  const activeTab = mine ? 'lobby' : ['standings', 'history', 'settings'].includes(params.get('tab')) ? params.get('tab') : 'lobby';
  const changeTab = tab => {const next = new URLSearchParams(params); if (tab === 'lobby') next.delete('tab'); else next.set('tab', tab); setParams(next);};
  useEffect(() => {
    if (!ownActiveGameId || params.get('game') === String(ownActiveGameId) && !params.has('tab')) return;
    const next = new URLSearchParams(params);
    next.set('game', String(ownActiveGameId)); next.delete('tab');
    setParams(next, {replace: true});
  }, [ownActiveGameId, params, setParams]);
  const requestedInState = state?.games.some(game => game.id === requestedId);
  useEffect(() => {
    if (ownActiveGameId || !requestedId || requestedInState) return;
    const controller = new AbortController();
    inhouseRequest(`/inhouses/games/${requestedId}`, {signal: controller.signal}).then(data => setDetail(data.game))
      .catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, [ownActiveGameId, requestedId, requestedInState, state?.revision, setError]);
  if (!state) return <div className="ui-page inhouses-page"><h1>Inhouses</h1><p role={error ? 'alert' : 'status'}>{error || 'Loading inhouses…'}</p></div>;
  const games = [...new Map([...archive, ...(detail ? [detail] : []), ...state.games].map(g => [g.id, g])).values()]
    .filter(g => g.status !== 'ready' || g.players.some(p => String(p.playerId) === String(user?.accountId)))
    .sort((a, b) => b.id - a.id);
  const queued = state.queue.some(p => String(p.playerId) === String(user?.accountId));
  const selected = requestedId ? games.find(g => g.id === requestedId) : activeTab === 'history' ? null : mine || state.games.find(g => g.players.some(p => String(p.playerId) === String(user?.accountId)));
  const active = games.filter(g => !['completed', 'cancelled'].includes(g.status) && g.id !== selected?.id);
  const completed = games.filter(g => ['completed', 'cancelled'].includes(g.status));
  const stale = !state.worker.lastTick || now - state.worker.lastTick > 45000;
  async function older() {
    setHistoryBusy(true);
    try {const result = await inhouseRequest(`/inhouses/games?before=${games.at(-1)?.id || Number.MAX_SAFE_INTEGER}`); setArchive(previous => [...previous, ...result.games]);}
    catch (e) {setError(e.message);} finally {setHistoryBusy(false);}
  }
  const card = game => <InhouseGameCard key={game.id} game={game} userId={user?.accountId} now={now} busy={busy}
    onReady={id => run(`/inhouses/games/${id}/ready`, 'POST')}
    onPick={(id, playerId, turn) => run(`/inhouses/games/${id}/pick`, 'POST', {playerId, turn})} />;
  return <div className="ui-page inhouses-page">
    <header className="inhouse-page-heading"><h1>Inhouses</h1>
    <div className="ui-tabs inhouse-tabs" role="tablist" aria-label="Inhouse sections">
      {[['lobby', 'Lobby'], ['standings', 'Standings'], ['history', 'History'], ['settings', 'Player Settings']].map(([key, label]) => <button type="button" className="ui-tab" role="tab" key={key}
        id={`inhouse-${key}-tab`} aria-controls={`inhouse-${key}-panel`} aria-selected={activeTab === key}
        disabled={key !== 'lobby' && Boolean(mine)} title={key !== 'lobby' && mine ? 'Available when your inhouse completes or is cancelled' : undefined}
        onClick={() => changeTab(key)}>{label}</button>)}
    </div>
    </header>
    {user && profile && profile.playerId === Number(user.accountId) && !profile.preferencesPromptedAt && !mine &&
      <InhouseRoleWelcome key={user.accountId} profile={profile} run={run} busy={busy} />}
    {error && <p className="inhouse-notice is-error" role="alert">{error}</p>}
    {activeTab === 'standings' ? <section role="tabpanel" id="inhouse-standings-panel" aria-labelledby="inhouse-standings-tab">
      <Leaderboard players={state.leaderboard} />
    </section> : activeTab === 'history' ? <section role="tabpanel" id="inhouse-history-panel" aria-labelledby="inhouse-history-tab">
      <section className="inhouse-card"><header className="inhouse-card-heading"><h2>Game history</h2>
        {requestedId && <button onClick={() => {const next = new URLSearchParams(params); next.delete('game'); setParams(next);}}>Clear selection</button>}</header>
        <div className="inhouse-history">{completed.map(g => <button key={g.id} aria-pressed={selected?.id === g.id}
          onClick={() => setParams({tab: 'history', game: String(g.id)})}>
          <strong>#{g.id}</strong><span>{inhouseStatus[g.status]}{g.winner ? ` · Team ${g.winner} won` : ''}</span><small>{new Date(g.createdAt).toLocaleString()}</small></button>)}</div>
        {!completed.length && <p className="inhouse-muted">Completed inhouses will appear here.</p>}
        {games.length > 0 && <button disabled={historyBusy || games.at(-1)?.id === 1} onClick={older}>{historyBusy ? 'Loading…' : 'Load older games'}</button>}
      </section>
      {selected && ['completed', 'cancelled'].includes(selected.status) && card(selected)}
    </section> : activeTab === 'settings' ? <section role="tabpanel" id="inhouse-settings-panel" aria-labelledby="inhouse-settings-tab">
      {user && profile ? <InhousePlayerSettings key={`${profile.playerId}:${profile.preferencesPromptedAt}`} profile={profile} reserved={Boolean(mine)} busy={busy} run={run} />
        : <section className="inhouse-card"><h2>Player Settings</h2><p>Sign in to save your preferred positions.</p>
          <a className="inhouse-signin" href="/api/auth/steam?returnTo=/inhouses">Sign in with Steam</a></section>}
    </section> : <section role="tabpanel" id="inhouse-lobby-panel" aria-labelledby="inhouse-lobby-tab">
    {!mine && !state.settings.leagueId ? <p className="inhouse-notice">Queueing opens once an admin configures the inhouse ticket.</p>
      : stale && <p className="inhouse-notice">Automatic inhouse updates are delayed. An admin can check the worker.</p>}
    {mine ? <div className="inhouse-focused-lobby">{card(mine)}
      <InhouseChat key={`${mine.id}:${user.accountId}`} gameId={mine.id} accountId={user.accountId} /></div> : <>
    <div className="inhouse-overview"><span><strong>{state.queue.length}</strong> waiting</span><span>{state.settings.queueMode === 'fifo' ? 'FIFO · roles informational' : 'Role preference'}</span>
      <span>{state.settings.draftMode === 'captain' ? 'Captain draft' : 'Automatic teams'}</span><span>{connected ? 'Live updates' : 'Checking for updates'}</span></div>
    {selected && !['completed', 'cancelled'].includes(selected.status) && card(selected)}
    <div className="inhouse-lobby-grid">
      {user && profile ? <QueuePanel profile={profile} queued={queued} busy={busy} configured={Boolean(state.settings.leagueId)} run={run} onSettings={() => changeTab('settings')} />
        : <section className="inhouse-card"><h2>Join an inhouse</h2><p>{loading || user ? 'Loading your preferences…' : 'Sign in to choose your positions and join the queue.'}</p>
          {!loading && !user && <a className="inhouse-signin" href="/api/auth/steam?returnTo=/inhouses">Sign in with Steam</a>}</section>}
      <section className="inhouse-card"><header className="inhouse-card-heading"><h2>Waiting room</h2><span>{state.queue.length}/10</span></header>
        <p className="inhouse-muted">{state.settings.queueMode === 'fifo' ? 'First ten in. Position preferences are shown, but roles are not guaranteed.'
          : 'One of each position per team. The oldest eligible player gets priority.'}</p>
        {state.settings.queueMode === 'preference' && state.queue.length > 0 && <div className="inhouse-coverage" aria-label="Players accepting each position">
          {[1,2,3,4,5].map(role => {
            const count = state.queue.filter(p => p.offRole || p.roles.includes(role)).length;
            return <span key={role} className={count < 2 ? 'needs-players' : ''}>Pos {role}: {count}{count < 2 ? ` · need ${2 - count} more` : ''}</span>;
          })}
          <small>Players can accept multiple positions; a complete role-compatible group of ten is required.</small>
        </div>}
        {state.queue.length ? <ol className="inhouse-queue">{state.queue.map(p => <li key={p.playerId}><InhousePlayerRow player={p} /></li>)}</ol>
          : <p className="inhouse-muted">No players waiting. Start the next game.</p>}
        {user?.isAdmin && state.queue.length === 2 && <div className="inhouse-actions">
          <button type="button" disabled={busy || !state.settings.leagueId} onClick={() => run('/admin/inhouses/test', 'POST')}>Start 2-player test</button>
          <small className="inhouse-muted">1v1 using these two players and the configured ticket.</small>
        </div>}
      </section>
    </div>
    {active.map(card)}
    </>}
    </section>}
  </div>;
}

function InhousePlayerRow({player}) {
  return <div className="inhouse-queue-row"><Link to={`/player/${player.playerId}`}>{player.name}</Link>
    <span>{inhouseRoles(player)}</span><strong>{inhouseRating(player.rating)}</strong></div>;
}
