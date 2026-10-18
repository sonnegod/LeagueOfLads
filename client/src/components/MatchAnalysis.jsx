import { useState } from 'react';
import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';
import { useReport, ReportState, Panel, TimelineChart, fmt, clock, ReportTable } from './PerformanceUI';
import items from '@dota-items';
// Validated generated catalog, with the bundled snapshot as a build-time fallback.

const itemByKey = new Map(Object.values(items).map(item => [item.key, item]));
const itemName = key => itemByKey.get(key)?.name || key.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

export default function MatchAnalysis({ matchId, section, initialPlayerId }) {
  const report = useReport(`/api/matches/${matchId}/analysis`);
  return <ReportState report={report}>{data => !data.available
    ? <Panel title="Extended match analysis"><p className="performance-message">Extended data has not been loaded for this match. The original scoreboard is still available.</p></Panel>
    : <LoadedAnalysis key={matchId} data={data} section={section} initialPlayerId={initialPlayerId} />}</ReportState>;
}

function LoadedAnalysis({ data, section, initialPlayerId }) {
  const eventsReport = useReport(section === 'gameflow' ? `/api/matches/${data.match.MatchId}/analysis/events` : null);
  const [hoveredEvent, setHoveredEvent] = useState(null), [focusedEvent, setFocusedEvent] = useState(null);
  const [hiddenEvents, setHiddenEvents] = useState([]);
  const activeEvent = hoveredEvent ?? focusedEvent;
  const { match, objectives } = data;
  const events = [...objectives, ...(eventsReport.data?.deaths || [])].sort((a, b) => a.time - b.time);
  const teamName = side => side === 0 ? match.RadiantTeamName : side === 1 ? match.DireTeamName : 'Team unavailable';
  const points = data.timeline.map(p => ({ time: p.TimeSeconds, gold: p.RadiantGoldAdvantage, xp: p.RadiantXpAdvantage }));
  return <div className="performance-report">
    <p className="performance-coverage">{match.Status === 'partial' ? 'Some extended sections are unavailable.' : 'Extended match data available.'} Missing values are shown as —.</p>
    {section === 'gameflow' && <div className="match-flow-layout">
      <Panel title="Game flow">
        <div className="performance-chart-event-controls" aria-label="Chart events">{[['death', 'Hero deaths'], ['tower', 'Towers'], ['roshan', 'Roshan']].map(([key, label]) =>
          <button type="button" key={key} aria-pressed={!hiddenEvents.includes(key)} onClick={() => setHiddenEvents(old => old.includes(key) ? old.filter(k => k !== key) : [...old, key])}>{label}</button>)}</div>
        <TimelineChart points={points} series={[
          { key: 'gold', label: 'Gold advantage', color: '#facc15' },
          { key: 'xp', label: 'XP advantage', color: '#60a5fa' },
        ]} markers={events.filter(o => (['death', 'tower', 'roshan'].includes(o.category) && !hiddenEvents.includes(o.category)) || o.index === activeEvent)}
          activeMarkerId={activeEvent} onMarkerHover={setHoveredEvent} onMarkerFocus={setFocusedEvent}
          endTime={match.Duration} signed label="Team gold and XP advantage over game time" />
        <p className="performance-note">Above zero favors <strong>{match.RadiantTeamName}</strong>; below zero favors <strong>{match.DireTeamName}</strong>. A killed hero appears on the opposing side: Dire heroes at the top, Radiant heroes at the bottom. Tower and Roshan icons sit on the side credited with the event. Events within 30 seconds of a stack’s first event align in one column. Hover an icon or event below for its exact time. Dots on the curves show the selected time.</p>
        {eventsReport.loading && <p className="performance-note" role="status">Loading hero death events…</p>}
        {eventsReport.error && <p className="performance-note" role="alert">Hero death events could not be loaded. <button type="button" onClick={eventsReport.retry}>Retry</button></p>}
        {eventsReport.data && <p className="performance-note">{eventsReport.data.available ? 'Hero deaths reflect recorded hero kills; deaths to creeps or other unrecorded sources may be absent.' : 'Individual hero death times were not recorded for this match.'}</p>}
      </Panel>
      <Panel title="Objectives & key events" className="match-flow-events">
        {events.length ? <ol className="performance-events">{events.map(event => <li key={event.index} tabIndex={0}
          data-event-index={event.index} data-active={activeEvent === event.index}
          onPointerEnter={() => setHoveredEvent(event.index)} onPointerLeave={() => setHoveredEvent(null)}
          onFocus={() => setFocusedEvent(event.index)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusedEvent(null); }}>
          <time>{clock(event.time)}</time><span className="match-flow-event-label">{event.heroId && <HeroDisplay heroId={event.heroId} iconSize={22} link={false} showName={false} />}{event.label}</span>
          <div className="match-flow-event-meta"><small className={`performance-side-${event.teamSide}`}>{teamName(event.teamSide)}</small>
            {event.playerId != null && <Link to={`/player/${event.playerId}`}>{data.players.find(p => p.PlayerId === event.playerId)?.PlayerName || `Player ${event.playerId}`}</Link>}</div>
        </li>)}</ol> : <p className="performance-message">{data.sections.objectives?.available ? 'No objective events recorded.' : 'Objective data is unavailable.'}</p>}
      </Panel>
    </div>}
    {section === 'economy' && <PlayerEconomy data={data} />}
    {section === 'items' && <MatchItems data={data} initialPlayerId={initialPlayerId} />}
    {section === 'fights' && <FightAnalysis match={match} />}
  </div>;
}

