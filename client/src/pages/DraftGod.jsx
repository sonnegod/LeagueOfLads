import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import { useAuth } from '../context/AuthContext';
import HeroDisplay from '../components/HeroDisplay';
import { analyzeDraft, DEFAULT_FORMAT, MODEL_VERSION, TRAITS, validateDraftState, validateFormat } from '../../../shared/draftModel.js';
import DraftIntelligence from './DraftIntelligence';
import { banImpact } from '../../../shared/draftModel.js';
import './DraftGod.css';

const styles = {
  control: b => ({ ...b, background: '#0f172a', borderColor: '#334155', minWidth: 0 }),
  menu: b => ({ ...b, background: '#111827', zIndex: 30 }),
  option: (b, s) => ({ ...b, background: s.isFocused ? '#1e3a5f' : '#111827', color: '#e2e8f0' }),
  singleValue: b => ({ ...b, color: '#e2e8f0' }), input: b => ({ ...b, color: '#e2e8f0' }),
};
const option = row => ({ value: row.id, label: `${row.name} (${row.id})` });
const signature = doc => JSON.stringify([doc.name, doc.state]);
const winRate = row => row?.games ? `${(100 * row.wins / row.games).toFixed(1)}%` : 'No sample';
const stamp = iso => iso ? new Date(iso).toLocaleString() : 'Unknown';
const localTime = iso => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
async function request(path, options = {}) {
  const response = await fetch(`/api/draftgod${path}`, { ...options, cache: 'no-store', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Draft God request failed'), { status: response.status });
  return data;
}
const initialConfig = setup => ({ seasonId: setup.seasonId, ourTeam: setup.ourTeam, opponentTeam: setup.opponentTeam,
  firstPick: true, radiant: true, asOf: new Date().toISOString(), format: DEFAULT_FORMAT,
  lineups: Object.fromEntries(['our', 'opponent'].map(side => {
    const team = setup.teams.find(t => t.key === (side === 'our' ? setup.ourTeam : setup.opponentTeam));
    return [side, (team?.roster.players || []).slice(0, 5).map(p => ({ id: p.id, role: 0 }))];
  })) });

function LineupEditor({ side, config, setup, onChange, disabled, knownPlayers }) {
  const team = setup.teams.find(t => t.key === config[side === 'our' ? 'ourTeam' : 'opponentTeam']);
  const lineup = config.lineups[side], roster = team?.roster.players || [];
  const [extra, setExtra] = useState([]);
  const candidates = [...new Map([...roster, ...extra, ...knownPlayers.filter(p => lineup.some(l => l.id === p.id))].map(p => [p.id, p])).values()];
  const setLineup = next => onChange({ ...config, lineups: { ...config.lineups, [side]: next } });
  const search = async query => query.trim().length < 2 ? [] : (await request(`/players?search=${encodeURIComponent(query)}`)).players.map(option);
  return <section className="dg-panel dg-lineup"><h3>{side === 'our' ? 'Your lineup' : 'Opponent lineup'} <span>{lineup.length}/5</span></h3>
    <p className="dg-muted">{team?.roster.source === 'signup' ? 'Signup roster: confirm who is playing today.' : 'Historical appearances: confirm the actual players and stand-ins.'}</p>
    <div className="dg-lineup-rows">{lineup.map((player, index) => {
      const name = candidates.find(p => p.id === player.id)?.name || `Player ${player.id}`;
      return <div key={player.id} className="dg-lineup-row"><span><strong>{name}</strong><small>{player.id}</small></span>
        <label><span className="sr-only">Position for {name}</span><select value={player.role} disabled={disabled}
          onChange={e => setLineup(lineup.map((p, i) => i === index ? { ...p, role: Number(e.target.value) } : p))}>
          <option value={0}>Position unknown</option>{[1, 2, 3, 4, 5].map(role => <option key={role} value={role}>Position {role}</option>)}</select></label>
        <button type="button" disabled={disabled} aria-label={`Remove ${name} from ${side} lineup`} onClick={() => setLineup(lineup.filter(p => p.id !== player.id))}>Remove</button></div>;
    })}</div>
    {lineup.length < 5 && <><label>Add team member<select disabled={disabled} value="" onChange={e => {
      if (e.target.value) setLineup([...lineup, { id: Number(e.target.value), role: 0 }]);
    }}><option value="">Choose a player</option>{candidates.filter(p => !lineup.some(l => l.id === p.id)).map(p =>
      <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}</select></label>
      <label htmlFor={`dg-standin-${side}`}>Find a stand-in by name or account ID</label>
      <AsyncSelect inputId={`dg-standin-${side}`} styles={styles} loadOptions={search} cacheOptions
        placeholder="Type at least two characters…" noOptionsMessage={() => 'Search players in PlayerInfo'} isDisabled={disabled} value={null}
        onChange={v => { if (!v || lineup.some(p => p.id === v.value)) return;
          setExtra(current => [...current, { id: v.value, name: v.label.replace(/ \(\d+\)$/, '') }]); setLineup([...lineup, { id: v.value, role: 0 }]); }} />
    </>}
  </section>;
}

function Scouting({ data, config, onProfileSaved, report }) {
  const [side, setSide] = useState('opponent'), [heroId, setHeroId] = useState(data.heroes[0]?.id);
  const profile = data.heroProfiles[heroId];
  const [roles, setRoles] = useState(profile?.roles || []), [tags, setTags] = useState(profile?.tags || []), [busy, setBusy] = useState(false);
  useEffect(() => { setRoles(profile?.roles || []); setTags(profile?.tags || []); }, [profile, heroId]);
  const names = new Map(data.heroes.map(h => [h.id, h.name]));
  const team = data.teams[side === 'our' ? config.ourTeam : config.opponentTeam];
  const toggle = (list, value) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];
  async function saveProfile(e) {
    e.preventDefault(); setBusy(true);
    try { const result = await request(`/heroes/${heroId}`, { method: 'PUT', body: JSON.stringify({ roles, tags, patch: data.meta.current?.key }) }); onProfileSaved(heroId, result.profile); }
    catch (e) { report(e.message); } finally { setBusy(false); }
  }
  return <div className="dg-scouting"><div className="ui-tabs"><button className="ui-tab" aria-pressed={side === 'our'} onClick={() => setSide('our')}>Your team</button>
    <button className="ui-tab" aria-pressed={side === 'opponent'} onClick={() => setSide('opponent')}>Opponent</button></div>
    <div className="dg-two-columns"><section className="dg-panel"><h2>Confirmed player pools</h2>{config.lineups[side].map(({ id, role }) => {
      const player = data.players[id];
      return <details key={id} className="dg-player-detail"><summary><strong>{player.name}</strong><span>{role ? `Pos ${role} · ` : ''}{player.games} league games · {winRate(player)}</span></summary>
        <div className="dg-table-wrap"><table><thead><tr><th>Hero</th><th>Games</th><th>W–L</th><th>Win rate</th><th>Retained outcomes</th><th>Current patch</th></tr></thead><tbody>{player.heroes.map(hero =>
          <tr key={hero.id}><td><HeroDisplay heroId={hero.id} heroName={names.get(hero.id)} iconSize={24} /></td><td title={Object.entries(hero.patches || {}).map(([key,r])=>`${key}: ${r.wins}W/${r.games-r.wins}L`).join("; ")}>{hero.games}</td><td>{hero.wins}–{hero.games - hero.wins}</td><td>{winRate(hero)}</td><td>{hero.effectiveGames?.toFixed(1)}</td><td>{hero.currentGames}</td></tr>)}</tbody></table></div>
        {!player.games && <p>No eligible league history before the cutoff.</p>}<h4>Public practice · previous 30 days</h4>
        <p className="dg-muted">{player.publicFresh ? 'Usable observations at this cutoff.' : 'Stale or unverified collection; excluded from scoring.'} Last successful collection: {stamp(player.lastPublicSuccessAt)}.</p>
        <div className="dg-chips">{player.publicHeroes.slice(0, 8).map(hero => <span key={hero.id}><HeroDisplay heroId={hero.id} heroName={names.get(hero.id)} iconSize={22} />{hero.games} games · {winRate(hero)}</span>)}</div>
        {!player.publicGames && <p className="dg-muted">No observed public games in this window. Collection gaps and private profiles are not treated as poor performance.</p>}
      </details>;
    })}</section>
    <section className="dg-panel"><h2>{team.name} · team tendencies</h2><p className="dg-muted">{team.games} historical games before the cutoff. Team-ID history can include earlier lineups.</p>
      <div className="dg-table-wrap"><table><thead><tr><th>Hero</th><th>Picks / games</th><th>Pick rate</th><th>W–L</th><th>Opening picks</th></tr></thead><tbody>
        {Object.entries(team.heroes).sort((a, b) => b[1].picks - a[1].picks).slice(0, 15).map(([id, h]) => <tr key={id}>
          <td><HeroDisplay heroId={Number(id)} heroName={names.get(Number(id))} iconSize={24} /></td><td>{h.picks}/{team.games}</td><td>{team.games ? (100 * h.picks / team.games).toFixed(1) : 0}%</td><td>{h.wins}–{h.picks - h.wins}</td><td>{h.firstPicks}</td></tr>)}
      </tbody></table></div>{!team.games && <p>New team: recommendations use confirmed players' history and public practice.</p>}
      <h3>Common bans</h3><div className="dg-chips">{Object.entries(team.bans).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, count]) =>
        <span key={id}><HeroDisplay heroId={Number(id)} heroName={names.get(Number(id))} iconSize={22} />{count}</span>)}</div>
      <details><summary>Observed hero pairs · at least five games</summary><div className="dg-table-wrap"><table><thead><tr><th>Pair</th><th>Games</th><th>Raw win rate</th><th>Retained outcomes</th><th>Adjusted win rate</th></tr></thead><tbody>
        {Object.entries(team.pairs).filter(([, p]) => p.games >= 5).sort((a, b) => b[1].games - a[1].games).slice(0, 10).map(([key, p]) => <tr key={key}>
          <td>{key.split(':').map(id => names.get(Number(id))).join(' + ')}</td><td>{p.games}</td><td>{winRate(p)}</td><td>{p.effectiveGames.toFixed(1)}</td><td>{p.effectiveGames>=5?`${(100*p.effectiveWins/p.effectiveGames).toFixed(1)}%`:"Insufficient"}</td></tr>)}
      </tbody></table></div><p className="dg-muted">Historical associations can reflect team strength and player choices.</p></details>
    </section></div>
    <section className="dg-panel"><h2>Private hero profiles</h2><p className="dg-muted">Set positions and capabilities you trust for patch {data.meta.current?.key || 'unknown'}. Profiles are saved per patch; historical profiles are curated with today's knowledge. Unclassified heroes stay unknown in composition analysis.</p>
      <Select inputId="dg-profile-hero" aria-label="Hero profile" styles={styles} options={data.heroes.map(option)}
        value={data.heroes.some(h => h.id === heroId) ? option(data.heroes.find(h => h.id === heroId)) : null} onChange={v => setHeroId(v.value)} />
      <form onSubmit={saveProfile}><fieldset><legend>Positions</legend><div className="dg-checks">{[1, 2, 3, 4, 5].map(role => <label key={role}>
        <input type="checkbox" checked={roles.includes(role)} onChange={() => setRoles(toggle(roles, role))} />Position {role}</label>)}</div></fieldset>
        <fieldset><legend>Composition traits</legend><div className="dg-checks">{TRAITS.map(tag => <label key={tag}><input type="checkbox" checked={tags.includes(tag)} onChange={() => setTags(toggle(tags, tag))} />{tag}</label>)}</div></fieldset>
        <button disabled={busy || !heroId || !data.meta.current} type="submit">{busy ? 'Saving…' : 'Save hero profile'}</button></form>
    </section>
  </div>;
}

