import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import InhouseQueueBadge from './InhouseQueueBadge';
import './Sidebar.css';

const matchesPath = (pathname, target) => pathname === target || pathname.startsWith(`${target}/`);
const browseLinks = [
  {to: '/league', label: 'Leagues'},
  {to: '/team', label: 'Teams'},
  {to: '/player', label: 'Players'},
  {to: '/hero', label: 'Heroes'},
];

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [expanded, setExpanded] = useState(null);
  const groups = [
    {id: 'browse', label: 'Browse', links: browseLinks},
    {id: 'records', label: 'Stats & Records', links: [
      {to: '/h2h', label: 'Head to Head'},
      {to: '/awards', label: 'Awards'},
    ]},
    ...(user?.isAdmin || user?.isSiteManager ? [{id: 'administration', label: 'Administration', links: [
      ...(user.isAdmin ? [{to: '/admin', label: 'Admin Portal'}] : []),
      ...(user.isSiteManager ? [{to: '/site-management', label: 'Site Management'}] : []),
    ]}] : []),
  ];
  const currentGroup = groups.find(group => group.links.some(link => matchesPath(pathname, link.to)));
  // A deep link reveals its section immediately. Toggling another section is
  // temporary; navigating to a new page reveals that page's section again.
  const expandedId = expanded?.pathname === pathname ? expanded.id : currentGroup?.id;
  const navClassName = ({isActive}) => `sidebar-link${isActive ? ' is-active' : ''}`;

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <nav className="sidebar-nav" id="primary-navigation" aria-label="Primary navigation">
        <NavLink to="/" end className={navClassName} onClick={onClose}>Home</NavLink>
        {user && <NavLink to="/dashboard" className={navClassName} onClick={onClose}>Dashboard</NavLink>}

        <NavLink to="/recents" className={({isActive}) => navClassName({isActive: isActive || ['/recentMatches', '/match', '/series'].some(path => matchesPath(pathname, path))})} onClick={onClose}>Recents</NavLink>
        <NavLink to="/betting" className={({isActive}) => navClassName({isActive: isActive || matchesPath(pathname, '/bet/matchup')})} onClick={onClose}>Betting</NavLink>
        {user?.isAdmin && <div className="sidebar-inhouses"><NavLink to="/inhouses" className={navClassName} onClick={onClose}>Inhouses</NavLink>
          <InhouseQueueBadge /></div>}
        {user?.canDraftGod && String(user.accountId) === '49219700' && <NavLink to="/draftgod" className={navClassName} onClick={onClose}>DraftGod</NavLink>}
        <div className="sidebar-groups">
          {groups.map(group => <section className="sidebar-group" key={group.id} aria-label={`${group.label} navigation`}>
            <button type="button" className={`sidebar-group-toggle${currentGroup?.id === group.id ? ' has-active-page' : ''}`}
              aria-expanded={expandedId === group.id} aria-controls={`sidebar-group-${group.id}`}
              onClick={() => setExpanded({pathname, id: expandedId === group.id ? null : group.id})}>
              <span>{group.label}</span><ChevronDown size={15} aria-hidden="true" />
            </button>
            <div id={`sidebar-group-${group.id}`} className="sidebar-group-links" hidden={expandedId !== group.id}>
              {group.links.map(link => <NavLink key={link.to} to={link.to} className={navClassName} onClick={onClose}>{link.label}</NavLink>)}
            </div>
          </section>)}
        </div>
        <div className="sidebar-footer-links">
          <NavLink to="/rules" className={navClassName} onClick={onClose}>Rules</NavLink>
          {user && <NavLink to="/request" className={navClassName} onClick={onClose}>Request</NavLink>}
        </div>
      </nav>
    </aside>
  );
}