function PlayerEconomy({ data }) {
  const [metric, setMetric] = useState('Gold');
  const colors = ['#4fd6a3', '#facc15', '#60a5fa', '#c084fc', '#fb923c', '#ff8b8b', '#22d3ee', '#f472b6', '#a3e635', '#e2e8f0'];
  const series = data.players.map((p, i) => ({ key: String(p.PlayerId), label: p.PlayerName,
    description: `${p.PlayerName} · ${p.HeroName}`, color: colors[i % colors.length],
    legendLabel: <><HeroDisplay heroId={p.HeroId} heroName={p.HeroName} iconSize={24} link={false} showName={false} /><span>{p.PlayerName}</span></> }));
  const points = new Map();
  for (const p of data.playerTimeline || []) {
    if (!points.has(p.TimeSeconds)) points.set(p.TimeSeconds, { time: p.TimeSeconds });
    points.get(p.TimeSeconds)[String(p.PlayerId)] = p[metric];
  }
  const metricName = metric === 'Gold' ? 'Gold earned' : metric === 'Experience' ? 'Experience' : 'Last hits';
  return <Panel title="Player economy">
      <div className="ui-tabs" aria-label="Player economy statistic">{[['Gold', 'Gold earned'], ['Experience', 'XP'], ['LastHits', 'Last hits']].map(([key, label]) =>
        <button type="button" className="ui-tab" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>{label}</button>)}</div>
      <TimelineChart points={[...points.values()].sort((a, b) => a.time - b.time)} series={series} label={`${metricName} by player`} />
      <p className="performance-note">Select players in the legend to show or hide their lines. Your selection carries across gold, XP and last hits. Gold earned is cumulative income, not net worth.</p>
    </Panel>;
}

function MatchItems({ data, initialPlayerId }) {
  const [playerId, setPlayerId] = useState(String(initialPlayerId || data.players[0]?.PlayerId || ''));
  const [limit, setLimit] = useState(50);
  const report = useReport(playerId ? `/api/matches/${data.match.MatchId}/analysis/players/${playerId}` : null);
  const player = data.players.find(p => String(p.PlayerId) === playerId);
  return <>
    <FinalInventories data={data} />
    <div className="performance-controls"><label>Purchase timeline player<select value={playerId} onChange={event => {
      setPlayerId(event.target.value); setLimit(50);
    }}>{data.players.map(p => <option key={p.PlayerId} value={p.PlayerId}>{p.PlayerName} · {p.HeroName}</option>)}</select></label></div>
    {player && <p className="performance-coverage"><HeroDisplay heroId={player.HeroId} heroName={player.HeroName} />
      <Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link> · {data.match.PatchKey || 'Patch unavailable'}</p>}
    <ReportState report={report}>{details => <>
      <Panel title="Purchase timeline">
        {details.purchases.length ? <>
          <ol className="performance-events">{details.purchases.slice(0, limit).map(p => <li key={p.EventIndex}>
            <time>{clock(p.TimeSeconds)}</time><span>{itemName(p.ItemKey)}</span>
          </li>)}</ol>
          {limit < details.purchases.length && <button type="button" onClick={() => setLimit(n => n + 100)}>Show more ({details.purchases.length - limit} remaining)</button>}
        </> : <p className="performance-message">{data.sections.purchases?.players === 10 ? 'No purchase events recorded for this player.' : 'Purchase events are unavailable.'}</p>}
      </Panel>
    </>}</ReportState>
  </>;
}

