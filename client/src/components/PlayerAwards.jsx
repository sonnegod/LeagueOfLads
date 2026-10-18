import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Trophy } from 'lucide-react';
import HeroDisplay from './HeroDisplay';
import './PlayerAwards.css';

const count = value => Number(value).toLocaleString();
const description = award => ({
  champion: 'Season champions', winningest: 'Highest overall win rate',
  veteran: 'Most league games played all-time', hero_specialist: 'Highest win rate on this hero',
  hero_loyalist: 'Most games played on this hero',
})[award.type];

function AwardIcon({ award, compact = false }) {
  if (award.heroId) return <HeroDisplay heroId={award.heroId} heroName={award.heroName}
    showName={false} link={false} iconSize={compact ? 25 : 36} />;
  return award.type === 'champion' ? <Trophy size={compact ? 18 : 28} aria-hidden="true" />
    : <Award size={compact ? 18 : 28} aria-hidden="true" />;
}

export function PlayerChampionshipTrophies({ awards, size = 23 }) {
  const championships = awards.filter(award => award.type === 'champion');
  if (!championships.length) return null;
  return <span className="player-championship-trophies" role="group" aria-label="League championships">
    {championships.map(award => <Link key={award.id} className="player-championship-trophy"
      to={`/league/${award.leagueId}`} title={`${award.leagueName} champion`}
      aria-label={`${award.leagueName} champion`} onClick={event => event.stopPropagation()}>
      <Trophy size={size} aria-hidden="true" />
    </Link>)}
  </span>;
}

export function PlayerAwardHighlights({ awards, loading, error, onViewAll }) {
  if (loading) return <p className="player-awards-loading" role="status">Loading awards...</p>;
  if (error) return <div className="player-award-highlights"><button type="button"
    className="player-awards-open" onClick={onViewAll}>View awards</button></div>;
  if (!awards.length) return null;
  const groups = new Map();
  for (const award of awards) {
    if (award.type === 'champion') continue;
    const key = award.heroId ? `hero:${award.heroId}` : award.type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(award);
  }
  return <div className="player-award-highlights" aria-label="Player award highlights">
    {[...groups.entries()].slice(0, 6).map(([key, records]) => {
      const award = records[0];
      const tooltip = [award.heroName || award.title, ...records.map(record =>
        `${record.title}: ${record.type === 'hero_loyalist' || record.type === 'veteran'
          ? `${count(record.games)} games` : `${record.winRate}% win rate over ${count(record.games)} games`}${record.shared ? ' (shared record)' : ''}`),
      'All-time league record'].join('\n');
      return <button key={key} type="button" onClick={onViewAll}
        className="player-award-highlight" title={tooltip} aria-label={tooltip}>
        <AwardIcon award={award} compact />
      </button>;
    })}
    <button type="button" className="player-awards-open" onClick={onViewAll}>
      View all awards ({awards.length})
    </button>
  </div>;
}

function AwardCard({ award }) {
  return <article className={`player-award-card${award.type === 'champion' ? ' player-award-card--champion' : ''}`}>
    <div className="player-award-card-heading">
      <div className="player-award-icon"><AwardIcon award={award} /></div>
      <div><h3>{award.title}</h3><p>{description(award)}</p></div>
    </div>
    {award.heroId && <Link className="player-award-subject" to={`/hero/${award.heroId}`}>{award.heroName}</Link>}
    {award.teamId && <Link className="player-award-subject" to={`/team/${award.teamId}`}>{award.teamName}</Link>}
    <div className="player-award-value"><strong>{award.type === 'veteran' || award.type === 'hero_loyalist'
      ? count(award.games) : `${award.winRate}%`}</strong>
      <span>{award.type === 'veteran' || award.type === 'hero_loyalist' ? 'games played' : 'win rate'}</span>
    </div>
    <p className="player-award-record">{count(award.wins)}W – {count(award.games - award.wins)}L · {count(award.games)} games</p>
    <div className="player-award-scope">{award.leagueId
      ? <Link to={`/league/${award.leagueId}`}>{award.leagueName}</Link> : <span>All-time league record</span>}</div>
    <div className="player-award-flags">
      {award.shared && <span>Shared with {award.tiedPlayers - 1} {award.tiedPlayers === 2 ? 'other player' : 'other players'}</span>}
      {award.scope === 'all-time' && <span>Current record</span>}
    </div>
    <small className="player-award-qualification">{award.type === 'champion'
      ? `${award.games} of ${award.teamGames} team games. ${award.rosterSource === 'admin' ? 'Championship roster confirmed by admins.' : award.rosterSource === 'signup' ? 'Confirmed roster member.' : 'Qualified by majority of team appearances.'}`
      : award.minimumGames > 0
        ? `Minimum ${award.minimumGames} ${award.heroId ? 'games on this hero' : 'games'}.`
        : 'No minimum games required.'}</small>
  </article>;
}

