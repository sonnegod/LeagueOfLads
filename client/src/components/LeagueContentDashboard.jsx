import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LeagueHighlightsFeed from './LeagueHighlightsFeed';
import DashboardDialog from './DashboardDialog';
import RecentSeriesPanel from './RecentSeriesPanel';
import './LeagueHighlightsFeed.css';
import './LeagueActivityBoard.css';

const stageNames = { regular: 'Groups', tiebreaker: 'Tiebreakers', playoff: 'Playoffs', unknown: 'Unclassified' };
const playedDate = value => value ? new Date(value).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}) : 'Date unavailable';
const duration = seconds => {
  if (seconds == null) return '—';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
};

export default function LeagueContentDashboard({ leagueId, previewLeague, emptyState }) {
  const [period, setPeriod] = useState(previewLeague ? 'historical' : 'overnight');
  const [data, setData] = useState(null);
  const [results, setResults] = useState([]);
  const [before, setBefore] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [feedRefresh, setFeedRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [formPage, setFormPage] = useState(0);
  const [space, setSpace] = useState(500);
  const dashboard = useRef(null);
  useLayoutEffect(() => {
    const measure = () => setSpace(Math.max(220, window.innerHeight - dashboard.current.getBoundingClientRect().top - 60));
    const observer = new ResizeObserver(measure);
    observer.observe(dashboard.current);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ period, limit: '10' });
    if (leagueId) params.set('leagueId', leagueId);
    if (previewLeague) params.set('previewLeague', previewLeague);
    if (before) params.set('before', before);
    const endpoint = previewLeague ? '/api/admin/analytics/dashboard/preview' : '/api/analytics/dashboard';
    fetch(`${endpoint}?${params}`, { signal: controller.signal, cache: previewLeague ? 'no-store' : 'default' })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load game results');
        return payload;
      }).then(payload => {
        if (controller.signal.aborted) return;
        setData(payload); setResults(old => before ? [...old, ...payload.results].slice(0, 50) : payload.results);
      }).catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [leagueId, previewLeague, period, before, refresh]);

  function changePeriod(value) {
    setPeriod(value); setBefore(null); setData(null); setResults([]);
  }
  const formsPerPage = 1;
  const forms = data?.seasonWatch?.forms || [];
  const formPages = Math.max(1, Math.ceil(forms.length / formsPerPage));
  const currentFormPage = Math.min(formPage, formPages - 1);
  const watch = <section className="season-watch" aria-label="Season watch">
    <div className="highlight-heading"><h3>Season watch</h3><span className="season-stage-label">{
      data?.seasonWatch?.phase === 'ended' ? 'Season complete' : stageNames[data?.seasonWatch?.phase] || 'Season in progress'}</span></div>
    {forms.length > 0 ? <ul>{forms.slice(currentFormPage * formsPerPage, (currentFormPage + 1) * formsPerPage).map(team => <li key={team.teamId}>
      <div className="season-team-heading"><span className="season-run-label">{data.seasonWatch.phase === 'ended' ? 'Strong finish' : 'On a tear'}</span>
        <strong><Link to={`/team/${team.teamId}`}>{team.teamName}</Link></strong></div>
      <div className="season-team-records">
        <span><b>{team.seasonRecord?.wins}–{team.seasonRecord?.losses}</b> season</span>
        <span><b>{team.stageRecord?.wins}–{team.stageRecord?.losses}</b> {team.groupName || stageNames[data.seasonWatch.stage]}</span>
      </div>
      <div className="season-recent-form"><span>Last {team.games} games</span>
        <div className="season-form-strip" aria-label={`Recent form, oldest to newest: ${team.form.join(', ')}`}>
          {team.form.map((result, index) => <span key={index} className={result === 'W' ? 'dashboard-result-win' : 'dashboard-result-loss'}>{result}</span>)}
        </div>
      </div>
      {team.latestSeries && <p className="season-series-score">
        <Link to={`/series/${team.latestSeries.seriesId}`}><b>{team.latestSeries.wins}–{team.latestSeries.losses}</b> vs {team.latestSeries.opponentName}</Link>
        <small>{team.latestSeries.verifiedComplete ? 'Latest completed series' : 'Latest recorded series score'}</small>
      </p>}
    </li>)}</ul> : <p className="dashboard-caption">{loading ? 'Loading team form…' : 'No standout team runs yet.'}</p>}
    {formPages > 1 && <div className="dashboard-pagination" aria-label="Team form pages">
      <button type="button" disabled={currentFormPage === 0} onClick={() => setFormPage(currentFormPage - 1)}>Previous</button>
      <span>{currentFormPage + 1} / {formPages}</span>
      <button type="button" disabled={currentFormPage === formPages - 1} onClick={() => setFormPage(currentFormPage + 1)}>Next</button>
    </div>}
  </section>;
  return <section ref={dashboard} className={`league-content-dashboard${space < 500 ? ' dashboard-compact' : ''}`} aria-label="League activity dashboard">
    <div className="dashboard-heading">
      <div><h2>{period === 'overnight' ? 'Catch up on last night'
        : period === 'week' ? 'The week in review' : 'Stories from the season'}</h2>
        <p className="dashboard-caption">{data?.leagueName || 'Around the league'}{data?.available
          && ` · ${data.summary.games} games · ${data.summary.teams} teams`}</p></div>
      <div className="dashboard-window-controls" role="group" aria-label="Activity period">
        {previewLeague && <button type="button" aria-pressed={period === 'historical'} onClick={() => changePeriod('historical')}>Historical season</button>}
        <button type="button" title="Games and highlights from the last 24 hours" aria-pressed={period === 'overnight'} onClick={() => changePeriod('overnight')}>Overnight</button>
        <button type="button" title="Games and highlights from the last 7 days" aria-pressed={period === 'week'} onClick={() => changePeriod('week')}>Last week</button>
        <button type="button" disabled={loading} onClick={() => {
          setBefore(null); setRefresh(value => value + 1); setFeedRefresh(value => value + 1);
        }}>Refresh</button>
        <button type="button" onClick={() => setShowResults(true)}>All game results</button>
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    <LeagueHighlightsFeed key={`${period}:${feedRefresh}`} leagueId={leagueId} previewLeague={previewLeague}
      period={period} showEmpty emptyState={emptyState} seasonWatch={watch}
      resultsPanel={<RecentSeriesPanel key={period} series={data?.series} loading={loading} error={error}
        pageSize={Math.max(1, Math.min(6, Math.floor((space - 345) / 80)))} onShowAll={() => setShowResults(true)} />}
      playerPageSize={Math.max(1, Math.min(6, Math.floor((space - 345) / 90)))} storyPageSize={1} />
    {showResults && <DashboardDialog title="Game results" onClose={() => setShowResults(false)}>
    <section className="dashboard-results" aria-label="Game results">
      <div className="highlight-heading"><h2>Game results</h2>
        <span className="dashboard-caption">{data?.summary.games > 0 ? `${results.length} of ${data.summary.games} games` : 'New York time'}</span></div>
      {data?.summary.undatedGames > 0 && <p className="dashboard-caption">{period === 'historical'
        ? `${data.summary.undatedGames} historical games have unverified dates.`
        : 'Games with unverified dates are excluded from this time window.'}</p>}
      {results.length > 0 && <div className="dashboard-table-scroll" role="region" aria-label="Game results table" tabIndex={0}>
        <table className="dashboard-table game-results-table">
          <thead><tr><th scope="col">Winner</th><th scope="col">Loser</th><th scope="col">Stage</th>
            <th scope="col">Duration</th><th scope="col">Played (NY)</th><th scope="col">Game</th></tr></thead>
          <tbody>{results.map(game => <tr key={game.matchId}>
            <td><div className="dashboard-team-result"><span className="dashboard-result-win" aria-hidden="true">W</span>
              <Link to={`/team/${game.winner.teamId}`}>{game.winner.teamName}</Link></div></td>
            <td><div className="dashboard-team-result"><span className="dashboard-result-loss" aria-hidden="true">L</span>
              <Link to={`/team/${game.loser.teamId}`}>{game.loser.teamName}</Link></div></td>
            <td>{stageNames[game.stage]}</td><td className="dashboard-duration">{duration(game.durationSeconds)}</td>
            <td>{playedDate(game.playedAt)}</td><td><Link to={`/match/${game.matchId}`}>View match</Link></td>
          </tr>)}</tbody>
        </table>
      </div>}
      {!results.length && loading && <p role="status">Loading game results…</p>}
      {!results.length && !loading && !error && <div className="dashboard-results-empty">
        <p>{!data?.available ? 'League results are not available yet.' : period === 'historical'
          ? 'No historical results are available in this dataset.' : `No completed games in the ${period === 'overnight' ? 'last 24 hours' : 'last 7 days'}.`}</p>
        {period === 'overnight' && <button type="button" onClick={() => changePeriod('week')}>Show last week</button>}
      </div>}
      {error && <p role="alert">{error}</p>}
      {error && <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Retry results</button>}
      {data?.nextBefore && results.length < 50 && <button type="button" disabled={loading}
        onClick={() => { setBefore(data.nextBefore); setRefresh(value => value + 1); }}>{loading ? 'Loading…' : 'More results'}</button>}
    </section>
    </DashboardDialog>}
  </section>;
}