function FinalInventories({ data }) {
  const report = useReport(`/api/matches/${data.match.MatchId}/analysis/inventories`);
  const groups = [0, 1, null].map(side => ({ side, players: data.players.filter(p => p.TeamSide === side) })).filter(g => g.players.length);
  return <Panel title="Final inventories"><ReportState report={report}>{details => <div className="performance-team-inventories">
    {groups.map(({ side, players }) => <section key={side ?? 'unknown'} aria-label={side === 0 ? data.match.RadiantTeamName : side === 1 ? data.match.DireTeamName : 'Side unavailable'}>
      <h3 className={`performance-side-${side}`}>{side === 0 ? data.match.RadiantTeamName : side === 1 ? data.match.DireTeamName : 'Side unavailable'}</h3>
      <div className="performance-inventory-row-scroll"><div className="performance-inventory-row">
        {players.map(player => {
          const inventory = details.players.find(p => p.playerId === player.PlayerId)?.inventory;
          return <article key={player.PlayerId} className="performance-inventory-player">
            <header><Link to={`/player/${player.PlayerId}`} title={player.PlayerName}>{player.PlayerName}</Link>
              <HeroDisplay heroId={player.HeroId} heroName={player.HeroName} iconSize={24} /></header>
            {inventory ? <Inventory inventory={inventory} /> : <p className="performance-message">Final inventory was not recorded.</p>}
          </article>;
        })}
      </div></div>
    </section>)}
  </div>}</ReportState></Panel>;
}

function Inventory({ inventory }) {
  return <div className="performance-inventory">
    <div className="performance-inventory-main">
      <p className="performance-inventory-label">Items</p>
      <div className="performance-inventory-grid" role="group" aria-label="Main inventory">
        {Array.from({ length: 6 }, (_, index) => <InventorySlot key={index} id={inventory.items[index]} label={`Item slot ${index + 1}`} />)}
      </div>
      <p className="performance-inventory-label">Backpack</p>
      <div className="performance-inventory-grid performance-inventory-backpack" role="group" aria-label="Backpack">
        {Array.from({ length: 3 }, (_, index) => <InventorySlot key={index} id={inventory.backpack[index]} label={`Backpack slot ${index + 1}`} />)}
      </div>
    </div>
    <div className="performance-inventory-neutral">
      <p className="performance-inventory-label">Neutral</p>
      <InventorySlot id={inventory.neutral} label="Neutral item" round />
    </div>
  </div>;
}

function InventorySlot({ id, label, round = false }) {
  const item = items[id], name = id == null ? 'Not recorded' : id === 0 ? 'Empty slot' : item?.name || `Item ${id}`;
  return <span className={`performance-item${id == null || id === 0 ? ' performance-item--empty' : ''}${round ? ' performance-item--neutral' : ''}`}
    role="img" aria-label={`${label}: ${name}`} title={name} tabIndex={0}>
    <span className="performance-item-fallback" aria-hidden="true">{id == null ? '?' : id === 0 ? '—' : name}</span>
    {item?.image && <img src={`https://cdn.cloudflare.steamstatic.com${item.image}`} alt="" loading="lazy"
      onError={event => { event.currentTarget.style.display = 'none'; }} />}
  </span>;
}

function FightAnalysis({ match }) {
  const report = useReport(`/api/matches/${match.MatchId}/analysis/fights`);
  return <ReportState report={report}>{data => !data.available
    ? <Panel title="Teamfights"><p className="performance-message">Teamfight data is unavailable.</p></Panel>
    : !data.fights.length ? <Panel title="Teamfights"><p className="performance-message">No teamfights were recorded.</p></Panel>
      : <>
        <FightOverview fights={data.fights} match={match} />
        <Panel title="Fight breakdowns">
          <p className="performance-note fight-intro">Compare death trades, resources and contributions across each recorded fight window. Gold and XP include all gains in that window, including farming. Fewer deaths and a gold edge can favor different teams.</p>
          {data.fights.map(fight => <FightBreakdown key={fight.index} fight={fight} match={match} />)}
        </Panel>
      </>}
  </ReportState>;
}

const fightTeam = (match, side) => side === 0 ? match.RadiantTeamName : side === 1 ? match.DireTeamName : 'Unknown team';
const delta = value => value == null ? '—' : `${value > 0 ? '+' : ''}${fmt(value, 0)}`;

function FightEdge({ value, match }) {
  return value == null ? 'Not recorded' : value === 0 ? 'Even' : <span className={`performance-side-${value > 0 ? 0 : 1}`}>
    +{fmt(Math.abs(value), 0)} · {fightTeam(match, value > 0 ? 0 : 1)}</span>;
}

