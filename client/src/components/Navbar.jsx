import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import './Navbar.css';
import steamLogin from '../assets/steamLogin.png';
import logo from '../assets/League_of_lads_logo.png';
import { Link } from 'react-router-dom';


export default function Navbar() {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState("");

  const [dropdownOpen, setDropdownOpen] = useState(false);
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
    logout().then(() => {
    setDropdownOpen(false);
    navigate('/');
  });
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
          <img src={logo} alt="League of Lads Logo" className="navbar-logo" />
          <div className="navbar-title"><Link to="/" style={{ color: 'white', textDecoration: 'none' }}>League Of Lads</Link></div>
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

        <div className="navbar-right" ref={dropdownRef}>
          {!user ? (
            <a href="/api/auth/steam" className="steam-login-button">
              <img src={steamLogin} alt="Steam Login" className="steam-icon" />
            </a>
          ) : (
            <div className="user-info" onClick={() => setDropdownOpen(!dropdownOpen)}>
              <img src={user.avatar} alt="avatar" className="avatar" />
              <span>{user.personaname}</span>
              <span className={`dropdown-arrow ${dropdownOpen ? 'up' : ''}`}>&#9662;</span>
              {dropdownOpen && (
                <div className="dropdown-menu">
                  <button onClick={() => navigate('/dashboard')}>Dashboard</button>
                  <button onClick={handleLogout}>Logout</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
