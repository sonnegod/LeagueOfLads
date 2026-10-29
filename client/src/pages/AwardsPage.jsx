import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Trophy } from 'lucide-react';
import HeroDisplay from '../components/HeroDisplay';
import { PlayerAwardsCriteria } from '../components/PlayerAwards';
import './AwardsPage.css';

const number = value => Number(value).toLocaleString();
const categories = [['all', 'All awards'], ['league', 'League records'], ['heroes', 'Hero records'], ['champion', 'Championships']];
const matchesSearch = (award, query) => !query || [award.title, award.heroName, award.leagueName, award.teamName,
  ...(award.placements?.flatMap(place => place.holders) || award.holders).flatMap(player => [player.name, String(player.playerId)])]
  .filter(value => value != null).some(value => String(value).toLowerCase().includes(query));

function Holders({ award, sharedLabel = 'Shared record' }) {
  if (!award) return <span className="awards-muted">No qualifying record yet</span>;
  const mostPlayed = ['veteran', 'hero_loyalist'].includes(award.type);
  return <div className="awards-holders">
    {award.shared && <span className="awards-shared">{sharedLabel} · {award.holders.length} players</span>}
    {award.holders.map(player => <div className="awards-holder" key={player.playerId}>
      <Link to={`/player/${player.playerId}`}>{player.name}</Link>
      {award.type !== 'champion' && <span>{mostPlayed ? `${number(player.games)} games` : `${player.winRate}% win rate`}
        <small>{number(player.wins)}W – {number(player.games - player.wins)}L{!mostPlayed && ` · ${number(player.games)} games`}</small></span>}
    </div>)}
  </div>;
}

function LeaguePlacements({ award }) {
  const placements = award.placements || [{ place: 1, holders: award.holders }];
  const labels = { 1: '1st', 2: '2nd', 3: '3rd' };
  return <div className="awards-placements">{placements.map(({ place, holders }) =>
    <div key={place} className="awards-placement" aria-label={`${labels[place]} place`}>
      <span className={`awards-place awards-place-${place}`}>{labels[place]}</span>
      <Holders award={{ ...award, holders, shared: holders.length > 1 }} sharedLabel={`Tied for ${labels[place]}`} />
    </div>)}
  </div>;
}

export default function AwardsPage() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [category, setCategory] = useState('all'), [search, setSearch] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/awards', { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load awards');
      if (!controller.signal.aborted) { setData(result); setError(''); }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [attempt]);
  const awards = useMemo(() => data?.awards || [], [data]);
  const query = search.trim().toLowerCase();
  const leagueRecords = awards.filter(a => ['winningest', 'veteran'].includes(a.type) && matchesSearch(a, query));
  const champions = awards.filter(a => a.type === 'champion' && matchesSearch(a, query));
  const heroRecords = useMemo(() => {
    const rows = new Map();
    for (const award of awards) if (award.heroId) {
      if (!rows.has(award.heroId)) rows.set(award.heroId, { id: award.heroId, name: String(award.heroName ?? '') });
      rows.get(award.heroId)[award.type] = award;
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [awards]);
  const heroes = heroRecords.filter(hero => [hero.hero_specialist, hero.hero_loyalist].some(a => a && matchesSearch(a, query)));
  const visibleCount = (['all', 'league'].includes(category) ? leagueRecords.length : 0)
    + (['all', 'heroes'].includes(category) ? heroes.length : 0) + (['all', 'champion'].includes(category) ? champions.length : 0);
  return <div className="ui-page awards-page">
    <header className="awards-heading"><div className="awards-title"><Trophy size={30} aria-hidden="true" /><h1>Awards</h1></div>
      <p>League champions and the players who hold our all-time records.</p></header>
    <div className="ui-tabs awards-tabs" role="group" aria-label="Award category">{categories.map(([key, label]) =>
      <button type="button" key={key} className="ui-tab" aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}</div>
    <div className="awards-filters"><label htmlFor="awards-search">Search awards, heroes or players<input id="awards-search" type="search"
      placeholder="Award, hero, player name or account ID" value={search} onChange={e => setSearch(e.target.value)} /></label>
    </div>
    {!data && !error ? <p role="status">Loading awards...</p> : error ? <div className="ui-panel" role="alert"><p>{error}</p>
      <button type="button" onClick={() => { setError(''); setAttempt(n => n + 1); }}>Retry</button></div> : <>
      {!visibleCount && <p className="ui-panel">{awards.length ? 'No awards match these filters.' : 'No qualifying awards yet. Records appear automatically as league results are recorded.'}</p>}
      {['all', 'league'].includes(category) && leagueRecords.length > 0 && <section aria-labelledby="league-records-heading"><h2 id="league-records-heading">League records</h2>
        <div className="awards-record-grid">{leagueRecords.map(award => <article className="ui-panel awards-record" key={award.id}>
          <h3><Award size={22} aria-hidden="true" />{award.title}</h3><p className="awards-muted">{award.type === 'winningest'
            ? `Highest overall win rate · minimum ${award.minimumGames} games` : 'Most league games played · no minimum'}</p><LeaguePlacements award={award} />
        </article>)}</div></section>}
      {['all', 'heroes'].includes(category) && heroes.length > 0 && <section className="ui-panel awards-hero-panel" aria-labelledby="hero-records-heading">
        <h2 id="hero-records-heading">Hero records</h2><p className="awards-muted">All seasons combined. Tied leaders share the award; each holder’s own record is shown.</p>
        <div className="awards-table-wrap"><table><thead><tr><th scope="col">Hero</th><th scope="col">Hero Specialist<small>Highest win rate · minimum {data.criteria.allTimeHeroGames} games</small></th>
          <th scope="col">Hero Loyalist<small>Most games played · no minimum</small></th></tr></thead><tbody>{heroes.map(hero => <tr key={hero.id}>
            <th scope="row"><HeroDisplay heroId={hero.id} heroName={hero.name} iconSize={32} /></th>
            <td><Holders award={hero.hero_specialist} /></td><td><Holders award={hero.hero_loyalist} /></td></tr>)}</tbody></table></div>
      </section>}
      {['all', 'champion'].includes(category) && champions.length > 0 && <section aria-labelledby="champions-heading"><h2 id="champions-heading">League champions</h2>
        <div className="awards-champions-grid">{champions.map(award => <article className="ui-panel awards-champion" key={award.id}>
          <h3><Trophy size={22} aria-hidden="true" /><Link to={`/league/${award.leagueId}`}>{award.leagueName}</Link></h3>
          <Link className="awards-team" to={`/team/${award.teamId}`}>{award.teamName}</Link><Holders award={award} />
        </article>)}</div></section>}
      <PlayerAwardsCriteria criteria={data.criteria} />
    </>}
  </div>;
}