function FightOverview({ fights, match }) {
  const rankedDeaths = fights.filter(f => f.totals.every(t => t.deaths != null)).sort((a, b) =>
    b.totals[0].deaths + b.totals[1].deaths - a.totals[0].deaths - a.totals[1].deaths);
  const biggestGold = fights.filter(f => f.goldEdge != null).sort((a, b) => Math.abs(b.goldEdge) - Math.abs(a.goldEdge))[0];
  const buybacks = fights.every(f => f.totals.every(t => t.buybacks != null))
    ? fights.filter(f => f.totals[0].buybacks + f.totals[1].buybacks > 0).length : null;
  const deadliest = rankedDeaths[0], deathCount = deadliest ? deadliest.totals[0].deaths + deadliest.totals[1].deaths : null;
  const tied = deadliest && rankedDeaths.filter(f => f.totals[0].deaths + f.totals[1].deaths === deathCount).length > 1;
  return <div className="performance-metrics fight-overview">
    <div className="fight-stat"><span>Recorded fights</span><strong>{fights.length}</strong><small>Expand a fight for the full breakdown</small></div>
    <div className="fight-stat"><span>Biggest gold edge</span><strong><FightEdge value={biggestGold?.goldEdge} match={match} /></strong>
      {biggestGold && <small>{clock(biggestGold.start)}–{clock(biggestGold.end)}</small>}</div>
    <div className="fight-stat"><span>Most lethal fight</span><strong>{deathCount == null ? 'Not recorded' : `${fmt(deathCount, 0)} deaths`}</strong>
      {deadliest && <small>{clock(deadliest.start)}–{clock(deadliest.end)}{tied ? ' · tied highest' : ''}</small>}</div>
    <div className="fight-stat"><span>Fights with buybacks</span><strong>{fmt(buybacks, 0)}</strong><small>{buybacks == null ? 'Some fight records are missing' : `Of ${fights.length} recorded fight windows`}</small></div>
  </div>;
}

function FightAftermath({ objectives, match }) {
  const labels = { tower: 'Tower', barracks: 'Barracks', building: 'Building', roshan: 'Roshan', tormentor: 'Tormentor', aegis: 'Aegis' };
  const grouped = new Map();
  for (const event of objectives.after) {
    const key = `${event.category}:${event.teamSide}`;
    if (!grouped.has(key)) grouped.set(key, { key, category: event.category, teamSide: event.teamSide, events: [] });
    grouped.get(key).events.push(event);
  }
  return <span className="fight-aftermath-summary" title={`Recorded within ${clock(objectives.afterSeconds)} after the fight, before the next fight. Timing does not prove causation.`}>
    <span>Afterward:</span>{!objectives.available ? <span>Objective data unavailable</span>
      : objectives.afterSeconds == null ? <span>Aftermath unavailable</span>
        : grouped.size ? [...grouped.values()].map(group => <span key={group.key} className={`fight-objective-tag performance-side-${group.teamSide}`}
          title={group.events.map(event => `${clock(event.time)} · ${event.label} · ${fightTeam(match, event.teamSide)}`).join('\n')}>
          {group.events.length > 1 ? `${group.events.length} ` : ''}{labels[group.category] || 'Objective'}{group.events.length > 1 && ['tower', 'building'].includes(group.category) ? 's' : ''}
        </span>) : <span>{objectives.afterSeconds > 0 ? 'No objective gained' : 'No aftermath window'}</span>}
  </span>;
}

