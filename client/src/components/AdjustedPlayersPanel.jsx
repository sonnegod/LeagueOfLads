import { useEffect, useRef, useState } from 'react';
import './AdjustedPlayersPanel.css';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function AdjustedPlayerRow({ player, onChanged }) {
  const [mmr, setMmr] = useState(String(player.AdjustedMMR));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setMmr(String(player.AdjustedMMR)), [player.AdjustedMMR]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request(`/api/admin/adjustedPlayers/${player.PlayerId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustedMMR: mmr }),
      });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove the adjusted MMR for ${player.PlayerName}?`)) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/admin/adjustedPlayers/${player.PlayerId}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return <div className="adjusted-player-row">
    <div><strong>{player.PlayerName}</strong><span className="adjusted-player-id"> ({player.PlayerId})</span></div>
    <form onSubmit={save} className="adjusted-player-controls">
      <label className="sr-only" htmlFor={`adjusted-mmr-${player.PlayerId}`}>Adjusted MMR for {player.PlayerName}</label>
      <input id={`adjusted-mmr-${player.PlayerId}`} type="number" min="5500" step="1" required
        value={mmr} onChange={event => setMmr(event.target.value)} />
      <button type="submit" disabled={busy || Number(mmr) === player.AdjustedMMR}>Save</button>
      <button type="button" disabled={busy} onClick={remove}>Remove</button>
    </form>
    {error && <p role="alert" className="adjusted-player-error">{error}</p>}
  </div>;
}

export default function AdjustedPlayersPanel() {
  const [players, setPlayers] = useState([]);
  const [search, setSearch] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeCandidateIndex, setActiveCandidateIndex] = useState(0);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [mmr, setMmr] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pickerRef = useRef(null);
  const pickerButtonRef = useRef(null);
  const searchInputRef = useRef(null);
  const activeOptionRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    request(`/api/admin/adjustedPlayers?search=${encodeURIComponent(search)}`)
      .then(data => { if (!cancelled) setPlayers(data.players); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [search, refresh]);

  useEffect(() => {
    let cancelled = false;
    if (!pickerOpen || !candidateSearch.trim()) return undefined;
    request(`/api/admin/adjustedPlayers/candidates?search=${encodeURIComponent(candidateSearch.trim())}`)
      .then(data => { if (!cancelled) setCandidates(data.players); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setCandidateLoading(false); });
    return () => { cancelled = true; };
  }, [candidateSearch, pickerOpen, refresh]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    searchInputRef.current?.focus();
    function closeOnOutsideClick(event) {
      if (!pickerRef.current?.contains(event.target)) setPickerOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [pickerOpen]);

  useEffect(() => {
    if (pickerOpen) activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [pickerOpen, activeCandidateIndex, candidates]);

  function updateCandidateSearch(value) {
    setCandidateSearch(value);
    setCandidates([]);
    setActiveCandidateIndex(0);
    setCandidateLoading(Boolean(value.trim()));
  }

  function choosePlayer(player) {
    setSelectedId(String(player.PlayerId));
    setSelectedPlayer(player);
    setPickerOpen(false);
    pickerButtonRef.current?.focus();
  }

  function handlePickerKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (candidates.length) setActiveCandidateIndex(index => Math.min(index + 1, candidates.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveCandidateIndex(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (candidates[activeCandidateIndex]) choosePlayer(candidates[activeCandidateIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setPickerOpen(false);
      pickerButtonRef.current?.focus();
    }
  }

  async function add(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('/api/admin/adjustedPlayers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: selectedId, adjustedMMR: mmr }),
      });
      setSelectedId('');
      setSelectedPlayer(null);
      setMmr('');
      updateCandidateSearch('');
      setMessage('Adjusted MMR saved. It will apply to future submissions.');
      setRefresh(value => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="adjusted-players-panel">
    <h2>Adjusted Players</h2>
    <p>Adjusted MMRs carry forward to future seasons. Changing one does not change submitted teams.</p>
    <form onSubmit={add} className="adjusted-player-add">
      <label htmlFor="adjusted-player-picker">Player</label>
      <div className="adjusted-player-picker" ref={pickerRef} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPickerOpen(false);
      }}>
        <button id="adjusted-player-picker" ref={pickerButtonRef} type="button"
          className="adjusted-player-picker-button" aria-haspopup="listbox"
          aria-expanded={pickerOpen} aria-controls={pickerOpen ? 'adjusted-player-options' : undefined}
          onClick={() => {
            setPickerOpen(open => !open);
            updateCandidateSearch('');
          }}>
          {selectedPlayer ? `${selectedPlayer.PlayerName} (${selectedPlayer.PlayerId})` : 'Select a player by name or ID'}
          <span aria-hidden="true">▾</span>
        </button>
        {pickerOpen && <div className="adjusted-player-picker-menu">
          <input ref={searchInputRef} id="adjusted-player-search" type="search"
            role="combobox" aria-label="Search players by name or ID"
            aria-expanded="true" aria-controls="adjusted-player-options"
            aria-activedescendant={candidates[activeCandidateIndex]
              ? `adjusted-player-option-${candidates[activeCandidateIndex].PlayerId}` : undefined}
            value={candidateSearch} maxLength="120"
            onChange={event => updateCandidateSearch(event.target.value)}
            onKeyDown={handlePickerKeyDown} placeholder="Search by name or ID" />
          <div id="adjusted-player-options" className="adjusted-player-picker-options"
            role="listbox" aria-label="Players">
            {candidates.map((player, index) => <button key={player.PlayerId}
              id={`adjusted-player-option-${player.PlayerId}`} ref={index === activeCandidateIndex ? activeOptionRef : null}
              type="button" role="option" tabIndex={-1}
              aria-selected={selectedId === String(player.PlayerId)}
              className="adjusted-player-picker-option"
              onMouseEnter={() => setActiveCandidateIndex(index)}
              onClick={() => choosePlayer(player)}>
              {player.PlayerName} ({player.PlayerId})
            </button>)}
            {!candidateSearch.trim() && <p>Type a name or Steam ID to find a player.</p>}
            {candidateSearch.trim() && candidateLoading && <p>Searching players...</p>}
            {candidateSearch.trim() && !candidateLoading && candidates.length === 0 && <p>No players found.</p>}
          </div>
        </div>}
      </div>
      <label htmlFor="adjusted-player-new-mmr">Adjusted MMR</label>
      <input id="adjusted-player-new-mmr" type="number" min="5500" step="1" required
        value={mmr} onChange={event => setMmr(event.target.value)} />
      <button className="ui-button-primary" type="submit" disabled={busy || !selectedId}>Add player</button>
    </form>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="adjusted-player-error">{error}</p>}
    <label htmlFor="adjusted-player-filter">Filter adjusted players</label>
    <input id="adjusted-player-filter" value={search} maxLength="120"
      onChange={event => setSearch(event.target.value)} placeholder="Name or Steam ID" />
    <div className="adjusted-player-list">
      {players.length ? players.map(player => <AdjustedPlayerRow key={player.PlayerId} player={player}
        onChanged={() => setRefresh(value => value + 1)} />) : <p>No adjusted players found.</p>}
    </div>
  </section>;
}
