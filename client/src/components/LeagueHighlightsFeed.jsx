import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardDialog from './DashboardDialog';
import HeroDisplay from './HeroDisplay';
import './LeagueHighlightsFeed.css';

export function HighlightCard({ story, children }) {
  return <article className={`highlight-card highlight-card-${story.category}`}>
    <div className="highlight-card-meta">
      <span>{story.category === 'recap' ? `${story.period === 'weekly' ? 'Weekly' : 'Daily'} recap` : story.category}</span>
      <Link to={`/league/${story.leagueId}`}>{story.leagueName}</Link>
      {(story.occurredAt || story.publishedAt) && <time dateTime={story.occurredAt || story.publishedAt}>
        {story.occurredAt ? 'Played ' : 'Published '}{new Date(story.occurredAt || story.publishedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
      </time>}
      {story.revision > 2 && <span>Updated</span>}
    </div>
    <h3>{story.title}</h3>
    <p>{story.body}</p>
    {story.heroId && <HeroDisplay heroId={story.heroId} heroName={story.heroName} />}
    {story.details?.length > 0 && <dl className="highlight-evidence">{story.details.map(detail => <div key={detail.label}>
      <dt>{detail.label}</dt><dd>{detail.value}</dd>
    </div>)}</dl>}
    <div className="highlight-card-links">
      {story.playerId && <Link to={`/player/${story.playerId}`}>Player profile</Link>}
      {story.teamId && <Link to={`/team/${story.teamId}`}>Team profile</Link>}
      {story.seriesId && <Link to={`/series/${story.seriesId}`}>See the series</Link>}
      {story.matchIds.map(id => <Link key={id} to={`/match/${id}`}>Match {id}</Link>)}
      {story.supportingMatchCount > story.matchIds.length && <span>{story.supportingMatchCount} supporting games</span>}
    </div>
    {children}
  </article>;
}

function Pages({ page, count, onChange, label }) {
  if (count <= 1) return null;
  return <div className="dashboard-pagination" aria-label={label}>
    <button type="button" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</button>
    <span>{page + 1} / {count}</span>
    <button type="button" disabled={page === count - 1} onClick={() => onChange(page + 1)}>Next</button>
  </div>;
}

export default function LeagueHighlightsFeed({ leagueId, previewLeague, period = 'all', showEmpty = false, emptyState,
  seasonWatch, resultsPanel, playerPageSize = 5, storyPageSize = 2 }) {
  const [stories, setStories] = useState([]);
  const [next, setNext] = useState(null);
  const [before, setBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [playerPage, setPlayerPage] = useState(0);
  const [storyPage, setStoryPage] = useState(0);
  const [selectedStory, setSelectedStory] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ limit: '20', period });
    if (leagueId) params.set('leagueId', leagueId);
    if (previewLeague) params.set('previewLeague', previewLeague);
    if (before) params.set('before', before);
    const endpoint = previewLeague ? '/api/site-management/league-analytics/highlights/preview' : '/api/analytics/highlights';
    fetch(`${endpoint}?${params}`, { signal: controller.signal, cache: previewLeague ? 'no-store' : 'default' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load highlights');
        return data;
      }).then(data => {
        if (controller.signal.aborted) return;
        setStories(old => before ? [...old, ...data.highlights].slice(0, 50) : data.highlights);
        setNext(data.nextBefore);
      }).catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [leagueId, previewLeague, period, before, refresh]);

  if (!stories.length && !showEmpty) return null;
  const playerStories = stories.filter(story => story.playerId);
  const leagueStories = stories.filter(story => !story.playerId);
  const overview = Boolean(seasonWatch);
  const playerPages = Math.max(1, Math.ceil(playerStories.length / playerPageSize));
  const storyPages = Math.max(1, Math.ceil(leagueStories.length / storyPageSize));
  const currentPlayerPage = Math.min(playerPage, playerPages - 1);
  const currentStoryPage = Math.min(storyPage, storyPages - 1);
  const importance = { champion: 10, reverse_sweep: 9, comeback: 8, teamfight: 7, hot_run: 6, streak: 5, recap: 4 };
  const featured = [...(leagueStories.length ? leagueStories : playerStories)].sort((a, b) =>
    (importance[b.category] || 1) - (importance[a.category] || 1)
      || String(b.occurredAt || b.publishedAt).localeCompare(String(a.occurredAt || a.publishedAt)));
  const featuredIndex = Math.min(storyPage, Math.max(0, featured.length - 1));
  const lead = featured[featuredIndex];
  return <section className={`league-highlights${seasonWatch ? ' league-highlights-overview' : ''}${resultsPanel ? ' activity-board' : ''}`} aria-label="Player highlights and recaps">
    {resultsPanel && <div className="activity-topline">
      <section className="activity-feature" aria-label="Featured headline">
        <div className="highlight-heading"><span className="highlight-eyebrow">{lead ? lead.category === 'recap'
          ? `${lead.period === 'weekly' ? 'Weekly' : 'Daily'} recap` : lead.category.replaceAll('_', ' ') : 'Around the league'}</span>
          {lead && <span className="dashboard-caption">{lead.occurredAt ? new Date(lead.occurredAt).toLocaleDateString('en-US', {
            timeZone: 'America/New_York', month: 'short', day: 'numeric' }) : 'Season story'}</span>}</div>
        {lead ? <><h3><button type="button" className="dashboard-story-link" onClick={() => setSelectedStory(lead)}>{lead.title}</button></h3>
          <p>{lead.body}</p><div className="activity-feature-footer">
            <button type="button" className="dashboard-story-link" onClick={() => setSelectedStory(lead)}>Read story &amp; details →</button>
            <Pages page={featuredIndex} count={featured.length} onChange={setStoryPage} label="Featured headlines" />
          </div></> : <p className="dashboard-caption">{loading ? 'Loading headlines…' : 'Highlights will appear after league games are played.'}</p>}
      </section>
      {seasonWatch}
    </div>}
    {!resultsPanel && (leagueStories.length > 0 || overview) && <div className={overview ? 'dashboard-story-column' : undefined}>
    {seasonWatch}
    {(leagueStories.length > 0 || overview) && <section className="league-story-feed" aria-label="Stories around the league">
      <div className="highlight-heading"><h2>What’s happening</h2></div>
      {(overview ? leagueStories.slice(currentStoryPage * storyPageSize, (currentStoryPage + 1) * storyPageSize) : leagueStories).map(story => <article key={story.id} className={`league-story league-story-${story.category}`}>
        <div className="league-story-label">{story.category === 'reverse_sweep' ? 'Playoff comeback' : story.category === 'hot_run'
          ? 'On a tear' : story.category === 'stage_opening' ? 'A new chapter' : story.category === 'recap'
          ? `${story.period === 'weekly' ? 'Weekly' : 'Daily'} catch-up` : story.category.replaceAll('_', ' ')}</div>
        <h3>{overview ? <button type="button" className="dashboard-story-link" onClick={() => setSelectedStory(story)}>{story.title}</button> : story.title}</h3>
        {overview ? <p className="league-story-excerpt">{story.body}</p> : story.category === 'recap'
          ? <details><summary>Read the recap</summary><p>{story.body}</p></details> : <p>{story.body}</p>}
        {!overview && <div className="highlight-card-links">
          {story.seriesId && <Link to={`/series/${story.seriesId}`}>See the series</Link>}
          {story.teamId && <Link to={`/team/${story.teamId}`}>{story.teamName}</Link>}
          <Link to={`/league/${story.leagueId}`}>{story.leagueName}</Link>
          {story.matchIds.length === 1 && <Link to={`/match/${story.matchIds[0]}`}>See the game</Link>}
        </div>}
      </article>)}
      {!leagueStories.length && <p className="dashboard-caption">{loading ? 'Loading league stories…' : 'No league stories published for this period yet.'}</p>}
      {overview && <Pages page={currentStoryPage} count={storyPages} onChange={setStoryPage} label="League story pages" />}
    </section>}
    </div>}
    {resultsPanel}
    <section className={overview ? 'dashboard-player-panel' : 'league-player-feed'} aria-label="Player moments">
    <div className="highlight-heading"><h2>Player moments</h2>{overview && <span className="dashboard-caption">{playerStories.length} highlights</span>}</div>
    {playerStories.length > 0 && <div className="dashboard-table-scroll" role="region" aria-label="Player highlights table" tabIndex={0}>
      <table className="dashboard-table player-highlight-table">
        <thead><tr><th scope="col">When</th><th scope="col">Player</th><th scope="col">What happened</th>
          <th scope="col">Match</th></tr></thead>
        <tbody>{(overview ? playerStories.slice(currentPlayerPage * playerPageSize, (currentPlayerPage + 1) * playerPageSize) : playerStories).map(story => <tr key={story.id}>
          <td className="player-moment-time">{story.occurredAt ? new Date(story.occurredAt).toLocaleString('en-US', {
            timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          }) : 'Historical'}</td>
          <td><div className="moment-player-identity">{story.heroId && <HeroDisplay heroId={story.heroId} iconSize={30} showName={false} />}
            <Link to={`/player/${story.playerId}`}>{story.playerName}</Link></div>
            {story.teamId && <small className="dashboard-roster-label"><Link to={`/team/${story.teamId}`}>{story.teamName}</Link></small>}
            {story.membership === 'stand_in' && <small className="dashboard-roster-label">Stand-in</small>}
            {story.membership === 'unknown' && <small className="dashboard-roster-label">Roster unknown</small>}</td>
          <td className="player-highlight-description"><span className={`player-moment-kind player-moment-${story.category}`}>{story.stat?.label || story.category}</span>
            {overview ? <button type="button" className="dashboard-story-link" onClick={() => setSelectedStory(story)}>{story.notification}</button>
              : <><strong>{story.notification}</strong><details><summary>Details</summary><p>{story.body}</p></details></>}</td>
          <td>{story.matchIds.length === 1 ? <Link to={`/match/${story.matchIds[0]}`}>{overview ? 'View match' : story.matchIds[0]}</Link>
            : <Link to={`/league/${story.leagueId}`}>{story.supportingMatchCount} games</Link>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {overview && <Pages page={currentPlayerPage} count={playerPages} onChange={setPlayerPage} label="Player highlight pages" />}
    {!playerStories.length && !loading && !error && stories.length > 0 && <p className="dashboard-caption">No player highlights published for this period yet.</p>}
    {!stories.length && loading && <p role="status">Loading league highlights…</p>}
    {!stories.length && !loading && !error && <div className="highlight-empty-state">
      {emptyState || <p>No highlights published yet.</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
    {error && <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Retry highlights</button>}
    {next && stories.length < 50 && <button type="button" disabled={loading}
      onClick={() => { setBefore(next); setRefresh(value => value + 1); }}>{loading ? 'Loading…' : overview ? 'Load older highlights' : 'More highlights'}</button>}
    </section>
    {selectedStory && <DashboardDialog title={selectedStory.playerId ? `${selectedStory.playerName} — Player moment` : selectedStory.title}
      onClose={() => setSelectedStory(null)}>
      <HighlightCard story={selectedStory} />
    </DashboardDialog>}
  </section>;
}
