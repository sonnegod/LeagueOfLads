import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Gamepad2, UsersRound} from 'lucide-react';
import {useInhouseActivity} from '../context/inhouseActivity';
import './InhouseQueueBadge.css';

export default function InhouseQueueBadge() {
  const {queue: data, error, refresh} = useInhouseActivity();
  const [open, setOpen] = useState(null), [position, setPosition] = useState({left: 0, top: 0, width: 260});
  const trigger = useRef(null), popup = useRef(null), closeTimer = useRef(null);
  const tooltipId = useId(), count = data?.count ?? null;
  const games = data?.games ?? [], gameCount = data ? games.length : null;
  const status = {ready: 'Ready check', drafting: 'Drafting', awaiting_game: 'Waiting to start', playing: 'Playing'};
  function show(kind, event) {trigger.current = event.currentTarget; clearTimeout(closeTimer.current); setOpen(kind); if (!open) refresh();}
  function hideSoon() {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {if (document.activeElement !== trigger.current) setOpen(null);}, 150);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current || !popup.current) return;
      const anchor = trigger.current.getBoundingClientRect(), rect = popup.current.getBoundingClientRect();
      const width = Math.min(260, window.innerWidth - 24);
      const left = anchor.right + 10 + width <= window.innerWidth - 12 ? anchor.right + 10 : Math.max(12, anchor.left - width - 10);
      const top = Math.max(12, Math.min(anchor.top - 6, window.innerHeight - rect.height - 12));
      setPosition({left, top, width});
    }
    function outside(event) {
      if (!trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(null);
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, data]);
  return <>
    <div className="inhouse-activity-badges">
    <button type="button" className={`inhouse-queue-badge${count === 0 ? ' is-empty' : ''}`}
      aria-label={count == null ? 'Loading inhouse queue' : `${count} ${count === 1 ? 'player' : 'players'} queued for inhouses`}
      aria-expanded={open === 'queue'} aria-describedby={open === 'queue' ? tooltipId : undefined}
      onMouseEnter={event => show('queue', event)} onMouseLeave={hideSoon} onFocus={event => show('queue', event)} onBlur={hideSoon} onClick={event => show('queue', event)}
      onKeyDown={event => {if (event.key === 'Escape') {event.stopPropagation(); setOpen(null);}}}>
      <span className="inhouse-queue-badge-count"><UsersRound size={12} aria-hidden="true" />{count ?? '…'}</span>
    </button>
    <button type="button" className={`inhouse-queue-badge inhouse-games-badge${gameCount === 0 ? ' is-empty' : ''}`}
      aria-label={gameCount == null ? 'Loading active inhouses' : `${gameCount} active inhouse ${gameCount === 1 ? 'game' : 'games'}, ${data.activePlayers} players in lobbies, ${data.totalPlayers} total players`}
      aria-expanded={open === 'games'} aria-describedby={open === 'games' ? tooltipId : undefined}
      onMouseEnter={event => show('games', event)} onMouseLeave={hideSoon} onFocus={event => show('games', event)} onBlur={hideSoon} onClick={event => show('games', event)}
      onKeyDown={event => {if (event.key === 'Escape') {event.stopPropagation(); setOpen(null);}}}>
      <span className="inhouse-games-badge-count"><Gamepad2 size={13} aria-hidden="true" />{gameCount ?? '…'}</span>
    </button>
    </div>
    {open && createPortal(<div ref={popup} id={tooltipId} role="tooltip" className="inhouse-queue-popover" style={position}
      onMouseEnter={() => clearTimeout(closeTimer.current)} onMouseLeave={hideSoon}>
      {open === 'queue' ? <>
      <strong>Players queued</strong>
      {data?.players?.length ? <ul>{data.players.map(player => <li key={player.playerId}>{player.name}</li>)}</ul>
        : <p>{count == null ? 'Loading queue…' : 'No players queued.'}</p>}
      </> : <>
        <strong>Current games</strong>
        {games.length ? <ul className="inhouse-active-games">{games.map(game => <li key={game.id}>
          <span><b>#{game.id}</b><span className={`inhouse-game-stage is-${game.status}`}>{status[game.status]}</span></span>
          <small>{game.playerCount} players</small>
        </li>)}</ul> : <p>{gameCount == null ? 'Loading games…' : 'No active games.'}</p>}
      </>}
      {data && <div className="inhouse-player-pool"><strong>{data.totalPlayers} in the player pool</strong>
        <span>{count} queued · {data.activePlayers} in lobbies</span></div>}
      {error && <p className="inhouse-queue-update-note">Queue updates are delayed.</p>}
    </div>, document.body)}
  </>;
}
