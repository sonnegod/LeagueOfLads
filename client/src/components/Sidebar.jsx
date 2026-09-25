// src/components/Sidebar.jsx
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Sidebar.css';

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navClassName = ({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`;

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <nav className="sidebar-nav" id="primary-navigation" aria-label="Primary navigation">
        <span className="sidebar-section-label">Explore</span>
        <NavLink to="/" end className={navClassName} onClick={onClose}>Home</NavLink>
        {user ? <NavLink to="/dashboard" className={navClassName} onClick={onClose}>Dashboard</NavLink> : <a className="sidebar-link" href="/api/auth/steam">Login</a>}

        <NavLink to="/recents" className={({ isActive }) => navClassName({ isActive: isActive || pathname === '/recentMatches' })} onClick={onClose}>Recents</NavLink>
        <NavLink to="/team" className={navClassName} onClick={onClose}>Teams</NavLink>
        <NavLink to="/player" className={navClassName} onClick={onClose}>Players</NavLink>
        {/*<Link to="/match">Matches</Link> removing for performance issues*/}
        <NavLink to="/league" className={navClassName} onClick={onClose}>Leagues</NavLink>
        <NavLink to="/h2h" className={navClassName} onClick={onClose}>Head to Head</NavLink>
        <NavLink to="/hero" className={navClassName} onClick={onClose}>Heroes</NavLink>

        {/*<Link to="/betting" onClick={onClose}>Betting</Link>*/}

        {user && <span className="sidebar-section-label sidebar-account-label">Account</span>}
        {user && <NavLink to="/request" className={navClassName} onClick={onClose}>Request</NavLink>}
        {/* Show admin button only if user is admin */}
        {user?.canDraftGod && <NavLink to="/draftgod" className={navClassName} onClick={onClose}>DraftGod</NavLink>}
        {user?.isAdmin && <NavLink to="/admin" className={navClassName} onClick={onClose}>Admin Portal</NavLink>}

      </nav>
    </aside>
  );
}
