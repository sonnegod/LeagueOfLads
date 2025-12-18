import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NameChangeModal from './NameChangeDropdown';

export default function UserDropdown({ user }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const logout = async () => {
    await fetch('/auth/logout');
    window.location.reload();
  };

  return (
    <div className="relative inline-block text-left">
      <button onClick={() => setOpen(!open)} className="flex items-center space-x-2">
        <img src={user.avatar} alt="avatar" className="w-8 h-8 rounded-full" />
        <span>{user.displayName}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-40 shadow-lg rounded" style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
          <button onClick={() => navigate('/dashboard')} className="block w-full px-4 py-2" style={{ background: 'transparent', color: 'inherit' }}>Dashboard</button>

          <NameChangeModal />

          <button onClick={logout} className="block w-full px-4 py-2" style={{ background: 'transparent', color: 'inherit' }}>Logout</button>
        </div>
      )}
    </div>
  );
}
