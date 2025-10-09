// src/components/Sidebar.jsx
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Sidebar.css';

export default function Sidebar() {
  const { user } = useAuth();
  const ADMIN_ACCOUNT_ID = '49219700';

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        <Link to="/">Home</Link>
        {user && <Link to="/dashboard">Dashboard</Link>}

        <Link to="/team">Teams</Link>
        <Link to="/player">Players</Link>
        <Link to="/match">Matches</Link>
        <Link to="/league">Leagues</Link>
        <Link to="/hero">Heroes</Link>


        {/* Show admin button only if user is admin */}
        {user?.accountId === ADMIN_ACCOUNT_ID && (
          <Link to="/admin">Admin Portal</Link>
        )}

      </nav>
    </aside>
  );
}
