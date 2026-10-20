import { Link } from 'react-router-dom';
import DotabuffLink from './DotabuffLink';
import TeamRosterHistory, { RosterDates } from './TeamRosterHistory';
import {rosterDisplayMembers} from '../utils/rosterDisplayMembers';

export default function TeamRoster({ roster, leagueId }) {
  if (roster?.Source !== 'signup' || !roster.players.length) return null;
  return <section className="team-active-roster" aria-label="Active roster">
    <div className="team-active-roster-heading">
      <h2>Active roster</h2>
      <Link to={`/league/${roster.LeagueId}`}>{roster.LeagueName || `League ${roster.LeagueId}`}</Link>
    </div>
    <RosterDates roster={roster} />
    <ul className="team-active-roster-players">{rosterDisplayMembers(roster).map((player,index) => <li key={player.pending?`pending:${player.Slot}`:player.PlayerId}>
      {roster.SeasonStatus==='active'&&<span className="team-roster-position">Pos {index+1}</span>}
      {player.pending?<span title="This roster spot has not been confirmed">Player TBD</span>:<><Link to={`/player/${player.PlayerId}`} target="_blank" rel="noopener noreferrer">{player.PlayerName}</Link>
      <DotabuffLink playerId={player.PlayerId} name={player.PlayerName} /></>}
    </li>)}</ul>
    <TeamRosterHistory roster={roster} leagueId={leagueId} />
  </section>;
}
