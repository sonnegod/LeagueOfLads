import { useEffect, useRef, useState } from 'react';
import AsyncSelect from 'react-select/async';
import DotabuffLink from './DotabuffLink';
import { prepareScreenshot, readScreenshot } from '../utils/screenshotUpload';
import './AddRosterTeamCard.css';

const emptyPlayer = () => ({ option: null, playerId: '', playerName: '', mmr: '', adjusted: false, screenshot: null, uploading: false, uploadError: '' });
const pickerStyles = {
  control: base => ({ ...base, background: 'var(--surface, #111827)', minWidth: 0 }),
  menu: base => ({ ...base, background: 'var(--surface, #111827)', zIndex: 20 }),
  singleValue: base => ({ ...base, color: 'var(--text, white)' }),
  input: base => ({ ...base, color: 'var(--text, white)' }),
  option: (base, state) => ({ ...base, background: state.isFocused ? '#334155' : 'transparent', color: 'var(--text, white)' }),
};

export default function AddRosterTeamCard({ season, onChanged }) {
  const [open, setOpen] = useState(false), [teamName, setTeamName] = useState(''), [captainSlot, setCaptainSlot] = useState(0);
  const [players, setPlayers] = useState(() => Array.from({ length: 5 }, emptyPlayer));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const uploads = useRef(Array(5).fill(0));
  useEffect(() => () => { uploads.current = uploads.current.map(value => value + 1); }, []);
  const update = (index, patch) => setPlayers(current => current.map((player, slot) => slot === index ? { ...player, ...patch } : player));
  const identify = (index, patch) => {
    uploads.current[index]++;
    update(index, { ...patch, screenshot: null, uploading: false, uploadError: '' });
  };
  async function search(input) {
    if (!input.trim()) return [];
    try {
      const response = await fetch(`/api/admin/seasons/players?search=${encodeURIComponent(input.trim())}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Player lookup failed');
      return data.players.map(player => ({ value: player.PlayerId, label: `${player.PlayerName} (${player.PlayerId})`, ...player }));
    } catch (err) { setError(err.message); return []; }
  }
  async function screenshot(index, event) {
    const file = event.currentTarget.files?.[0], version = ++uploads.current[index];
    update(index, { screenshot: null, uploading: Boolean(file), uploadError: '' });
    if (!file) return;
    try {
      const prepared = await prepareScreenshot(file), data = await readScreenshot(prepared.file);
      if (uploads.current[index] === version) update(index, { screenshot: data, uploading: false });
    } catch (err) {
      if (uploads.current[index] === version) update(index, { uploading: false, uploadError: err.message });
    }
  }
  async function submit(event) {
    event.preventDefault(); setError(''); setMessage('');
    const ids = players.map(player => Number(player.playerId));
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== 5) return setError('Choose five different valid player account IDs.');
    if (players.some(player => player.uploading || player.uploadError)) return setError('Finish or remove the screenshot uploads before creating the team.');
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/seasons/${season.seasonId}/rosterTeams`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName, captainSlot, players: players.map(player => ({ playerId: Number(player.playerId),
          playerName: player.playerName, mmr: Number(player.mmr), screenshot: player.screenshot })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || (response.status === 413 ? 'Upload too large. Try smaller screenshots.' : 'Could not create team'));
      setMessage(`${data.team.TeamName} created. ${season.status === 'active' ? 'Open Settings, click Edit groups, and move it from Unassigned / unregistered into a group, then save.' : 'Assign the team to a group in Overview.'}`);
      uploads.current = uploads.current.map(value => value + 1);
      setTeamName(''); setCaptainSlot(0); setPlayers(Array.from({ length: 5 }, emptyPlayer)); setOpen(false); onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="betting-admin-widget admin-add-roster-team">
    <div className="sportsbook-heading"><h3>Add team</h3><button type="button" disabled={busy} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Close form' : 'Add team'}</button></div>
    <p>Create a team with five players. Screenshots are optional. The team stays unassigned until you add it to a group.</p>
    {error && <p role="alert" className="sportsbook-error">{error}</p>}{message && <p role="status">{message}</p>}
    {open && <form onSubmit={submit}>
      <div className="admin-add-team-heading"><label>Team name<input required maxLength={60} value={teamName} disabled={busy} onChange={event => setTeamName(event.target.value)} /></label>
        <label>Captain<select value={captainSlot} disabled={busy} onChange={event => setCaptainSlot(Number(event.target.value))}>
          {players.map((player, index) => <option key={index} value={index}>{player.playerName || `Player ${index + 1}`}</option>)}</select></label></div>
      <div className="admin-add-team-players">{players.map((player, index) => <fieldset key={index} disabled={busy}>
        <legend>Player {index + 1}</legend>
        <label htmlFor={`admin-add-team-player-${index}`}>Find existing player<AsyncSelect inputId={`admin-add-team-player-${index}`} cacheOptions
          loadOptions={search} styles={pickerStyles} isClearable isDisabled={busy} value={player.option} placeholder="Search name or account ID…"
          onChange={option => identify(index, option ? { option, playerId: String(option.value), playerName: option.PlayerName,
            mmr: option.AdjustedMMR == null ? '' : String(option.AdjustedMMR), adjusted: option.AdjustedMMR != null }
            : { option: null, playerId: '', playerName: '', mmr: '', adjusted: false })} /></label>
        <label>Account ID<input required inputMode="numeric" pattern="[0-9]+" value={player.playerId} onChange={event => identify(index,
          { option: null, playerId: event.target.value, playerName: '', adjusted: false, mmr: player.adjusted ? '' : player.mmr })} /></label>
        <label>Player name<input required maxLength={40} value={player.playerName} readOnly={Boolean(player.option)} onChange={event => update(index, { playerName: event.target.value })} /></label>
        <label>MMR{player.adjusted ? ' (admin adjusted)' : ''}<input required type="number" min="5501" step="1" value={player.mmr} readOnly={player.adjusted}
          onChange={event => update(index, { mmr: event.target.value })} /></label>
        {Number(player.playerId) > 0 && <div className="admin-add-team-dotabuff"><DotabuffLink playerId={player.playerId} name={player.playerName} /><span>Dotabuff profile</span></div>}
        <label>MMR screenshot (optional)<input key={player.playerId} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => screenshot(index, event)} /></label>
        {(player.screenshot || player.uploading || player.uploadError) && <button type="button" onClick={event => {
          event.currentTarget.closest('fieldset').querySelector('input[type=file]').value = '';
          uploads.current[index]++; update(index, { screenshot: null, uploading: false, uploadError: '' });
        }}>Remove screenshot</button>}
        {player.uploading && <small role="status">Preparing screenshot…</small>}
        {player.screenshot && <small>Screenshot ready.</small>}
        {player.uploadError && <small role="alert">{player.uploadError}</small>}
      </fieldset>)}</div>
      <button type="submit" className="ui-button-primary" disabled={busy || players.some(player => player.uploading || player.uploadError)}>{busy ? 'Creating…' : 'Create team'}</button>
    </form>}
  </section>;
}
