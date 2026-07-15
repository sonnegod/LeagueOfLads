// src/components/Sidebar.jsx
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Sidebar.css';

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth();

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <nav className="sidebar-nav" id="primary-navigation" aria-label="Primary navigation">
        <Link to="/" onClick={onClose}>Home</Link>
        {user ? <Link to="/dashboard">Dashboard</Link> : <a href="/api/auth/steam" >Login</a>}

        <Link to="/recentMatches" onClick={onClose}>Recent Matches</Link>
        <Link to="/team" onClick={onClose}>Teams</Link>
        <Link to="/player" onClick={onClose}>Players</Link>
        {/*<Link to="/match">Matches</Link> removing for performance issues*/}
        <Link to="/league" onClick={onClose}>Leagues</Link>
        <Link to="/h2h" onClick={onClose}>Head to Head</Link>
        <Link to="/hero" onClick={onClose}>Heroes</Link>

        <Link to="/betting" onClick={onClose}>Betting</Link>

        {user && <Link to="/request">Request</Link>}
        {/* Show admin button only if user is admin */}
        {user?.canDraftGod && <Link to="/draftgod">DraftGod</Link>}
        {user?.isAdmin && <Link to="/admin">Admin Portal</Link>}

      </nav>
    </aside>
  );
}