export default function PlayerAwards({ awards, criteria, loading, error, onRetry, selectedLeague = 'all' }) {
  const [category, setCategory] = useState('all');
  const filtered = awards.filter(award => category === 'all'
    || (category === 'champion' ? award.type === 'champion'
      : category === 'career' && award.scope === 'all-time'));
  return <section className="player-awards-section" aria-label="Player awards">
    <div className="player-awards-heading"><div><h2>Awards &amp; records</h2>
      <p>Automatically earned from completed league games.</p></div></div>
    <div className="ui-tabs player-awards-categories" role="group" aria-label="Award category">
      {[['all', 'All awards'], ['champion', 'Championships'], ['career', 'All-time records']].map(([key, label]) =>
        <button key={key} type="button" className="ui-tab" aria-pressed={category === key}
          onClick={() => setCategory(key)}>{label}</button>)}
    </div>
    {loading ? <p role="status">Loading awards...</p> : error ? <div role="alert"><p>{error}</p>
      <button type="button" onClick={onRetry}>Retry</button></div>
      : filtered.length ? <div className="player-awards-grid">{filtered.map(award => <AwardCard key={award.id} award={award} />)}</div>
        : <p className="player-awards-empty">{category === 'career' && selectedLeague !== 'all'
          ? 'Choose All Leagues above to see all-time records.'
          : 'No qualifying awards in this selection yet. New leaders appear automatically as results come in.'}</p>}
    <PlayerAwardsCriteria criteria={criteria} />
  </section>;
}

export function PlayerAwardsCriteria({ criteria }) {
  if (!criteria) return null;
  return (<details className="player-awards-criteria">
      <summary>How awards are earned</summary>
      <ul>
        <li><strong>Hero Specialist:</strong> highest all-time win rate on a hero, compared with every qualifying player. Minimum {criteria.allTimeHeroGames} games on that hero across all seasons. Hero awards are all-time only.</li>
        <li><strong>Hero Loyalist:</strong> most all-time games on a hero, with no minimum games required.</li>
        <li><strong>Winningest Player:</strong> highest all-time overall win rate, minimum {criteria.playerGames} games across all seasons.</li>
        <li><strong>League Veteran:</strong> most league games played across all seasons, with no minimum games required. This award is all-time only.</li>
        <li><strong>League Champion:</strong> a saved champion of a completed season. For older seasons, admins can confirm five championship players; otherwise, more than half of the champion team's completed games is required. Signup seasons require finalized roster membership and more than half of the team's completed games.</li>
      </ul>
      <p>Ties share the award. All-time records can change as games are played. Championship badges recognize completed seasons and reflect any data corrections.</p>
      <p>Stats include all completed league appearances, including stand-ins, across group stages, tiebreakers, and playoffs. Conflicting team or hero records and games without a valid winner are excluded. Automatic championship qualification counts only games for the winning team and excludes occasional stand-ins. Historical champion badges require a recorded champion.</p>
    </details>);
}
