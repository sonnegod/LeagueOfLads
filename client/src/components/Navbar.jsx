import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import './Navbar.css';
import steamLogin from '../assets/steamLogin.png';
import logo from '../assets/League_of_lads_logo.png';
import UpcomingGamesTicker from './UpcomingGamesTicker';
import useLiveResource from '../hooks/useLiveResource';
import {useLiveMatches} from '../context/liveMatches';



export default function Navbar({ mobileNavOpen, onMenuToggle, upcomingGames = [] }) {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState("");
  const live=useLiveMatches();
  const {data:liveCount}=useLiveResource('/api/liveMatches/count',5000,!live.active);
  const liveMatchCount=live.active?(live.data?.matches?.length??(Number(liveCount?.count)||0)):(Number(liveCount?.count)||0);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const dropdownRef = useRef(null);
  const navigate = useNavigate();


  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  function handleLogout() {
    setLoggingOut(true);
    setLogoutError('');
    logout().then(() => {
    setDropdownOpen(false);
    navigate('/');
  }).catch(error => setLogoutError(error.message)).finally(() => setLoggingOut(false));
}

  const handleSearch = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    setQuery("");
  };

  return (
    <nav className="navbar">
      <div className="navbar-content">
        <div className="navbar-left">
          <button
            type="button"
            className="navbar-menu-button"
            aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileNavOpen}
            aria-controls="primary-navigation"
            onClick={onMenuToggle}
          >
            <span aria-hidden="true">{mobileNavOpen ? '\u00d7' : '\u2630'}</span>
          </button>
          <img src={logo} alt="League of Lads Logo" className="navbar-logo" />
          <div className="navbar-title"><Link to="/">League Of Lads</Link></div>
        </div>
        
        <div className="navbar-search">
          <form onSubmit={handleSearch}>
            <input
              type="text"
              className="search-input"
              placeholder="Search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
        </div>

        <UpcomingGamesTicker games={upcomingGames} />

        <div className="navbar-right" ref={dropdownRef}>
          <NavLink to="/live" className={({ isActive }) => `live-match-button${isActive ? ' is-active' : ''}`}>
            <span className="live-match-label">Live Matches</span>
            {liveMatchCount > 0 && <span className="live-match-badge">{liveMatchCount}</span>}
          </NavLink>

          {!user ? (
            <a href="/api/auth/steam" className="steam-login-button">
              <img src={steamLogin} alt="Steam Login" className="steam-icon" />
            </a>
          ) : (
            <>
              <button type="button" className="user-info" aria-expanded={dropdownOpen}
                aria-haspopup="true" onClick={() => setDropdownOpen(!dropdownOpen)}>
                <img src={user.avatar} alt="avatar" className="avatar" />
                <span className="user-name">{user.personaname}</span>
                <span className={`dropdown-arrow ${dropdownOpen ? 'up' : ''}`}>&#9662;</span>
              </button>
              {dropdownOpen && (
                <div className="dropdown-menu">
                  <button type="button" onClick={() => { setDropdownOpen(false); navigate('/dashboard'); }}>Dashboard</button>
                  <button type="button" disabled={loggingOut} onClick={handleLogout}>{loggingOut ? 'Signing out…' : 'Logout'}</button>
                  {logoutError && <p role="alert" className="navbar-logout-error">{logoutError}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
