import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LeaguePage from './LeaguePage';
import HeroDisplay from '../components/HeroDisplay';
import HomeAnalytics from '../components/HomeAnalytics';
import { useAuth } from '../context/AuthContext';
import './Home.css';

function Record({ label, value }) {
  if (!value) return null;
  return <div className="home-champion-stat"><strong>{value.wins}-{value.losses}</strong><span>{label}</span></div>;
}

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const [home, setHome] = useState(null);
  const [error, setError] = useState('');
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

  if (!home && !error) return <div className="ui-page">Loading current league...</div>;
  if (error && !home) return <div className="ui-page" role="alert">{error}</div>;
  if (home.activeLeagueId) return <>
    <LeaguePage leagueIdOverride={home.activeLeagueId}
      stageTabsFirst defaultToCurrentStage alwaysShowGroups showRecentSeries={false} />
    <HomeAnalytics leagueId={home.activeLeagueId} />
  </>;

  return <main className={`ui-page home-offseason${home.champion ? ' home-offseason-champion' : ''}`}>
    {home.signup && <section className="home-signup-hero">
      <p className="home-eyebrow">Signups are open</p>
      <h1>{home.signup.title}</h1>
      <p>{home.signup.description}</p>
      {user ? <Link to={`/signup/${home.signup.seasonId}`} className="home-signup-button">
        Sign up your team
      </Link> : <a href={`/api/auth/steam?returnTo=${encodeURIComponent(`/signup/${home.signup.seasonId}`)}`}
        className="home-signup-button" aria-disabled={authLoading}>
        {authLoading ? 'Checking Steam login...' : 'Sign in with Steam to sign up'}
      </a>}
      {!user && !authLoading && <p className="home-signup-login-note">
        You’ll return to this league’s signup form after signing in with Steam.
      </p>}
    </section>}
    {home.champion && <section className="home-champion-hero">
      <p className="home-eyebrow">League champions</p>
      <h1><Link to={`/team/${home.champion.teamId}`}>{home.champion.teamName}</Link></h1>
      <p>Champions of <Link to={`/league/${home.champion.leagueId}`}>{home.champion.leagueName}</Link></p>
      <div className="home-champion-stats">
        <Record label="Group stage games" value={home.champion.groupGames} />
        <Record label="Playoff series" value={home.champion.playoffSeries} />
        <Record label="Playoff games" value={home.champion.playoffGames} />
      </div>
      {home.champion.players?.length > 0 && <div className="home-champion-rollcall">
        <div className="home-champion-rollcall-heading">
          <p className="home-eyebrow">The winning cast</p>
          <h2>Players behind the title</h2>
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
    </section>}
    {!home.signup && !home.champion && <section className="home-offseason-empty">
      <h1>Next league coming soon</h1>
      <p>Check back for the next signup announcement.</p>
    </section>}
    <HomeAnalytics />
  </main>;
}