function FightBreakdown({ fight: f, match }) {
  const columns = [
    { key: 'playerName', label: 'Player', render: p => <span className="fight-player"><HeroDisplay heroId={p.heroId} heroName={p.heroName} iconSize={24} showName={false} />
      <Link to={`/player/${p.playerId}`}>{p.playerName}</Link></span> },
    { key: 'teamSide', label: 'Team', render: p => <span className={`performance-side-${p.teamSide}`}>{fightTeam(match, p.teamSide)}</span> },
    { key: 'deaths', label: 'Deaths' }, { key: 'buybacks', label: 'Buybacks' },
    { key: 'damage', label: 'Damage', render: p => <div className="fight-damage-cell">{fmt(p.damage, 0)}
      {p.damageShare != null && <small>{fmt(p.damageShare)}% of team</small>}</div> },
    { key: 'healing', label: 'Healing' },
    ...['gold', 'xp'].map(key => ({ key, label: key === 'gold' ? 'Gold change' : 'XP change', render: p => delta(p[key]) })),
  ].map(column => ({ ...column, className: 'performance-cell-center' }));
  const deathSide = f.deathEdge == null || f.deathEdge === 0 ? null : f.deathEdge > 0 ? 0 : 1;
  const tradeLabel = f.deathEdge == null ? 'Death trade unavailable' : f.deathEdge === 0 ? 'Even death trade' : fightTeam(match, deathSide);
  const damageTotal = f.totals.every(t => t.damage != null) ? f.totals[0].damage + f.totals[1].damage : null;
  const radiantDamageShare = damageTotal > 0 ? f.totals[0].damage / damageTotal * 100 : null;
  return <details className="performance-expand fight-detail">
    <summary><span className="fight-summary-content"><strong>{clock(f.start)}–{clock(f.end)}</strong>
      <span className={`fight-summary-team performance-side-${deathSide}`} title={tradeLabel}>{tradeLabel}</span>
      <span className="fight-summary-deaths" title={`${match.RadiantTeamName} / ${match.DireTeamName} deaths`}>Deaths <b className="performance-side-0">{fmt(f.totals[0].deaths, 0)}</b> / <b className="performance-side-1">{fmt(f.totals[1].deaths, 0)}</b></span>
      <span className="fight-summary-gold" title={f.goldEdge == null ? 'Gold edge unavailable' : f.goldEdge === 0 ? 'Even gold edge' : `Gold edge +${fmt(Math.abs(f.goldEdge), 0)} · ${fightTeam(match, f.goldEdge > 0 ? 0 : 1)}`}>Gold edge <FightEdge value={f.goldEdge} match={match} /></span>
      <small>{fmt(f.duration, 0)}s</small><FightAftermath objectives={f.objectives} match={match} />
    </span></summary>
    <div className="fight-resource-edges">
      <div><span>Gold edge</span><strong><FightEdge value={f.goldEdge} match={match} /></strong></div>
      <div><span>XP edge</span><strong><FightEdge value={f.xpEdge} match={match} /></strong></div>
    </div>
    {radiantDamageShare != null && <div className="fight-damage-comparison">
      <div className="fight-damage-legend"><span className="performance-side-0">{match.RadiantTeamName} · {fmt(radiantDamageShare)}% damage</span>
        <span className="performance-side-1">{match.DireTeamName} · {fmt(100 - radiantDamageShare)}% damage</span></div>
      <div className="fight-damage-bar" role="img" aria-label={`${match.RadiantTeamName}: ${fmt(radiantDamageShare)}% of recorded damage; ${match.DireTeamName}: ${fmt(100 - radiantDamageShare)}%`}>
        <span style={{ width: `${radiantDamageShare}%` }} /><span style={{ width: `${100 - radiantDamageShare}%` }} /></div>
    </div>}
    <div className="fight-detail-columns">
      <div className="performance-table-scroll"><table className="performance-table fight-comparison"><thead><tr><th>In this window</th>
        <th className="performance-side-0">{match.RadiantTeamName}</th><th className="performance-side-1">{match.DireTeamName}</th></tr></thead>
        <tbody>{[['deaths', 'Deaths'], ['buybacks', 'Buybacks'], ['damage', 'Damage'], ['healing', 'Healing'], ['gold', 'Gold change'], ['xp', 'XP change']].map(([key, label]) =>
          <tr key={key}><th scope="row">{label}</th>{f.totals.map((team, side) => <td key={side}>{key === 'gold' || key === 'xp' ? delta(team[key]) : fmt(team[key], 0)}</td>)}</tr>)}</tbody>
      </table></div>
      <div className="fight-casualties"><h3>Recorded deaths &amp; buybacks</h3>{[0, 1].map(side => <div key={side}>
        <strong className={`performance-side-${side}`}>{fightTeam(match, side)}</strong>
        {f.players.filter(p => p.teamSide === side && (p.deaths > 0 || p.buybacks > 0)).map(p => <span key={p.playerId} className="fight-player" title={p.playerName}>
          <HeroDisplay heroId={p.heroId} heroName={p.heroName} iconSize={24} showName={false} />{p.playerName}
          {p.deaths > 0 && <small>{p.deaths} {p.deaths === 1 ? 'death' : 'deaths'}</small>}{p.buybacks > 0 && <small className="fight-buyback">{p.buybacks} {p.buybacks === 1 ? 'buyback' : 'buybacks'}</small>}</span>)}
        {f.totals[side].deaths === 0 && f.totals[side].buybacks === 0 && <span className="performance-note">No deaths or buybacks.</span>}
      </div>)}</div>
    </div>
    <h3 className="fight-player-heading">Player contributions</h3>
    <ReportTable rows={f.players} columns={columns} rowKey="playerId" initialSort="damage" />
  </details>;
}
