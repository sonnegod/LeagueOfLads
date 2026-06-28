import { useEffect, useState } from 'react';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Layout.css';

export default function Layout() {
  const { loading } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

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
    <div className="app-shell">
      <Navbar
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
