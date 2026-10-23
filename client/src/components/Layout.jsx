import { useEffect, useState } from 'react';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Layout.css';
import SiteAnalyticsTracker from './SiteAnalyticsTracker';
import PlayerNameConfirmation from './PlayerNameConfirmation';
import useUpcomingGames from '../hooks/useUpcomingGames';

export default function Layout() {
  const { user, loading } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const upcomingGames = useUpcomingGames();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavOpen]);

  if (loading) return <div>Loading...</div>;

  return (
    <div className={`app-shell${upcomingGames.length ? ' has-upcoming-games' : ''}`}>
      <SiteAnalyticsTracker />
      {user&&<PlayerNameConfirmation key={user.accountId} />}
      <Navbar
        upcomingGames={upcomingGames}
        mobileNavOpen={mobileNavOpen}
        onMenuToggle={() => setMobileNavOpen((open) => !open)}
      />
      <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      {mobileNavOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <div className="app-body">
        <main className="content">
          <Outlet />
          <footer style={footerStyle}>
            <Link to="/privacy-policy" style={footerLinkStyle}>Privacy Policy</Link>
          </footer>
        </main>
      </div>
    </div>
  );
}

const footerStyle = {
  padding: '1rem',
  textAlign: 'center',
  fontSize: '0.82rem',
  color: 'var(--muted-text, #9aa0b4)',
};

const footerLinkStyle = {
  color: 'inherit',
  textDecoration: 'underline',
};
