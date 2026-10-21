import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';
import MatchResultBadge from './MatchResultBadge';
import MatchSkillSequence from './MatchSkillSequence';
import { Panel, useReport } from './PerformanceUI';

export default function MatchSpells({ matchId, match, groups }) {
  const skills = useReport(`/api/matches/${matchId}/analysis/skills`);
  const builds = new Map((skills.data?.players || []).map(player => [player.playerId, player.upgrades]));
  return <div className="performance-report match-spells">
    {skills.error && <p className="performance-message" role="alert">Could not load skill builds. <button type="button" onClick={skills.retry}>Retry skill builds</button></p>}
    {groups.map(({ side, players }) => <Panel key={side ?? 'unknown'} className="match-spells-panel">
      <div className={`match-scoreboard-team performance-side-${side}`}>
        <h2>{side === null ? 'Side unavailable' : <Link to={`/team/${side === 0 ? match.rad_team_id : match.dire_team_id}`}>
          {side === 0 ? match.rad_team_name : match.dire_team_name}</Link>}</h2>
        {side !== null && <MatchResultBadge winnerSide={match.WinnerSide} side={side === 0 ? 'r' : 'd'} />}
      </div>
      <div className="match-spell-players">{players.map(player => <article className="match-spell-player" key={player.PlayerId}
        aria-label={`${player.PlayerName}'s spells`}>
        <div className="match-spell-player-heading">
          <Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link>
          <HeroDisplay heroId={player.HeroId} heroName={player.HeroName} iconSize={24} />
        </div>
        <MatchSkillSequence playerName={player.PlayerName} upgrades={builds.get(player.PlayerId)} loading={skills.loading} error={Boolean(skills.error)} />
      </article>)}</div>
    </Panel>)}
    <p className="performance-note">Numbers show recorded upgrade order. Missing skill builds are unavailable.</p>
  </div>;
}
