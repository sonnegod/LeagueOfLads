import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';
import MatchResultBadge from './MatchResultBadge';
import { Panel, ReportTable, fmt } from './PerformanceUI';

const known = value => typeof value === 'number' && Number.isFinite(value);
function total(players, fields) {
  if (!players.length || players.some(player => fields.some(field => !known(player[field])))) return null;
  return players.reduce((sum, player) => sum + fields.reduce((value, field) => value + player[field], 0), 0);
}
function Pair({ main, secondary, mainLabel, secondaryLabel }) {
  return <span className="match-stat-pair"><strong>{fmt(main, 0)}{mainLabel && <span> {mainLabel}</span>}</strong>
    <small>{fmt(secondary)} {secondaryLabel}</small></span>;
}

export default function MatchScoreboard({ match, groups, onViewBuild }) {
  const teams = [0, 1].map(side => ({ side, name: side === 0 ? match.rad_team_name : match.dire_team_name,
    players: groups.find(group => group.side === side)?.players || [] }));
  const comparisons = [['Final net worth', ['Networth']], ['Hero damage', ['HeroDamage']],
    ['Healing', ['Healing']], ['Wards placed', ['ObserversPlaced', 'SentriesPlaced']]];
  const columns = [
    { key: 'PlayerName', label: 'Player / hero', className: 'match-scoreboard-identity', render: player =>
      <span className="match-player-identity"><HeroDisplay heroId={player.HeroId} heroName={player.HeroName} iconSize={30} showName={false} />
        <span><Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link>
          <small>{player.HeroName}<span title="Final hero level"> · Lv {fmt(player.FinalLevel, 0)}</span></small></span></span> },
    { key: 'Kills', label: 'K / D / A', description: 'Kills / deaths / assists. Sort by kills.', render: player =>
      <span className="match-kda"><strong>{fmt(player.Kills, 0)}</strong><span> / {fmt(player.Deaths, 0)} / </span>{fmt(player.Assists, 0)}</span> },
    { key: 'Networth', label: 'Net worth', render: player => <strong className="match-stat-gold">{fmt(player.Networth, 0)}</strong> },
    { key: 'Lasthits', label: 'Farm', description: 'Last hits and denies. Sort by last hits.', render: player =>
      <Pair main={player.Lasthits} mainLabel="LH" secondary={player.Denies} secondaryLabel="denies" /> },
    { key: 'GPM', label: 'Income', description: 'Gold and experience per minute. Sort by GPM.', render: player =>
      <Pair main={player.GPM} mainLabel="GPM" secondary={player.XPM} secondaryLabel="XPM" /> },
    { key: 'HeroDamage', label: 'Damage', description: 'Hero damage and building damage. Sort by hero damage.', render: player =>
      <Pair main={player.HeroDamage} secondary={player.TowerDamage} secondaryLabel="buildings" /> },
    { key: 'Healing', label: 'Healing' },
    { key: 'ObserversPlaced', label: 'Vision', description: 'Observers / sentries placed, then observers / sentries destroyed. Sort by observers placed.', render: player =>
      <span className="match-stat-pair"><strong>{fmt(player.ObserversPlaced, 0)} / {fmt(player.SentriesPlaced, 0)} <span>placed</span></strong>
        <small>{fmt(player.ObserversKilled, 0)} / {fmt(player.SentriesKilled, 0)} cleared</small></span> },
    { key: 'CampsStacked', label: 'Utility', description: 'Camps stacked and stun seconds. Sort by stacks.', render: player =>
      <Pair main={player.CampsStacked} mainLabel="stacks" secondary={player.StunSeconds} secondaryLabel="sec stun" /> },
    { key: 'build', label: 'Build', sortable: false, render: player => <button type="button" className="match-build-link"
      aria-label={`View ${player.PlayerName}'s items and spells`} onClick={() => onViewBuild(player.PlayerId)}>View →</button> },
  ];
  return <div className="performance-report match-dashboard-overview">
    <section className="match-team-comparison" aria-label="Team comparison">
      <div className="match-comparison-grid">{comparisons.map(([label, fields]) => {
        const values = teams.map(team => total(team.players, fields));
        const complete = values.every(known), sum = complete ? values[0] + values[1] : 0;
        return <article className="match-comparison-metric" key={label}><h3>{label}</h3>
          <div className="match-comparison-values">{teams.map((team, index) => <span key={team.side} className={`performance-side-${team.side}`}>
            <small>{team.name}</small><strong>{fmt(values[index], 0)}</strong></span>)}</div>
          <div className="match-comparison-bar" aria-hidden="true" data-available={complete}>
            {complete && <span style={{ width: `${sum > 0 ? values[0] / sum * 100 : 50}%` }} />}</div>
        </article>;
      })}</div>
    </section>
    <p className="match-table-scroll-hint">Scroll across the scoreboards to see every statistic. Player names stay in view.</p>
    {groups.map(({ side, players }) => <Panel key={side ?? 'unknown'} className="match-scoreboard match-unified-scoreboard">
      <div className={`match-scoreboard-team performance-side-${side}`}>
        <h2>{side === null ? 'Side unavailable' : <Link to={`/team/${side === 0 ? match.rad_team_id : match.dire_team_id}`}>
          {side === 0 ? match.rad_team_name : match.dire_team_name}</Link>}</h2>
        {side !== null && <MatchResultBadge winnerSide={match.WinnerSide} side={side === 0 ? 'r' : 'd'} />}
        <small>{players.length} players</small>
      </div>
      <ReportTable rows={players} columns={columns} rowKey="PlayerId" initialSort="PlayerSlot" initialDirection="asc" />
    </Panel>)}
    <p className="performance-note">Vision shows observers / sentries. Missing values are shown as —; a team total requires recorded values for every listed player.</p>
  </div>;
}
