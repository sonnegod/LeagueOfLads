import {Link} from 'react-router-dom';
import {useEffect, useState} from 'react';
import {inhouseRequest} from '../hooks/useInhouses';
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
    <p>Bot {game.botId} creates the lobby and sends Steam invitations. Team A joins <strong>{game.lobbyChoices?.radiantSide === 'B' ? 'Dire' : 'Radiant'}</strong>; Team B joins <strong>{game.lobbyChoices?.radiantSide === 'B' ? 'Radiant' : 'Dire'}</strong>. Any slot on your assigned side is fine. The bot starts once everyone has joined the correct team.</p>
    <p className="inhouse-muted" aria-live="polite">{game.botLaunchedAt ? 'The bot has requested game start and is waiting for Dota.'
      : game.lobbyJoinStartedAt ? `Lobby ready. The bot has started the ${game.launchMinutes}-minute join timer.`
        : 'The bot is preparing the lobby. Your join timer starts when it confirms the lobby is ready.'}</p>
    {details?.gameId === game.id && <div className="inhouse-lobby-details"><span>Lobby: <strong>{details.name}</strong></span>
      <span>Password: <code>{details.password}</code></span></div>}
  </>;
}
function CaptainLobbyChoices({game,userId,busy,onChoose,seconds}) {
  const choices=game.lobbyChoices, captain=game.players.find(p=>p.playerId===choices.captainId);
  const first=game.players.find(p=>p.playerId===choices.firstCaptainId);
  const canChoose=Number(userId)===choices.captainId;
  const labels={radiant:'Radiant',dire:'Dire',first_pick:'First pick',second_pick:'Second pick'};
  return <section className="inhouse-lobby-choices" aria-label="Captain lobby choices">
    <h3>Side and pick order</h3>
    <p>{first?.name} won the first choice. {choices.turn===0
      ? game.gameMode===2 ? 'Choose your side or Captain’s Mode pick order; the other captain chooses the remaining category.' : 'Choose your side. All Pick has no Captain’s Mode pick order.'
      : `The remaining captain chooses ${choices.kind==='side'?'Radiant or Dire':'first or second pick'}.`}</p>
    <p aria-live="polite"><strong>{canChoose?'Your choice':`${captain?.name} is choosing`}</strong> · A choice is made automatically if the timer expires.</p>
    <div className="inhouse-choice-options">{choices.options.map(choice=><button key={choice} type="button"
      disabled={!canChoose||busy||seconds===0||!onChoose} onClick={()=>onChoose(game.id,choice,choices.turn)}>{labels[choice]}</button>)}</div>
  </section>;
}
export function InhousePlayer({player, showResult = false}) {
  const calibration = inhouseCalibration(player.games);
  return <div className="inhouse-player">
    <div className="inhouse-player-name"><Link to={`/player/${player.playerId}`}>{player.name}</Link>
      {calibration && <small className="inhouse-calibration">{calibration}</small>}
      <small>{player.position ? `Pos ${player.position} · ` : ''}{inhouseRoles(player)}</small></div>
    <div className="inhouse-player-rating"><strong>{inhouseRating(showResult && player.ratingAfter != null ? player.ratingAfter : player.rating)}</strong>
      <small>{showResult && player.ratingBefore != null ? `Before: ${inhouseRating(player.ratingBefore)}` : `${player.games} games`}</small>
      {showResult && player.ratingDelta != null && <span className={player.ratingDelta >= 0 ? 'inhouse-positive' : 'inhouse-negative'}>
        {player.ratingDelta >= 0 ? '+' : ''}{Number(player.ratingDelta).toFixed(1)}</span>}</div>
  </div>;
}

