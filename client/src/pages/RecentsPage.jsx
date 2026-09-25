import { NavLink, useLocation } from 'react-router-dom';
import CurrentLeagueSeries from '../components/CurrentLeagueSeries';
import RecentMatchTable from '../components/RecentMatchTable';
import './RecentsPage.css';

export default function RecentsPage() {
  const showingMatches = useLocation().pathname === '/recentMatches';

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
        {showingMatches ? <RecentMatchTable /> : <CurrentLeagueSeries />}
      </section>
    </div>
  );
}
