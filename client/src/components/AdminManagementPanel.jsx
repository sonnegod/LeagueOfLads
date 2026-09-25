import { useCallback, useEffect, useState } from 'react';

export default function AdminManagementPanel({ isHeadAdmin, currentPlayerId }) {
  const [admins, setAdmins] = useState([]);
  const [players, setPlayers] = useState([]);
  const [playerId, setPlayerId] = useState('');
  const [newRole, setNewRole] = useState('0');
  const [roleChoices, setRoleChoices] = useState({});
  const [savingRole, setSavingRole] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [selfDemoted, setSelfDemoted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const canManage = isHeadAdmin && !selfDemoted;
  const headCount = admins.filter((admin) => admin.HeadAdmin).length;

  const loadAdmins = useCallback(async (signal) => {
    const response = await fetch('/api/admin/admins', { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load admins');
    setAdmins(data.admins);
    setRoleChoices(Object.fromEntries(data.admins.map((admin) => [admin.AdminPlayerId, String(admin.HeadAdmin)])));
  }, []);

  const loadPlayers = useCallback(async (signal) => {
    const response = await fetch('/api/admin/adminCandidates', { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load players');
    setPlayers(data.players);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadAdmins(controller.signal),
      ...(isHeadAdmin ? [loadPlayers(controller.signal)] : []),
    ])
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isHeadAdmin, loadAdmins, loadPlayers]);

  async function addAdmin(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPlayerId: playerId.trim(),
          headAdmin: newRole === '1',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to add admin');
      setPlayerId('');
      setNewRole('0');
      setMessage(`${data.admin.AdminPlayerName} can now access the admin portal.`);
      await Promise.all([loadAdmins(), loadPlayers()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveRole(admin) {
    setSavingRole(admin.AdminPlayerId);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/admin/admins/${admin.AdminPlayerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headAdmin: roleChoices[admin.AdminPlayerId] === '1' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to change admin role');
      await loadAdmins();
      if (String(admin.AdminPlayerId) === String(currentPlayerId) && !data.admin.HeadAdmin) {
        setSelfDemoted(true);
      }
      setMessage(`${data.admin.AdminPlayerName} is now ${data.admin.HeadAdmin ? 'a head admin' : 'an admin'}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRole(null);
    }
  }

  async function removeAdmin(admin) {
    if (!window.confirm(`Remove ${admin.AdminPlayerName} (${admin.AdminPlayerId}) from the admins?`)) return;
    setRemovingId(admin.AdminPlayerId);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/admin/admins/${admin.AdminPlayerId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to remove admin');
      await Promise.all([loadAdmins(), loadPlayers()]);
      setMessage(`${data.removed.AdminPlayerName} no longer has admin access.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section style={panelStyle} aria-labelledby="admin-management-heading">
      <h2 id="admin-management-heading" style={{ marginTop: 0 }}>Admin Management</h2>
      {error && <p role="alert" style={errorStyle}>{error}</p>}
      {message && <p role="status" style={successStyle}>{message}</p>}

      {canManage && (
        <form onSubmit={addAdmin} style={formStyle}>
          <label style={fieldStyle} htmlFor="new-admin-id">
            Player ID (Steam account ID)
            <select id="new-admin-id" required value={playerId}
              onChange={(event) => setPlayerId(event.target.value)} style={inputStyle}>
              <option value="">Select a player ID</option>
              {[...players].sort((a, b) => a.PlayerId - b.PlayerId).map((player) => (
                <option key={player.PlayerId} value={player.PlayerId}>
                  {player.PlayerId} — {player.PlayerName}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle} htmlFor="new-admin-name">
            Display name
            <select id="new-admin-name" required value={playerId}
              onChange={(event) => setPlayerId(event.target.value)} style={inputStyle}>
              <option value="">Select a display name</option>
              {players.map((player) => (
                <option key={player.PlayerId} value={player.PlayerId}>
                  {player.PlayerName} ({player.PlayerId})
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle} htmlFor="new-admin-role">
            Role
            <select id="new-admin-role" value={newRole} onChange={(event) => setNewRole(event.target.value)}
              style={inputStyle}>
              <option value="0">Admin</option>
              <option value="1">Head Admin</option>
            </select>
          </label>
          <button type="submit" disabled={saving || !playerId}>{saving ? 'Adding...' : 'Add Admin'}</button>
        </form>
      )}
      {canManage && !loading && players.length === 0 && <p>No eligible players found in PlayerInfo.</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr><th style={cellStyle}>Display name</th><th style={cellStyle}>Player ID</th><th style={cellStyle}>Role</th>{canManage && <th style={cellStyle}>Action</th>}</tr>
          </thead>
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.AdminPlayerId}>
                <td style={cellStyle}>{admin.AdminPlayerName}</td>
                <td style={cellStyle}>{admin.AdminPlayerId}</td>
                <td style={cellStyle}>
                  {canManage ? (
                    <select aria-label={`Role for ${admin.AdminPlayerName}`} style={inputStyle}
                      value={roleChoices[admin.AdminPlayerId] ?? String(admin.HeadAdmin)}
                      onChange={(event) => setRoleChoices((current) => ({
                        ...current, [admin.AdminPlayerId]: event.target.value,
                      }))}>
                      <option value="0" disabled={admin.HeadAdmin && headCount === 1}>Admin</option>
                      <option value="1">Head Admin</option>
                    </select>
                  ) : (admin.HeadAdmin ? 'Head Admin' : 'Admin')}
                </td>
                {canManage && (
                  <td style={cellStyle}>
                    <button type="button" onClick={() => saveRole(admin)}
                      disabled={savingRole !== null || removingId !== null || (roleChoices[admin.AdminPlayerId] ?? String(admin.HeadAdmin)) === String(admin.HeadAdmin)}>
                      {savingRole === admin.AdminPlayerId ? 'Saving...' : 'Save role'}
                    </button>
                    {!admin.HeadAdmin && (
                      <button type="button" style={removeButtonStyle} onClick={() => removeAdmin(admin)}
                        disabled={savingRole !== null || removingId !== null}>
                        {removingId === admin.AdminPlayerId ? 'Removing...' : 'Remove'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p>Loading admins...</p>}
        {!loading && admins.length === 0 && !error && <p>No admins found.</p>}
      </div>
    </section>
  );
}

const panelStyle = {
  border: '1px solid var(--border, #222428)',
  borderRadius: '8px',
  background: 'var(--surface, #0b0b0b)',
  padding: '20px',
};

const formStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'end',
  gap: '12px',
  marginBottom: '24px',
};

const fieldStyle = { display: 'grid', gap: '6px', minWidth: '220px', flex: '1 1 220px' };
const inputStyle = {
  padding: '10px',
  border: '1px solid var(--border, #222428)',
  borderRadius: '6px',
  background: 'var(--button-bg, #1a1a1a)',
  color: 'var(--text, #e6e6e6)',
};
const tableStyle = { width: '100%', borderCollapse: 'collapse', textAlign: 'left' };
const cellStyle = { padding: '10px', borderBottom: '1px solid var(--border, #222428)' };
const removeButtonStyle = { marginLeft: '8px', color: '#e57373' };
const errorStyle = { color: '#e57373' };
const successStyle = { color: '#8bd49c' };
