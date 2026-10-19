import { Link } from 'react-router-dom';
import DotabuffLink from './DotabuffLink';
import TeamRosterHistory, { RosterDates } from './TeamRosterHistory';

export default function TeamRoster({ roster, leagueId }) {
  if (roster?.Source !== 'signup' || !roster.players.length) return null;
  return <section className="team-active-roster" aria-label="Active roster">
    <div className="team-active-roster-heading">
      <h2>Active roster</h2>
      <Link to={`/league/${roster.LeagueId}`}>{roster.LeagueName || `League ${roster.LeagueId}`}</Link>
    </div>
    <RosterDates roster={roster} />
    <ul className="team-active-roster-players">{roster.players.map(player => <li key={player.PlayerId}>
      <Link to={`/player/${player.PlayerId}`} target="_blank" rel="noopener noreferrer">{player.PlayerName}</Link>
      <DotabuffLink playerId={player.PlayerId} name={player.PlayerName} />
    </li>)}{roster.pendingSlots?.map(p=><li key={`pending:${p.Slot}`}><span title="This roster spot has not been confirmed">Player TBD</span></li>)}</ul>
    <TeamRosterHistory roster={roster} leagueId={leagueId} />
  </section>;
}
