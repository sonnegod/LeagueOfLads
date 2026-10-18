import { useEffect, useState } from 'react';
import HighlightsAdminPanel from './HighlightsAdminPanel';

function date(value) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

export default function AnalyticsStatusPanel({ refreshKey }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [leagues, setLeagues] = useState([]);
  const [previewLeague, setPreviewLeague] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/analytics/leagues', { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Could not load league list')))
      .then(data => { if (!controller.signal.aborted) setLeagues(data.leagues); })
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [refreshKey]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/analytics/status${previewLeague ? `?previewLeague=${previewLeague}` : ''}`,
      { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load Analytics status');
        return data;
      }).then(data => { if (!controller.signal.aborted) { setStatus(data); setError(''); } })
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [refreshKey, refresh, previewLeague]);

  return <section className="ui-card" aria-label="Analytics status">
    <div className="season-actions"><h3>Analytics</h3>
      <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh status</button></div>
    <p className="admin-help">Analytics summarizes imported league matches for statistics and homepage highlights. Refresh status only reloads the information shown here.</p>
    <label>Dataset{' '}<select value={previewLeague} onChange={event => {
      setStatus(null); setError(''); setPreviewLeague(event.target.value);
    }}>
      <option value="">Signup-era dataset</option>
      {leagues.map(league => <option key={league.leagueId} value={league.leagueId}>
        Preview: {league.leagueName} ({league.matches} matches)
      </option>)}
    </select></label>
    {previewLeague ? <p className="admin-help">Historical preview for testing, separate from live betting. Roster membership is unclassified. Live refreshes do not rebuild this preview.</p>
      : <p className="admin-help">To rebuild these summaries after a data correction, use League → Betting → Refresh Analytics and Betting. New match data must first arrive through the scheduled import jobs.</p>}
    {error && <p role="alert">{error}</p>}
    {!status ? <p>Loading Analytics status...</p> : !status.available ? <p>
      {previewLeague ? 'This league preview has not been built yet.' : 'Analytics has not been initialized.'}
    </p> : <>
      {status.running && <p role="status">An Analytics build is running.</p>}
      {!status.published ? <p>No completed Analytics build yet.</p> : <>
        <p>Last completed build: <strong>{date(status.published.finishedAt)}</strong></p>
        <p>{status.published.matches.toLocaleString()} matches · {status.published.playerGames.toLocaleString()} player appearances
          {' · '}{status.published.issues.toLocaleString()} data quality flags</p>
        {status.warehouse && <p className="admin-help">
          Expanded match data: {status.warehouse.enrichedMatches.toLocaleString()} / {status.warehouse.matches.toLocaleString()} matches
          {' · '}EDW UTC start times: {status.warehouse.edwUtcMatches.toLocaleString()}
          {' · '}Known patches: {status.warehouse.patchedMatches.toLocaleString()}.
          {' '}Individual statistics may have fewer samples where source data is missing.
        </p>}
        <ul>{status.sources.map(source => <li key={source.name}>
          {source.name.replaceAll('_', ' ')}: {source.stale ? 'stale or not tracked' : 'current'}
          {' · '}Last successful refresh: {date(source.lastSuccessAt)}
          {source.status !== 'complete' && ` · ${source.status}`}
        </li>)}</ul>
        <p className="admin-help">Source freshness measures the last successful import. A stale source needs its import job checked; rebuilding summaries does not make that source current.</p>
        {status.issues.length > 0 && <details><summary>Data quality flags</summary>
          <ul>{status.issues.map(issue => <li key={issue.code}>{issue.code.replaceAll('_', ' ')}: {issue.count}</li>)}</ul>
        </details>}
      </>}
      {['failed', 'interrupted'].includes(status.latest?.status) &&
        <p role="alert">The latest build {status.latest.status === 'failed' ? 'failed' : 'was interrupted'}.
          {status.published ? ' The previous completed dataset remains available.' : ''}</p>}
    </>}
    <HighlightsAdminPanel key={previewLeague || 'signup'} previewLeague={previewLeague} refreshKey={`${refreshKey}:${refresh}`} />
  </section>;
}