export default function DraftGodPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = user?.accountId === '49219700' && user?.canDraftGod;
  const [setup, setSetup] = useState(null), [config, setConfig] = useState(null), [doc, setDoc] = useState(null);
  const [data, setData] = useState(null), [tab, setTab] = useState('preparation'), [drafts, setDrafts] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saveStatus, setSaveStatus] = useState(''), [conflict, setConflict] = useState(false);
  const [tick, setTick] = useState(0), [search, setSearch] = useState(''), [heroId, setHeroId] = useState(''), [playerId, setPlayerId] = useState('');
  const [editing, setEditing] = useState(null), [formatText, setFormatText] = useState(DEFAULT_FORMAT.actions.join(' '));
  const saved = useRef(null), inFlight = useRef(false), latest = useRef(null), generation = useRef(0);
  latest.current = doc;
  const refreshList = useCallback(async () => setDrafts((await request('/drafts')).drafts), []);
  const install = useCallback(async (document, token, signal) => {
    const [catalog, context] = await Promise.all([request(`?seasonId=${document.state.config.seasonId}`), request('/context', { method: 'POST', body: JSON.stringify({ config: document.state.config }) })]);
    if (token !== generation.current || signal?.aborted) return;
    saved.current = { id: document.id, signature: signature(document), revision: document.revision };
    setSetup(catalog); setData(context); setConfig(document.state.config); setDoc(document); setFormatText(document.state.config.format.actions.join(' '));
    setConflict(false); setSaveStatus('Saved'); setEditing(null); setHeroId(''); setPlayerId(''); setTab('live');
    try { localStorage.setItem('draftgod:last-open:49219700', String(document.id)); } catch { /* Optional browser preference. */ }
  }, []);
  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController(), token = ++generation.current; setBusy(true);
    Promise.all([request('', { signal: controller.signal }), request('/drafts', { signal: controller.signal })]).then(async ([catalog, list]) => {
      if (controller.signal.aborted) return;
      setSetup(catalog); setDrafts(list.drafts); if (catalog.seasonId) setConfig(initialConfig(catalog));
      let last; try { last = Number(localStorage.getItem('draftgod:last-open:49219700')); } catch { /* Optional preference. */ }
      if (list.drafts.some(d => d.id === last)) await install(await request(`/drafts/${last}`, { signal: controller.signal }), token, controller.signal);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [allowed, install]);
  useEffect(() => {
    if (!allowed || !doc || conflict || signature(doc) === saved.current?.signature) return undefined;
    setSaveStatus('Unsaved changes');
    const timer = setTimeout(async () => {
      if (inFlight.current) return;
      inFlight.current = true; const id = doc.id, sentSignature = signature(doc); setSaveStatus('Saving…');
      try {
        const updated = await request(`/drafts/${id}`, { method: 'PATCH', body: JSON.stringify({ name: doc.name, state: doc.state, revision: saved.current.revision }) });
        if (latest.current?.id !== id) return;
        saved.current = { id, signature: sentSignature, revision: updated.revision };
        setDoc(current => current?.id === id ? { ...current, revision: updated.revision } : current); setSaveStatus('Saved'); setTick(n => n + 1);
      } catch (e) { if (latest.current?.id === id) { setSaveStatus('Save failed'); setError(e.message); if (e.status === 409) setConflict(true); } }
      finally { inFlight.current = false; }
    }, 750);
    return () => clearTimeout(timer);
  }, [allowed, doc, conflict, tick]);
  useEffect(() => {
    if (!doc || signature(doc) === saved.current?.signature) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [doc]);
  const liveConfig = doc?.state.config, liveBoard = doc?.state.board;
  const model = useMemo(() => data && liveConfig ? analyzeDraft(data, liveConfig, liveBoard) : null, [data, liveConfig, liveBoard]);
  const recommendationModel = useMemo(() => model && editing !== null ? analyzeDraft(data, doc.state.config, doc.state.board.slice(0, editing)) : model, [model, editing, data, doc]);
  const action = editing !== null ? model?.sequence[editing] : model?.action;
  const heroes = useMemo(() => { if (!data || !doc) return []; const used = new Set(doc.state.board.filter((_, i) => i !== editing).map(row => row.heroId));
    return data.heroes.filter(h => !used.has(h.id) && h.name.toLowerCase().includes(search.toLowerCase())); }, [data, doc, editing, search]);
  const names = useMemo(() => new Map((data?.heroes || []).map(h => [h.id, h.name])), [data]);
  const canLeave = () => !inFlight.current && (!doc || signature(doc) === saved.current?.signature || window.confirm('This draft has unsaved changes. Continue without saving them?'));
  async function refreshContext(nextConfig) {
    setBusy(true);
    try {
      const context=await request('/context',{method:'POST',body:JSON.stringify({config:nextConfig})});
      setData(context);setDoc(current=>({...current,state:{...current.state,config:nextConfig,modelVersion:MODEL_VERSION}}));
    } finally { setBusy(false); }
  }
  async function chooseSeason(id) {
    setBusy(true); setError(''); try { const catalog = await request(`?seasonId=${id}`); setSetup(catalog); setConfig(initialConfig(catalog)); setFormatText(DEFAULT_FORMAT.actions.join(' ')); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function chooseTeam(side, key) { const team = setup.teams.find(t => t.key === key); setConfig(current => ({ ...current,
    [side === 'our' ? 'ourTeam' : 'opponentTeam']: key, lineups: { ...current.lineups, [side]: (team?.roster.players || []).slice(0, 5).map(p => ({ id: p.id, role: 0 })) } })); }
  async function startDraft(e) {
    e.preventDefault(); if (!canLeave()) return; setBusy(true); setError(''); const token = ++generation.current;
    try {
      const format = { id: formatText.trim() === DEFAULT_FORMAT.actions.join(' ') ? DEFAULT_FORMAT.id : 'custom-v1', name: 'League draft', actions: formatText.trim().toUpperCase().split(/\s+/) };
      validateFormat(format); const state = { version: 1, modelVersion: MODEL_VERSION, config: { ...config, format }, board: [], undo: [], redo: [] }; validateDraftState(state);
      if (doc?.state.board.length && !window.confirm('Start a new draft? Your previous draft remains in Saved drafts.')) return;
      const context = await request('/context', { method: 'POST', body: JSON.stringify({ config: state.config }) });
      const name = `${context.teams[config.ourTeam].name} vs ${context.teams[config.opponentTeam].name}`.slice(0, 100);
      const created = await request('/drafts', { method: 'POST', body: JSON.stringify({ name, state }) }); if (generation.current !== token) return;
      saved.current = { id: created.id, signature: signature(created), revision: created.revision }; setData(context); setDoc(created); setConflict(false); setSaveStatus('Saved');
      setTab('live'); setEditing(null); setHeroId(''); setPlayerId(''); try { localStorage.setItem('draftgod:last-open:49219700', String(created.id)); } catch { /* Optional preference. */ }
      await refreshList();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function openDraft(id) { if (!canLeave()) return; setBusy(true); setError(''); const token = ++generation.current;
    try { await install(await request(`/drafts/${id}`), token); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function cloneDraft() { if (!doc) return; setBusy(true); setError(''); const token = ++generation.current;
    try { const copy = await request('/drafts', { method: 'POST', body: JSON.stringify({ name: `${doc.name.slice(0, 85)} · alternative`, state: doc.state }) }); await install(copy, token); await refreshList(); }
    catch (e) { setError(e.message); } finally { setBusy(false); } }
  function changeBoard(board) {
    try { const next = { ...doc.state, board, undo: [...(doc.state.undo || []), doc.state.board].slice(-40), redo: [] }; validateDraftState(next);
      if (!analyzeDraft(data, next.config, next.board).valid) throw new Error('These picks cannot be assigned to five different players in their configured positions. Adjust the assignment or hero profile.');
      setDoc(current => ({ ...current, state: next })); setEditing(null); setHeroId(''); setPlayerId(''); setSearch(''); setError('');
    } catch (e) { setError(e.message); }
  }
  function applyHero(id) { if (!action || !id) return; const entry = { heroId: Number(id), playerId: action.type === 'pick' ? Number(playerId) || null : null };
    const next = [...doc.state.board]; if (editing !== null) next[editing] = entry; else next.push(entry); changeBoard(next); }
  function travel(direction) { const stack = doc.state[direction] || []; if (!stack.length) return; const other = direction === 'undo' ? 'redo' : 'undo';
    setDoc(current => ({ ...current, state: { ...current.state, board: stack.at(-1), [direction]: stack.slice(0, -1), [other]: [...(current.state[other] || []), current.state.board].slice(-40) } })); setEditing(null); setHeroId(''); setPlayerId(''); }
  if (authLoading) return <p>Loading…</p>;
  if (!allowed) return <Navigate to="/" replace />;
  return <div className="ui-page dg-page"><header className="dg-header"><div><p className="dg-eyebrow">Private workspace · {user.personaname}</p><h1>Draft God</h1><p className="dg-muted">Prepare the matchup. Build the draft. Keep the evidence in view.</p></div>
    {doc && <div className="dg-save"><label htmlFor="dg-draft-name">Draft name</label><input id="dg-draft-name" maxLength={100} value={doc.name} onChange={e => setDoc(current => ({ ...current, name: e.target.value }))} />
      <span role="status">{saveStatus}</span><button disabled={busy || inFlight.current} onClick={cloneDraft}>Save alternative</button>
      {saveStatus === 'Save failed' && !conflict && <button onClick={() => setTick(n => n + 1)}>Retry save</button>}</div>}</header>
    {error && <div className="dg-error" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {conflict && <p role="alert" className="dg-warning">Autosave paused: another tab changed this draft. Reopen the saved version or save an alternative.</p>}
    {doc?.state.modelVersion && doc.state.modelVersion !== MODEL_VERSION && <p className="dg-warning">This draft was saved with {doc.state.modelVersion}. Analysis is now using {MODEL_VERSION}.</p>}
    <nav className="ui-tabs dg-tabs" aria-label="Draft God sections">{[['preparation', 'Preparation'], ['live', 'Live draft'], ['scouting', 'Scouting'], ['overview', 'Matchup overview']].map(([key, label]) =>
      <button key={key} className="ui-tab" aria-pressed={tab === key} disabled={key !== 'preparation' && (!doc || busy)} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {busy && <p role="status">Loading private draft data…</p>}
    {tab === 'preparation' && <div className="dg-preparation"><section className="dg-panel"><h2>Matchup preparation</h2>
      {setup && config ? <form onSubmit={startDraft}><div className="dg-settings"><label>Season<select disabled={busy} value={setup.seasonId || ''} onChange={e => chooseSeason(Number(e.target.value))}>
        {setup.seasons.map(s => <option key={s.id} value={s.id}>{s.name} · {s.status}</option>)}</select></label>
        {['our', 'opponent'].map(side => <label key={side}>{side === 'our' ? 'Your team' : 'Opponent'}<select disabled={busy} value={config[side === 'our' ? 'ourTeam' : 'opponentTeam']} onChange={e => chooseTeam(side, e.target.value)}>
          <option value="">Select team</option>{setup.teams.map(t => <option key={t.key} value={t.key}>{t.group ? `${t.group} · ` : ''}{t.name}{t.teamId ? ` (${t.teamId})` : ' · awaiting team ID'}</option>)}</select></label>)}
        <label>Outcome evidence<select value={config.metaMode || 'adaptive'} disabled={busy} onChange={e=>setConfig({...config,metaMode:e.target.value})}><option value="adaptive">Adaptive across patches</option><option value="current">Current patch only</option><option value="recent">Last 30 days, patch adjusted</option></select></label>
        <label>Pick order<select value={String(config.firstPick)} disabled={busy} onChange={e => setConfig({ ...config, firstPick: e.target.value === 'true' })}><option value="true">We have first pick</option><option value="false">We have second pick</option></select></label>
        <label>Map side<select value={String(config.radiant)} disabled={busy} onChange={e => setConfig({ ...config, radiant: e.target.value === 'true' })}><option value="true">We are Radiant</option><option value="false">We are Dire</option></select></label>
        <label>Use data before (your local time)<input type="datetime-local" required value={localTime(config.asOf)} disabled={busy} onChange={e => { if (e.target.value) setConfig({ ...config, asOf: new Date(e.target.value).toISOString() }); }} /></label></div>
        <p className="dg-muted">The cutoff is frozen with the draft. Historical scouting excludes future results and undated games. Date-only matches on the cutoff day are excluded too.</p>
        <div className="dg-two-columns">{['our', 'opponent'].map(side => <LineupEditor key={`${setup.seasonId}:${side}:${config[side === 'our' ? 'ourTeam' : 'opponentTeam']}`} side={side} config={config} setup={setup} knownPlayers={Object.values(data?.players || {})} onChange={setConfig} disabled={busy} />)}</div>
        <details className="dg-format"><summary>Draft sequence · {DEFAULT_FORMAT.id}</summary><p className="dg-muted">Verify this order for the league's patch. A = first-pick team, B = second-pick team; P = pick, B = ban. Each side needs five picks.</p>
          <label>Action sequence<textarea rows={3} value={formatText} onChange={e => setFormatText(e.target.value)} /></label><button type="button" onClick={() => setFormatText(DEFAULT_FORMAT.actions.join(' '))}>Restore league CM order</button></details>
        <button className="ui-button-primary" type="submit" disabled={busy || setup.teams.length < 2}>Confirm lineups & start draft</button>
      </form> : !busy && <p>No seasons available yet.</p>}</section>
      <section className="dg-panel"><h2>Saved drafts</h2><p className="dg-muted">Your 50 most recently updated drafts.</p><button disabled={busy} onClick={() => refreshList().catch(e => setError(e.message))}>Refresh saved drafts</button>
        {!drafts.length && <p className="dg-muted">Drafts autosave after you start. Alternatives keep their own boards.</p>}<div className="dg-saved-list">{drafts.map(d => <article key={d.id}><div><strong>{d.name}</strong><small>Updated {stamp(d.updatedAt)}</small></div>
          <button disabled={busy || inFlight.current} onClick={() => openDraft(d.id)}>Open</button><button disabled={busy || inFlight.current} onClick={async () => {
            if (!window.confirm(`Delete saved draft “${d.name}”?`)) return; try { await request(`/drafts/${d.id}`, { method: 'DELETE' }); if (doc?.id === d.id) { setDoc(null); setData(null); saved.current = null; } await refreshList(); } catch (e) { setError(e.message); }
          }}>Delete</button></article>)}</div></section>
    </div>}
    {doc && data && model && tab !== 'preparation' && <><section className="dg-context-bar"><strong>{data.teams[doc.state.config.ourTeam].name} vs {data.teams[doc.state.config.opponentTeam].name}</strong>
      <span>{data.season.name} · before {stamp(data.asOf)}</span><span>{data.coverage.matches} historical games</span><span className={data.coverage.public.status === 'fresh' ? '' : 'dg-warning'}>Public data: {data.coverage.public.status}</span>
      <details><summary>Data coverage & method</summary><p>{data.coverage.excludedUndated} undated games excluded. Dated history covers up to five years. Outcomes are discounted for recency and patch boundaries; familiarity is tracked separately. Public input covers the prior 30 days. Latest public match: {stamp(data.coverage.public.latestMatchAt)}.</p>
        <p>{MODEL_VERSION}. This is a heuristic assessment, not a win probability. Small samples are smoothed toward neutral. Historical matchups are associations. Roles and traits come from your private hero profiles.</p>
        <p>Change the cutoff in Preparation and start a new draft to use another snapshot.</p></details></section>
      {tab === 'overview' ? <DraftIntelligence data={data} config={doc.state.config} model={model} request={request} onRefresh={refreshContext} report={setError} busy={busy} /> : tab === 'scouting' ? <Scouting data={data} config={doc.state.config} report={setError} onProfileSaved={(id, profile) => setData(current => ({ ...current, heroProfiles: { ...current.heroProfiles, [id]: profile } }))} />
        : <div className="dg-live-grid"><div className="dg-live-main"><section className="dg-panel dg-board-panel"><div className="dg-board-heading"><h2>Live draft</h2><div className="dg-controls">
          <button disabled={!doc.state.undo?.length || busy} onClick={() => travel('undo')}>Undo</button><button disabled={!doc.state.redo?.length || busy} onClick={() => travel('redo')}>Redo</button>
          <button disabled={!doc.state.board.length || busy} onClick={() => { if (window.confirm('Clear this board? You can undo this change.')) changeBoard([]); }}>Clear board</button></div></div>
          <div className="dg-assessment"><strong>{model.score === null ? 'Assignment conflict' : `${model.score}/100`}</strong><span>Draft assessment · confidence {model.confidence}</span><small>Not a win probability</small><progress max={100} value={model.score ?? 50} aria-label="Draft assessment" /></div>
          <div className="dg-board-sides">{['our', 'opponent'].map(side => {
            const team = data.teams[side === 'our' ? doc.state.config.ourTeam : doc.state.config.opponentTeam], radiant = (side === 'our') === doc.state.config.radiant;
            return <section key={side} className={`dg-team-board ${radiant ? 'dg-radiant' : 'dg-dire'}`}><h3>{team.name}<small>{radiant ? 'Radiant' : 'Dire'} · {(side === 'our') === doc.state.config.firstPick ? 'First pick' : 'Second pick'}</small></h3>
              <div className="dg-picks">{model.sequence.filter(s => s.side === side && s.type === 'pick').map((step, index) => {
                const slot = doc.state.board[step.index], inferred = model.assigned[side].assignments.find(p => p.heroId === slot?.heroId);
                return <button type="button" key={step.index} disabled={!slot || busy} className={editing === step.index ? 'dg-selected' : ''}
                  onClick={() => { setEditing(step.index); setHeroId(String(slot.heroId)); setPlayerId(String(slot.playerId || '')); }} aria-label={slot ? `Edit pick ${names.get(slot.heroId)}` : 'Empty pick'}>
                  {slot ? <><HeroDisplay heroId={slot.heroId} heroName={names.get(slot.heroId)} iconSize={38} link={false} /><small>{slot.playerId ? data.players[slot.playerId]?.name : inferred ? `Flex · ${data.players[inferred.playerId]?.name}` : 'Flex'}</small></> : <span>Pick {index + 1}</span>}</button>;
              })}</div><div className="dg-bans"><span>Bans</span>{model.sequence.filter(s => s.side === side && s.type === 'ban').map(step => {
                const slot = doc.state.board[step.index]; return <button type="button" key={step.index} disabled={!slot || busy} onClick={() => { setEditing(step.index); setHeroId(String(slot.heroId)); setPlayerId(''); }} aria-label={slot ? `Edit ban ${names.get(slot.heroId)}` : 'Empty ban'}>
                  {slot ? <HeroDisplay heroId={slot.heroId} heroName={names.get(slot.heroId)} iconSize={25} showName={false} link={false} /> : '—'}</button>;
              })}</div></section>;
          })}</div>
          <div className="dg-timeline" aria-label="Draft action order">{model.sequence.map(step => <span key={step.index} className={step.index === (editing ?? doc.state.board.length) ? 'dg-current-step' : step.index < doc.state.board.length ? 'dg-complete-step' : ''} title={`${step.side === 'our' ? 'Your team' : 'Opponent'} ${step.type}`}>{step.side === 'our' ? 'Us' : 'Opp'} {step.type === 'pick' ? 'P' : 'B'}</span>)}</div>
        </section>
        <section className="dg-panel dg-action-panel"><h2>{action ? `${editing !== null ? 'Edit' : 'Next'}: ${action.side === 'our' ? 'your' : 'opponent'} ${action.type}` : 'Draft complete'}</h2>
          {editing !== null && <button onClick={() => { setEditing(null); setHeroId(''); setPlayerId(''); }}>Cancel edit</button>}
          {action && <><div className="dg-controls"><label htmlFor="dg-hero-search">Find hero</label><input id="dg-hero-search" placeholder="Search heroes…" value={search} onChange={e => setSearch(e.target.value)} />
            {action.type === 'pick' && <label>Assign player<select value={playerId} onChange={e => setPlayerId(e.target.value)}><option value="">Flex / unassigned</option>
              {doc.state.config.lineups[action.side].filter(p => !doc.state.board.some((entry, i) => i !== editing && model.sequence[i].side === action.side && model.sequence[i].type === 'pick' && entry.playerId === p.id))
                .map(p => <option key={p.id} value={p.id}>{data.players[p.id].name}{p.role ? ` · Pos ${p.role}` : ''}</option>)}</select></label>}
            <button className="ui-button-primary" disabled={!heroId || busy} onClick={() => applyHero(Number(heroId))}>{editing !== null ? 'Update action' : `Confirm ${action.type}`}</button></div>
            <div className="dg-hero-grid">{heroes.map(hero => <button type="button" key={hero.id} className={Number(heroId) === hero.id ? 'dg-selected' : ''} onClick={() => setHeroId(String(hero.id))}>
              <HeroDisplay heroId={hero.id} heroName={hero.name} link={false} iconSize={30} /></button>)}</div></>}
        </section></div>
        <aside className="dg-live-aside"><section className="dg-panel"><h2>Pool pressure</h2>{['our','opponent'].map(side=><div key={side}><h3>{side==='our'?'Your lineup':'Opponent'} ? {model.pressure[side].supported}/5 supported</h3><div className="dg-chips">{model.pressure[side].players.map(p=><span key={p.id}>{data.players[p.id]?.name}: {p.options} options</span>)}</div></div>)}<p className="dg-muted">Distinct-player coverage from observed pools, not a limit on playable heroes. Shared options cannot cover multiple players at once.</p>
          {action?.type==='ban'&&heroId&&(()=>{const target=action.side==='our'?'opponent':'our';const impact=banImpact(recommendationModel.pressure[target],Number(heroId));return <p className="dg-warning">Selected ban: {impact.players.length} players lose an observed option; supported coverage {impact.before} ? {impact.after}/5.</p>;})()}</section><section className="dg-panel"><h2>{action ? action.type === 'ban' ? 'Ban priorities' : 'Pick priorities' : 'Final assessment'}</h2><p className="dg-muted">Priority scores rank options; they are not probabilities. Flex suggestions reserve different players for each pick.</p>
          {(recommendationModel?.recommendations || []).filter(r => !doc.state.board.some((entry, i) => i !== editing && entry.heroId === r.heroId)).slice(0, 5).map(rec =>
            <article key={rec.heroId} className="dg-recommendation"><div><HeroDisplay heroId={rec.heroId} heroName={names.get(rec.heroId)} iconSize={30} /><strong>{rec.priority}/100</strong></div>
              <p>{data.players[rec.playerId]?.name}{rec.role ? ` · Pos ${rec.role}` : ''} · {rec.confidence} evidence</p><ul>{rec.reasons.slice(0, 3).map(reason => <li key={reason}>{reason}</li>)}</ul>
              <button disabled={busy || !action} onClick={() => { setHeroId(String(rec.heroId)); setPlayerId(''); setSearch(''); }}>Choose hero</button></article>)}
          {action && !recommendationModel?.recommendations.length && <p>No supported options for the current lineup and role constraints.</p>}{!action && <p>Review this draft or save an alternative to explore another line.</p>}
        </section><section className="dg-panel"><h2>Composition</h2>{['our', 'opponent'].map(side => <div key={side} className="dg-composition"><h3>{side === 'our' ? 'Your team' : 'Opponent'}</h3>
          <div className="dg-chips">{TRAITS.filter(tag => model.compositions[side].counts[tag]).map(tag => <span key={tag}>{tag} ×{model.compositions[side].counts[tag]}</span>)}</div><p className="dg-muted">
            {model.compositions[side].unknown ? `${model.compositions[side].unknown} picks have unclassified traits.` : model.compositions[side].total ? `Not represented: ${TRAITS.filter(t => !model.compositions[side].counts[t]).join(', ') || 'all tracked traits covered'}.` : 'No picks yet.'}</p></div>)}</section>
          <details className="dg-panel"><summary>Assessment evidence</summary>{model.contributions.map(row => <p key={row.label}>{row.label}: {row.delta >= 0 ? '+' : ''}{row.delta.toFixed(1)}</p>)}<p className="dg-muted">Unknown samples stay neutral. Map side does not add an automatic advantage.</p></details>
        </aside></div>}
    </>}
  </div>;
}
