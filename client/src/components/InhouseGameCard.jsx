import {Link} from 'react-router-dom';
import {useEffect, useState} from 'react';
import {inhouseRequest} from '../hooks/useInhouses';
import {inhouseLobbyAssignments} from '../../../shared/inhouseLobby';
import {inhouseStatus, inhouseRating, inhouseRoles, inhouseCalibration} from '../utils/inhouseDisplay';
const average = players => players.length ? inhouseRating(players.reduce((n, p) => n + p.rating, 0) / players.length) : '—';
function BotLobbyDetails({game}) {
  const [details, setDetails] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    inhouseRequest(`/inhouses/games/${game.id}/lobby`, {signal: controller.signal})
      .then(setDetails).catch(() => {});
    return () => controller.abort();
  }, [game.id, game.lobbyId]);
  return <>
    <p>Bot {game.botId} creates the lobby and sends Steam invitations. Team A joins <strong>Radiant</strong>; Team B joins <strong>Dire</strong>. Use the slot shown beside your name. The bot starts once everyone is in their assigned slot.</p>
    {details?.gameId === game.id && <div className="inhouse-lobby-details"><span>Lobby: <strong>{details.name}</strong></span>
      <span>Password: <code>{details.password}</code></span></div>}
  </>;
}
export function InhousePlayer({player, showResult = false, lobbySlot = null}) {
  const calibration = inhouseCalibration(player.games);
  return <div className="inhouse-player">
    <div className="inhouse-player-name"><Link to={`/player/${player.playerId}`}>{player.name}</Link>
      {calibration && <small className="inhouse-calibration">{calibration}</small>}
      <small>{player.position ? `Pos ${player.position} · ` : lobbySlot ? `Lobby slot ${lobbySlot} · ` : ''}{inhouseRoles(player)}</small></div>
    <div className="inhouse-player-rating"><strong>{inhouseRating(player.rating)}</strong>
      <small>{player.games} games</small>
      {showResult && player.ratingDelta != null && <span className={player.ratingDelta >= 0 ? 'inhouse-positive' : 'inhouse-negative'}>
        {player.ratingDelta >= 0 ? '+' : ''}{Number(player.ratingDelta).toFixed(1)}</span>}</div>
  </div>;
}

export default function InhouseGameCard({game, userId, now, busy, onReady, onPick, allowReadyPreview = false}) {
  const mine = game.players.find(p => String(p.playerId) === String(userId));
  if (game.status === 'ready' && !mine && !allowReadyPreview) return null;
  const canPick = game.status === 'drafting' && Number(userId) === (game.turnSide === 'A' ? game.captainA : game.captainB);
  const seconds = Math.max(0, Math.ceil((game.deadline - now) / 1000));
  const lobbySlots = new Map(inhouseLobbyAssignments(game.players).map(p => [p.playerId,p.slot]));
  return <article className={`inhouse-card inhouse-game${mine ? ' is-mine' : ''}`}>
    <header className="inhouse-card-heading"><div><span className="inhouse-eyebrow">Inhouse #{game.id}</span><h2>{inhouseStatus[game.status]}</h2></div>
      {game.deadline && <span className="inhouse-timer" aria-label="Time remaining">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}</header>
    <div className="inhouse-meta"><span>{game.queueMode === 'fifo' ? 'FIFO · roles informational' : 'Role preference'}</span>
      {game.playerCount === 2 && <span>1v1 admin test</span>}
      <span>{game.draftMode === 'captain' ? 'Captain draft' : 'Automatic teams'}</span><span>Ticket {game.leagueId}</span>
      {game.matchId && <a href={`https://www.dotabuff.com/matches/${game.matchId}`} target="_blank" rel="noreferrer">Match {game.matchId} ↗</a>}</div>
    {game.status === 'ready' ? <>
      <p>{game.players.filter(p => p.ready).length}/{game.playerCount ?? 10} players ready. Confirm before the timer ends.</p>
      {mine && <button className="inhouse-primary" disabled={busy || mine.ready || seconds === 0} onClick={() => onReady(game.id)}>
        {mine.ready ? 'Ready confirmed' : 'I’m ready'}</button>}
      <div className="inhouse-ready-list">{game.players.map(p => <span key={p.playerId} className={p.ready ? 'is-ready' : ''}>{p.ready ? '✓ ' : '○ '}{p.name}</span>)}</div>
    </> : game.status === 'cancelled' ? <p>{game.cancelReason || 'This inhouse was cancelled.'}</p> : <>
      {game.winner && <p className="inhouse-winner">Team {game.winner} won</p>}
      {game.status === 'drafting' && <p aria-live="polite">Team {game.turnSide} picks next · Pick {game.turn + 1}/8{canPick ? ' · Your pick' : ''}</p>}
      {game.status === 'awaiting_game' && (game.botId
        ? mine ? <BotLobbyDetails game={game} /> : <p>Bot {game.botId} is preparing this lobby.</p>
        : <p>This inhouse predates bot hosting. An admin can cancel it and start a bot-hosted game, or verify its existing match ID.</p>)}
      {game.hostingError && !['completed','cancelled'].includes(game.status) && <p className="inhouse-notice">{game.hostingError}</p>}
      <div className="inhouse-teams">{['A', 'B'].map(side => {
        const players = game.players.filter(p => p.side === side).sort((a, b) => (a.position || 9) - (b.position || 9) || (a.pickNumber || 0) - (b.pickNumber || 0));
        const captain = game.players.find(p => p.playerId === (side === 'A' ? game.captainA : game.captainB));
        return <section key={side} className={`inhouse-team inhouse-team-${side.toLowerCase()}`}>
          <header><h3>Team {side}{game.winner === side ? ' · Winner' : ''}</h3><span>Avg {average(players)}</span></header>
          <p className="inhouse-muted">Captain: {captain?.name}</p>
          {players.map(player => <InhousePlayer key={player.playerId} player={player} lobbySlot={game.formedAt ? lobbySlots.get(player.playerId) : null} showResult={game.status === 'completed'} />)}
        </section>;
      })}</div>
      {game.status === 'drafting' && <section className="inhouse-available"><h3>Available players</h3><div className="inhouse-pick-grid">
        {game.players.filter(p => !p.side).map(player => <div className="inhouse-pick" key={player.playerId}><InhousePlayer player={player} />
          {canPick && <button disabled={busy || !game.allowedPicks.includes(player.playerId) || seconds === 0}
            title={!game.allowedPicks.includes(player.playerId) ? 'This pick would prevent valid role coverage' : undefined}
            onClick={() => onPick(game.id, player.playerId, game.turn)}>Pick</button>}</div>)}
      </div></section>}
    </>}
  </article>;
}
