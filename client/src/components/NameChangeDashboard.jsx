// NameChangeDashboard.jsx
import React, { useState } from 'react';
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
    <div className="p-4 max-w-sm bg-gray-50 dark:bg-gray-800 rounded shadow space-y-2">
      <input
        type="text"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="Enter new name"
        className="border rounded px-2 py-1 w-full text-black dark:text-white dark:bg-gray-700"
      />
      <button
        onClick={handleConfirm}
        className="bg-blue-600 text-white px-3 py-1 rounded w-full hover:bg-blue-700"
      >
        Confirm Name
      </button>
      <div className="text-gray-700 dark:text-gray-300 text-sm">
        You can only change your name once every 30 days.
      </div>
      {status && <div className="text-sm text-gray-700 dark:text-gray-300">{status}</div>}
    </div>
  );
}
