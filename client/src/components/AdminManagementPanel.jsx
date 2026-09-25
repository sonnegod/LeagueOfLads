import { useCallback, useEffect, useRef, useState } from 'react';

export default function AdminManagementPanel({ isHeadAdmin, currentPlayerId }) {
  const [admins, setAdmins] = useState([]);
  const [players, setPlayers] = useState([]);
  const [playerId, setPlayerId] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activePlayerIndex, setActivePlayerIndex] = useState(0);
  const [newRole, setNewRole] = useState('0');
  const [manualPlayerId, setManualPlayerId] = useState('');
  const [manualPlayerName, setManualPlayerName] = useState('');
  const [manualRole, setManualRole] = useState('0');
  const [roleChoices, setRoleChoices] = useState({});
  const [savingRole, setSavingRole] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [selfDemoted, setSelfDemoted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pickerButtonRef = useRef(null);
  const searchInputRef = useRef(null);
  const activeOptionRef = useRef(null);
  const canManage = isHeadAdmin && !selfDemoted;
  const headCount = admins.filter((admin) => admin.HeadAdmin).length;
  const search = playerSearch.trim().toLowerCase();
  const filteredPlayers = search
    ? players.filter((player) => String(player.PlayerId).includes(search) ||
      String(player.PlayerName).toLowerCase().includes(search))
    : players;
  const selectedPlayer = players.find((player) => String(player.PlayerId) === playerId);

  function choosePlayer(player) {
    setPlayerId(String(player.PlayerId));
    setPlayerSearch('');
    setPickerOpen(false);
    pickerButtonRef.current?.focus();
  }

  useEffect(() => {
    if (pickerOpen) searchInputRef.current?.focus();
  }, [pickerOpen]);

  useEffect(() => {
    if (pickerOpen) activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [pickerOpen, activePlayerIndex, playerSearch]);

  function handlePickerKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filteredPlayers.length) {
        setActivePlayerIndex((index) => Math.min(index + 1, filteredPlayers.length - 1));
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActivePlayerIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (filteredPlayers[activePlayerIndex]) choosePlayer(filteredPlayers[activePlayerIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setPickerOpen(false);
      pickerButtonRef.current?.focus();
    }
  }

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
      setPlayerSearch('');
      setPickerOpen(false);
      setNewRole('0');
      setMessage(`${data.admin.AdminPlayerName} can now access the admin portal.`);
      await Promise.all([loadAdmins(), loadPlayers()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addManualAdmin(event) {
    event.preventDefault();
    setSavingManual(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/admins/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPlayerId: manualPlayerId.trim(),
          adminPlayerName: manualPlayerName.trim(),
          headAdmin: manualRole === '1',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to add admin');
      setManualPlayerId('');
      setManualPlayerName('');
      setManualRole('0');
      setMessage(`${data.admin.AdminPlayerName} can now access the admin portal.`);
      await loadAdmins();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingManual(false);
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
        <>
        <h3 style={formHeadingStyle}>Add from Player Base</h3>
        <form onSubmit={addAdmin} style={formStyle}>
          <div style={fieldStyle} onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setPickerOpen(false);
          }}>
            <label htmlFor="admin-player-picker">Player</label>
            <div style={pickerStyle}>
              <button id="admin-player-picker" ref={pickerButtonRef} type="button"
                aria-haspopup="listbox" aria-expanded={pickerOpen}
                aria-controls={pickerOpen ? 'admin-player-options' : undefined}
                onClick={() => {
                  setPickerOpen((open) => !open);
                  setPlayerSearch('');
                  setActivePlayerIndex(0);
                }} style={pickerButtonStyle}>
                {selectedPlayer
                  ? `${selectedPlayer.PlayerName} (${selectedPlayer.PlayerId})`
                  : 'Select a player by name or ID'}
                <span aria-hidden="true">▾</span>
              </button>
              {pickerOpen && (
                <div style={pickerMenuStyle}>
                  <input ref={searchInputRef} type="search" value={playerSearch}
                    role="combobox" aria-label="Search players by name or ID"
                    aria-expanded="true" aria-controls="admin-player-options"
                    aria-activedescendant={filteredPlayers[activePlayerIndex]
                      ? `admin-player-option-${filteredPlayers[activePlayerIndex].PlayerId}` : undefined}
                    onChange={(event) => {
                      setPlayerSearch(event.target.value);
                      setActivePlayerIndex(0);
                    }}
                    onKeyDown={handlePickerKeyDown}
                    placeholder="Search by name or ID" style={inputStyle} />
                  <div id="admin-player-options" role="listbox" aria-label="Players" style={pickerOptionsStyle}>
                    {filteredPlayers.map((player, index) => (
                      <button key={player.PlayerId} id={`admin-player-option-${player.PlayerId}`}
                        ref={index === activePlayerIndex ? activeOptionRef : null}
                        type="button" role="option" tabIndex={-1}
                        aria-selected={playerId === String(player.PlayerId)}
                        onMouseEnter={() => setActivePlayerIndex(index)}
                        onClick={() => choosePlayer(player)}
                        style={{ ...pickerOptionStyle, ...(index === activePlayerIndex ? pickerOptionActiveStyle : {}) }}>
                        {player.PlayerName} ({player.PlayerId})
                      </button>
                    ))}
                    {filteredPlayers.length === 0 && <div style={pickerEmptyStyle}>No players match that search.</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
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
        <h3 style={formHeadingStyle}>Add an account manually</h3>
        <p style={hintStyle}>Use this when the account is not in PlayerInfo.</p>
        <form onSubmit={addManualAdmin} style={formStyle}>
          <label style={fieldStyle} htmlFor="manual-admin-id">
            Steam account ID
            <input id="manual-admin-id" type="text" inputMode="numeric" pattern="[0-9]+"
              required value={manualPlayerId} onChange={(event) => setManualPlayerId(event.target.value)}
              style={inputStyle} />
          </label>
          <label style={fieldStyle} htmlFor="manual-admin-name">
            Account name
            <input id="manual-admin-name" type="text" maxLength={60} required value={manualPlayerName}
              onChange={(event) => setManualPlayerName(event.target.value)} style={inputStyle} />
          </label>
          <label style={fieldStyle} htmlFor="manual-admin-role">
            Role
            <select id="manual-admin-role" value={manualRole}
              onChange={(event) => setManualRole(event.target.value)} style={inputStyle}>
              <option value="0">Admin</option>
              <option value="1">Head Admin</option>
            </select>
          </label>
          <button type="submit" disabled={savingManual || !manualPlayerId.trim() || !manualPlayerName.trim()}>
            {savingManual ? 'Adding...' : 'Add Manual Admin'}
          </button>
        </form>
        </>
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

const formHeadingStyle = { marginBottom: 0 };
const hintStyle = { marginTop: '4px', color: 'var(--muted-text, #9aa0b4)' };

const fieldStyle = { display: 'grid', gap: '6px', minWidth: '220px', flex: '1 1 220px' };
const inputStyle = {
  padding: '10px',
  border: '1px solid var(--border, #222428)',
  borderRadius: '6px',
  background: 'var(--button-bg, #1a1a1a)',
  color: 'var(--text, #e6e6e6)',
};
const pickerStyle = { position: 'relative' };
const pickerButtonStyle = {
  ...inputStyle,
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  textAlign: 'left',
  cursor: 'pointer',
};
const pickerMenuStyle = {
  position: 'absolute',
  zIndex: 20,
  top: 'calc(100% + 4px)',
  left: 0,
  width: '100%',
  minWidth: '280px',
  padding: '8px',
  boxSizing: 'border-box',
  border: '1px solid var(--border, #222428)',
  borderRadius: '6px',
  background: 'var(--surface, #0b0b0b)',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
};
const pickerOptionsStyle = { maxHeight: '240px', overflowY: 'auto', marginTop: '8px' };
const pickerOptionStyle = {
  display: 'block',
  width: '100%',
  padding: '8px',
  border: 0,
  background: 'transparent',
  color: 'var(--text, #e6e6e6)',
  textAlign: 'left',
  cursor: 'pointer',
};
const pickerOptionActiveStyle = { background: 'var(--primary, #646cff)', color: 'white' };
const pickerEmptyStyle = { padding: '8px', color: 'var(--muted-text, #9aa0b4)' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', textAlign: 'left' };
const cellStyle = { padding: '10px', borderBottom: '1px solid var(--border, #222428)' };
const removeButtonStyle = { marginLeft: '8px', color: '#e57373' };
const errorStyle = { color: '#e57373' };
const successStyle = { color: '#8bd49c' };
