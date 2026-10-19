import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import LeaguePage from './LeaguePage';
import HeroDisplay from '../components/HeroDisplay';
import LeagueContentDashboard from '../components/LeagueContentDashboard';
import DashboardDialog from '../components/DashboardDialog';
import { useAuth } from '../context/AuthContext';
import './Home.css';

function Record({ label, value }) {
  if (!value) return null;
  return <div className="home-champion-stat"><strong>{value.wins}-{value.losses}</strong><span>{label}</span></div>;
}

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPreview = searchParams.get('previewLeague');
  const previewLeague = user?.isSiteManager && /^\d+$/.test(requestedPreview || '')
    && Number.isSafeInteger(Number(requestedPreview)) && Number(requestedPreview) > 0 ? requestedPreview : null;
  const [home, setHome] = useState(null);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('content');
  const [showChampionDetails, setShowChampionDetails] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/seasonHome');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load homepage');
        if (active) { setHome(data); setError(''); }
      } catch (err) { if (active) setError(err.message); }
    }
    load();
    const interval = window.setInterval(load, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  if (!home && !error) return <div className="ui-page">Loading homepage...</div>;
  if (error && !home) return <div className="ui-page" role="alert">{error}</div>;
  const leagueId = home.activeLeagueId || home.champion?.leagueId;
  const showChampion = !home.activeLeagueId && home.champion;
  function selectSection(section, focus = false) {
    setActiveSection(section);
    if (focus) document.getElementById(`home-${section}-tab`)?.focus();
  }
  function navigateTabs(event) {
    const sections = ['content', 'league'];
    let section;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') section = sections[(sections.indexOf(activeSection) + 1) % 2];
    else if (event.key === 'Home') section = sections[0];
    else if (event.key === 'End') section = sections[1];
    else return;
    event.preventDefault(); selectSection(section, true);
  }

  return <div className={`ui-page home-page${activeSection === 'content' ? ' home-page-content' : ''}${showChampion ? ' home-page-champion' : ''}`}>
    <div className="home-toolbar">
    <header className="home-page-heading">
      {activeSection === 'league' && <p className="home-eyebrow">Around the league</p>}
      <h1>League of Lads</h1>
      <p>Game results, player highlights, and recaps from around the league.</p>
    </header>
    <div className="ui-tabs home-primary-tabs" role="tablist" aria-label="Homepage sections" onKeyDown={navigateTabs}>
      {[['content', 'Content'], ['league', 'League Info']].map(([section, label]) =>
        <button key={section} id={`home-${section}-tab`} type="button" role="tab" className="ui-tab"
          aria-selected={activeSection === section} aria-controls={`home-${section}-panel`}
          tabIndex={activeSection === section ? 0 : -1} onClick={() => selectSection(section)}>{label}</button>)}
    </div>
    </div>
    <section id="home-content-panel" role="tabpanel" aria-labelledby="home-content-tab"
      hidden={activeSection !== 'content'}>
    <div className="home-content-sections">
    {previewLeague && <div className="home-highlight-preview" role="status">
      <div><strong>Historical league preview</strong><p>Viewing results and highlights from league {previewLeague}.</p></div>
      <button type="button" onClick={() => {
        const next = new URLSearchParams(searchParams); next.delete('previewLeague'); setSearchParams(next);
      }}>Exit preview</button>
    </div>}
    <div className="home-announcements">
    {home.signup && <section className="home-signup-hero home-signup-ribbon">
      <div className="home-signup-copy"><p className="home-eyebrow">Signups are open</p>
      <h2>{home.signup.title}</h2>
      <p className="home-signup-description">{home.signup.description}</p>
      {user ? <Link to={`/signup/${home.signup.seasonId}`} className="home-signup-button">
        Sign up your team
      </Link> : <a href={`/api/auth/steam?returnTo=${encodeURIComponent(`/signup/${home.signup.seasonId}`)}`}
        className="home-signup-button" aria-disabled={authLoading}>
        {authLoading ? 'Checking Steam login...' : 'Sign in with Steam to sign up'}
      </a>}
      </div>
      <div className="home-signup-count">
        <strong>{home.signup.teamCount ?? 0}</strong>
        <span>{home.signup.teamCount === 1 ? 'Team signed up' : 'Teams signed up'}</span>
      </div>
    </section>}
    {showChampion && <section className="home-champion-ribbon">
      <div><p className="home-eyebrow">League champions</p>
        <h2><Link to={`/team/${home.champion.teamId}`}>{home.champion.teamName}</Link></h2>
        <p>{home.champion.leagueName}{home.champion.playoffGames && ` · ${home.champion.playoffGames.wins}–${home.champion.playoffGames.losses} playoff games`}</p></div>
      <button type="button" onClick={() => setShowChampionDetails(true)}>Meet the champions</button>
    </section>}
    </div>
    <LeagueContentDashboard key={previewLeague || 'published'} previewLeague={previewLeague} emptyState={<>
      <p>{previewLeague ? 'No highlights are available in this preview yet. Build the league preview, then refresh this page.'
        : 'Highlights and recaps will appear here as league games are played.'}</p>
      {!previewLeague && <button type="button" onClick={() => selectSection('league', true)}>Explore League Info</button>}
    </>} />
    {showChampion && showChampionDetails && <DashboardDialog title="League champions" onClose={() => setShowChampionDetails(false)}>
    <section className="home-champion-hero">
      <p className="home-eyebrow">League champions</p>
      <h2 className="home-champion-title"><Link to={`/team/${home.champion.teamId}`}>{home.champion.teamName}</Link></h2>
      <p>Champions of <Link to={`/league/${home.champion.leagueId}`}>{home.champion.leagueName}</Link></p>
      <div className="home-champion-stats">
        <Record label="Group stage games" value={home.champion.groupGames} />
        <Record label="Playoff series" value={home.champion.playoffSeries} />
        <Record label="Playoff games" value={home.champion.playoffGames} />
      </div>
      {home.champion.players?.length > 0 && <div className="home-champion-rollcall">
        <div className="home-champion-rollcall-heading">
          <p className="home-eyebrow">The winning cast</p>
          <h3>Players behind the title</h3>
          <p>Players who appeared in more than half of the team&apos;s league matches.</p>
        </div>
        <div className="home-champion-players">
          {home.champion.players.map(player => <article className="home-champion-player" key={player.playerId}>
            <div className="home-champion-player-heading">
              <span className="home-champion-player-mark" aria-hidden="true">
                {player.playerName?.trim().charAt(0).toUpperCase() || '★'}
              </span>
              <div>
                <h3><Link to={`/player/${player.playerId}`}>{player.playerName}</Link></h3>
                <p>{player.wins} wins in {player.games} games
                  {player.playoffWins > 0 && ``}</p>
              </div>
            </div>
            {player.spotlight && <div className="home-champion-player-moment">
              <span>{player.spotlight.label}{player.spotlight.stage && ` · ${player.spotlight.stage}`}</span>
              <strong>{Number(player.spotlight.value).toLocaleString()}</strong>
              <p>{player.spotlight.unit}{player.spotlight.opponentName && ` against ${player.spotlight.opponentName}`}</p>
              {player.spotlight.matchId && <Link to={`/match/${player.spotlight.matchId}`}>View match →</Link>}
            </div>}
            {player.signatureHero && <div className="home-champion-player-hero">
              <span>Most played hero</span>
              <HeroDisplay heroId={player.signatureHero.heroId} heroName={player.signatureHero.heroName} />
              <small>{player.signatureHero.games} {player.signatureHero.games === 1 ? 'game' : 'games'}</small>
            </div>}
          </article>)}
        </div>
      </div>}
    </section></DashboardDialog>}
    {!home.activeLeagueId && !home.signup && !home.champion && <section className="home-offseason-empty">
      <h2>Next league coming soon</h2>
      <p>Check back for the next signup announcement.</p>
    </section>}
    </div>
    </section>
    <section id="home-league-panel" role="tabpanel" aria-labelledby="home-league-tab"
      hidden={activeSection !== 'league'}>
      {activeSection === 'league' && (leagueId ? <LeaguePage key={leagueId} leagueIdOverride={leagueId}
        stageTabsFirst defaultToCurrentStage alwaysShowGroups showRecentSeries={false} />
        : <div className="home-offseason-empty">
          <h2>{home.signup ? 'The next league is taking shape' : 'No active league yet'}</h2>
          <p>{home.signup ? 'League details will appear here once the season is ready.'
            : 'Explore previous seasons while we wait for the next league.'}</p>
          <Link to="/league">Browse leagues</Link>
        </div>)}
    </section>
  </div>;
}
