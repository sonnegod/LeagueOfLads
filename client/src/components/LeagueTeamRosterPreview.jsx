import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import './LeagueTeamRosterPreview.css';

export default function LeagueTeamRosterPreview({ team, roster, report, onRequest }) {
  const id = useId(), anchor = useRef(null), popup = useRef(null), button = useRef(null), closeTimer = useRef(null);
  const focusPopup = useRef(false);
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false), [position, setPosition] = useState(null);
  const href = team.TeamId != null ? `/team/${team.TeamId}`
    : team.TeamSubmissionId ? `/team/roster/${team.TeamSubmissionId}` : null;
  const show = () => { clearTimeout(closeTimer.current); onRequest(); setOpen(true); };
  const hide = () => { clearTimeout(closeTimer.current); setOpen(false); setPinned(false); };
  const leave = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!pinned && !anchor.current?.contains(document.activeElement) && !popup.current?.contains(document.activeElement)) setOpen(false);
    }, 160);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const bounds = anchor.current.getBoundingClientRect();
    const height = Math.min(popup.current.getBoundingClientRect().height, window.innerHeight - 24);
    const width = Math.min(300, window.innerWidth - 24);
    const top = window.innerHeight - bounds.bottom >= height + 8 ? bounds.bottom + 8 : bounds.top - height - 8;
    setPosition({ left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - height - 12)) });
  }, [open, pinned, roster, report.loading, report.error]);
  useLayoutEffect(() => {
    if (open && pinned && position && focusPopup.current) {
      focusPopup.current = false; popup.current.focus({ preventScroll: true });
    }
  }, [open, pinned, position]);
  useEffect(() => {
    if (!open) return;
    const dismiss = event => {
      if (!(event.target instanceof Node) || !anchor.current?.contains(event.target) && !popup.current?.contains(event.target)) {
        clearTimeout(closeTimer.current); setOpen(false); setPinned(false);
      }
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      if (popup.current?.contains(document.activeElement)) button.current?.focus({ preventScroll: true });
      clearTimeout(closeTimer.current); setOpen(false); setPinned(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);
  const caption = roster?.HasRoster ? roster.SeasonStatus === 'active' ? 'Active roster' : 'Season roster'
    : roster?.Source === 'match_lineup' ? 'Latest match lineup' : 'Roster';
  const captainInRoster = roster?.players.some(player => player.PlayerId === roster.CaptainId);
  return <span ref={anchor} className="league-team-roster-trigger" onMouseEnter={show} onMouseLeave={leave}
    onFocus={show} onBlur={event => {
      if (!anchor.current?.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget)) {
        setPinned(false); clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 160);
      }
    }}>
    {href ? <Link to={href}>{team.TeamName}</Link> : <span>{team.TeamName}</span>}
    <button ref={button} type="button" className="league-team-roster-button" aria-label={`View ${team.TeamName} roster`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      style={{ minHeight: 23, height: 23, padding: 3, border: 0, background: 'transparent' }}
      onClick={() => { if (pinned) hide(); else { focusPopup.current = true; setPinned(true); show(); } }}><Users size={15} aria-hidden="true" /></button>
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} tabIndex={-1}
      className="league-team-roster-popup" style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
      onMouseEnter={show} onMouseLeave={leave}>
      <header><small>{caption}</small><strong id={`${id}-title`}>{team.TeamName}</strong></header>
      {report.loading ? <p role="status">Loading roster…</p> : report.error ? <p role="alert">Could not load the roster.{' '}
        <button type="button" onClick={report.retry}>Retry</button></p> : roster ? <>
        {roster.players.length || roster.pendingSlots.length ? <ul>{roster.players.map(player => <li key={player.PlayerId}>
          <Link to={`/player/${player.PlayerId}`} onClick={hide}>{player.PlayerName}</Link>
          {player.PlayerId === roster.CaptainId && <span className="league-team-roster-captain">Captain</span>}
        </li>)}{roster.pendingSlots.map(slot => <li key={`pending:${slot.Slot}`} className="league-team-roster-pending">Player TBD</li>)}</ul>
          : <p>Roster not recorded yet.</p>}
        {!captainInRoster && <p className="league-team-roster-captain-note">{roster.CaptainId ? <>Captain: <Link
          to={`/player/${roster.CaptainId}`} onClick={hide}>{roster.CaptainName}</Link></> : 'Captain not recorded.'}</p>}
      </> : <p>Roster not recorded yet.</p>}
    </div>, document.body)}
  </span>;
}
