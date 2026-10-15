import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import CurrentLeagueSeries from '../components/CurrentLeagueSeries';
import RecentMatchTable from '../components/RecentMatchTable';
import LeagueFilter from '../components/LeagueFilter';
import { useLeagues } from '../context/LeagueContext';
import './RecentsPage.css';

export default function RecentsPage() {
  const showingMatches = useLocation().pathname === '/recentMatches';
  const { leagues, loading: leaguesLoading } = useLeagues();
  const [selectedLeague, setSelectedLeague] = useState('');
  const defaultLeague = leagues.find(league => Number(league.Active) === 1) || leagues[0];
  const leagueId = selectedLeague || String(defaultLeague?.LeagueId || '');

  return (
    <div className="recents-page ui-page">
      <h1>Recents</h1>
      <nav className="ui-tabs recents-tabs" aria-label="Recent results">
        <NavLink
          to="/recents"
          className="ui-tab"
        >
          Recent Series
        </NavLink>
        <NavLink
          to="/recentMatches"
          className="ui-tab"
        >
          Recent Matches
        </NavLink>
      </nav>
      <section className="recents-panel" aria-label={showingMatches ? 'Recent Matches' : 'Recent Series'}>
        {showingMatches ? <RecentMatchTable /> : leaguesLoading ? <div>Loading leagues...</div> : (
          leagueId ? <>
            <div className="recents-league-filter">
              <label htmlFor="recent-series-league">League</label>
              <LeagueFilter id="recent-series-league" value={leagueId} onChange={setSelectedLeague}
                leagues={leagues} includeAll={false} />
            </div>
            <CurrentLeagueSeries leagueId={leagueId} />
          </> : <div>No leagues available.</div>
        )}
      </section>
    </div>
  );
}