export default function InhouseGameCard({game, userId, now, busy, onReady, onPick, onLobbyChoice, allowReadyPreview = false}) {
  const mine = game.players.find(p => String(p.playerId) === String(userId));
  if (game.status === 'ready' && !mine && !allowReadyPreview) return null;
  const canPick = game.status === 'drafting' && Number(userId) === (game.turnSide === 'A' ? game.captainA : game.captainB);
  const choosing=game.status==='awaiting_game'&&game.lobbyChoices?.pending;
  const deadline=choosing?game.lobbyChoices.deadline:game.botLaunchedAt?null:game.deadline;
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const radiantSide=game.radiantSide||game.lobbyChoices?.radiantSide;
  return <article className={`inhouse-card inhouse-game${mine ? ' is-mine' : ''}`}>
    <header className="inhouse-card-heading"><div><span className="inhouse-eyebrow">Inhouse #{game.id}</span><h2>{game.status === 'completed' ? 'Postgame report' : choosing ? 'Captain lobby choices'
      : game.status==='awaiting_game' ? game.botLaunchedAt ? 'Starting game' : game.lobbyJoinStartedAt ? 'Join the Dota lobby' : 'Preparing lobby' : inhouseStatus[game.status]}</h2></div>
      {deadline && <span className="inhouse-timer" aria-label="Time remaining">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}</header>
    <div className="inhouse-meta"><span>{game.queueMode === 'fifo' ? 'FIFO · roles informational' : 'Role preference'}</span>
      {game.playerCount === 2 && <span>1v1 admin test</span>}
      {game.playerCount === 1 && <span>Solo admin test · Unrated · All Pick</span>}
      <span>{game.draftMode === 'captain' ? 'Captain draft' : 'Automatic teams'}</span><span>Ticket {game.leagueId}</span>
      {game.matchId && <a href={`https://www.dotabuff.com/matches/${game.matchId}`} target="_blank" rel="noreferrer">Match {game.matchId} ↗</a>}</div>
    {game.status === 'ready' ? <>
      <p>{game.players.filter(p => p.ready).length}/{game.playerCount ?? 10} players ready. Confirm before the timer ends.</p>
      {mine && <button className="inhouse-primary" disabled={busy || mine.ready || seconds === 0} onClick={() => onReady(game.id)}>
        {mine.ready ? 'Ready confirmed' : 'I’m ready'}</button>}
      <div className="inhouse-ready-list">{game.players.map(p => <span key={p.playerId} className={p.ready ? 'is-ready' : ''}>{p.ready ? '✓ ' : '○ '}{p.name}</span>)}</div>
    </> : game.status === 'cancelled' ? <p>{game.cancelReason || 'This inhouse was cancelled.'}</p> : <>
      {game.winner && <p className="inhouse-winner">Team {game.winner} won</p>}
      {game.status === 'completed' && <section className="inhouse-result" aria-label="Postgame result" role="status">
        {mine ? <>
          <h3>{mine.side === game.winner ? 'You won' : 'You lost'}</h3>
          {mine.ratingBefore != null && mine.ratingAfter != null && <div className="inhouse-rating-change">
            <span>{inhouseRating(mine.ratingBefore)} <span aria-hidden="true">→</span> {inhouseRating(mine.ratingAfter)}</span>
            <strong className={mine.ratingDelta >= 0 ? 'inhouse-positive' : 'inhouse-negative'}>{mine.ratingDelta >= 0 ? '+' : ''}{Number(mine.ratingDelta).toFixed(1)} rating</strong>
          </div>}
        </> : <h3>Final ratings</h3>}
        {game.rated===false&&<p>Unrated solo test. Your rating, calibration games and standings are unchanged.</p>}
        <p>Players have been released. Join the queue when you are ready for another game.</p>
      </section>}
      {game.status === 'drafting' && <p aria-live="polite">Team {game.turnSide} picks next · Pick {game.turn + 1}/8{canPick ? ' · Your pick' : ''}</p>}
      {choosing && <CaptainLobbyChoices game={game} userId={userId} busy={busy} seconds={seconds} onChoose={onLobbyChoice} />}
      {game.status === 'awaiting_game' && !choosing && (game.botId
        ? mine ? <BotLobbyDetails game={game} /> : <p>Bot {game.botId} is preparing this lobby.</p>
        : <p>This inhouse predates bot hosting. An admin can cancel it and start a bot-hosted game, or verify its existing match ID.</p>)}
      {game.hostingError && !['completed','cancelled'].includes(game.status) && <p className="inhouse-notice">{game.hostingError}</p>}
      <div className="inhouse-teams">{['A', 'B'].map(side => {
        const players = game.players.filter(p => p.side === side).sort((a, b) => (a.position || 9) - (b.position || 9) || (a.pickNumber || 0) - (b.pickNumber || 0));
        const captain = game.players.find(p => p.playerId === (side === 'A' ? game.captainA : game.captainB));
        return <section key={side} className={`inhouse-team inhouse-team-${side.toLowerCase()}`}>
          <header><h3>Team {side}{radiantSide ? ` · ${side===radiantSide?'Radiant':'Dire'}` : ''}{game.winner === side ? ' · Winner' : ''}</h3><span>Avg {average(players)}</span></header>
          <p className="inhouse-muted">Captain: {captain?.name||'None'}</p>
          {game.gameMode===2&&game.lobbyChoices?.firstPickSide&&<p className="inhouse-muted">{game.lobbyChoices.firstPickSide===side?'First pick':'Second pick'} · Captain’s Mode</p>}
          {players.map(player => <InhousePlayer key={player.playerId} player={player} showResult={game.status === 'completed'} />)}
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
