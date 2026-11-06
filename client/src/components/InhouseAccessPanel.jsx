import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {inhouseRequest} from '../hooks/useInhouses';
import {useInhouseAccess} from '../hooks/useInhouseAccess';
import './InhouseAccessPanel.css';

function PlayerList({kind, list, version, busy, change}) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const managers = kind === 'managers', members = list === 'members';
  const title = managers ? members ? 'Community managers' : 'Add a community manager' : members ? 'Vouched players' : 'Not vouched';
  const path = managers ? '/admin/inhouses/community-managers' : '/inhouses/management/vouches';
  useEffect(() => {
    const timer = setTimeout(() => {setQuery(search.trim()); setPage(0);}, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({list, search: query, page: String(page)});
    inhouseRequest(`${path}?${params}`, {signal: controller.signal}).then(next => {
      if (!controller.signal.aborted) {setData(next); setError('');}
    }).catch(e => {if (!controller.signal.aborted) {setData(null); setError(e.message);}})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [path, list, query, page, version]);
  const manualId = !members && /^\d+$/.test(query) && Number(query) > 0 && Number(query) <= 4294967294
    && data && !data.users.some(user => user.playerId === Number(query)) ? Number(query) : null;
  const lastPage = Math.max(0, Math.ceil((data?.total || 0) / 20) - 1), current = data?.page ?? page;
  return <section className="inhouse-card inhouse-access-list" aria-label={title}>
    <header className="inhouse-card-heading"><h3>{title}</h3>{data && <span className="inhouse-muted">{data.total}</span>}</header>
    <label className="inhouse-access-search">Search by name or account ID
      <input type="search" maxLength="100" value={search} placeholder="Name or Dota account ID"
        aria-label={`Search ${title.toLowerCase()}`} onChange={event => setSearch(event.target.value)} /></label>
    {error && <p className="inhouse-notice is-error" role="alert">{error}</p>}
    {loading && <p className="inhouse-muted" role="status">Updating players…</p>}
    <ul aria-busy={loading}>{data?.users.map(user => {
      const inherited = managers ? user.administrator : user.automaticAccess;
      return <li key={user.playerId}><div className="inhouse-access-person">
        <Link to={`/player/${user.playerId}`}>{user.name}</Link><small>Account ID {user.playerId}</small>
        {user.administrator ? <span className="inhouse-access-role">Admin · automatic access</span>
          : user.communityManager && <span className="inhouse-access-role">Community manager · automatic access</span>}
      </div>{members && inherited ? <span className="inhouse-access-inherited">Inherited</span>
        : <button type="button" disabled={busy || loading}
          aria-label={`${members ? 'Remove' : managers ? 'Make community manager:' : 'Vouch for'} ${user.name} (${user.playerId})`}
          onClick={() => change(path, user.playerId, !members, user.name)}>{members ? 'Remove' : managers ? 'Add manager' : 'Vouch'}</button>}</li>;
    })}</ul>
    {!loading && data && !data.users.length && <p className="inhouse-muted">No matching players.</p>}
    {!loading && manualId && <button type="button" disabled={busy}
      onClick={() => change(path, manualId, true, `Account ${manualId}`)}>
      {managers ? 'Add manager' : 'Vouch for'} account {manualId}</button>}
    {data && data.total > data.pageSize && <div className="inhouse-access-pagination">
      <button type="button" disabled={loading || busy || !current} onClick={() => setPage(current - 1)}>Previous</button>
      <span>{current + 1} / {lastPage + 1}</span>
      <button type="button" disabled={loading || busy || current >= lastPage} onClick={() => setPage(current + 1)}>Next</button>
    </div>}
  </section>;
}

export default function InhouseAccessPanel({kind = 'vouches'}) {
  const {state, error, connected, refresh} = useInhouseAccess();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [mutationError, setMutationError] = useState('');
  const [localVersion, setLocalVersion] = useState(0);
  async function change(path, id, enabled, name) {
    setBusy(true); setMessage(''); setMutationError('');
    try {
      await inhouseRequest(`${path}/${id}`, {method: enabled ? 'PUT' : 'DELETE', body: '{}'});
      setMessage(`${name}: ${kind === 'managers' ? enabled ? 'community manager added.' : 'community manager removed.' : enabled ? 'vouched.' : 'vouch removed.'}`);
      setLocalVersion(value => value + 1);
      await refresh();
      window.dispatchEvent(new Event('inhouses:changed'));
    } catch (e) {setMutationError(e.message); if ([401,403].includes(e.status)) await refresh();}
    finally {setBusy(false);}
  }
  if (!state) return <p role={error ? 'alert' : 'status'}>{error || 'Loading inhouse access…'}</p>;
  if (!state.permissions.canManage || kind === 'managers' && !state.permissions.administrator)
    return <p className="inhouse-notice is-error" role="alert">{error || 'You no longer have permission to manage this list.'}</p>;
  const version = `${state.version}:${localVersion}`;
  return <div className="inhouse-access-panel">
    <header className="inhouse-card-heading"><h2>{kind === 'managers' ? 'Community managers' : 'Inhouse vouching'}</h2>
      <span className="inhouse-muted">{connected ? 'Live updates' : 'Checking for updates'}</span></header>
    <p className="inhouse-muted">{kind === 'managers'
      ? 'Community managers can vouch for players and remove vouches. All admins inherit this role automatically.'
      : 'Only vouched players, community managers, and admins can queue. Removing a vouch releases a waiting place; reserved games can finish.'}</p>
    {message && <p role="status">{message}</p>}
    {(error || mutationError) && <p className="inhouse-notice is-error" role="alert">{mutationError || error}</p>}
    <div className="inhouse-access-columns">{['members', 'candidates'].map(list =>
      <PlayerList key={`${kind}:${list}`} kind={kind} list={list} version={version} busy={busy} change={change} />)}</div>
  </div>;
}
