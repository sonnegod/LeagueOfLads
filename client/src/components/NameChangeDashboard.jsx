// NameChangeDashboard.jsx
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function NameChangeDashboard() {
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState('');
  const { user, loading } = useAuth();
  const handleConfirm = async () => {
    if (!newName.trim()) return;

    const confirmed = window.confirm(
      `You can only change your name once every 30 days.\n\nChange name to "${newName}"?`
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/nameChange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          newName: newName,
          userId: user.accountId
        })
      });

      if (res.ok) {
        setStatus('✅ Name updated successfully!');
        setNewName('');
      } else {
        setStatus('❌ Error changing name');
      }
    } catch {
      setStatus('❌ Network error');
    }
  };

  return (
    <div className="p-4 max-w-sm rounded shadow space-y-2" style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
      <input
        type="text"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="Enter new name"
        style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }}
      />
      <button
        onClick={handleConfirm}
        style={{ background: 'var(--primary)', border: 'none', padding: '8px 12px', borderRadius: 6, color: '#fff', width: '100%' }}
      >
        Confirm Name
      </button>
      <div style={{ color: 'var(--muted-text)', fontSize: '0.9rem' }}>
        You can only change your name once every 30 days.
      </div>
      {status && <div style={{ fontSize: '0.9rem', color: 'var(--muted-text)' }}>{status}</div>}
    </div>
  );
}
