import { useState } from 'react';
import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';
import { useReport, ReportState, Panel, MetricGrid, Metric, clock, fmt } from './PerformanceUI';
import { PerformanceFilters, Coverage, PerformanceNotes, PerformanceValue, CategoryTabs, PagedPerformanceTable,
  statColumns, farming, combat, support, defaultFilters, filterQuery } from './ExpandedPerformanceUI';

function GameLink({ row }) { return <Link to={`/match/${row.matchId}`}>{row.radiant} vs {row.dire}</Link>; }
export default function LeaguePerformance({ leagueId }) {
  const [filters, setFilters] = useState(defaultFilters), [section, setSection] = useState('teams');
  const [category, setCategory] = useState('economy'), [playerCategory, setPlayerCategory] = useState('farming');
  const [minute, setMinute] = useState(10), [minimum, setMinimum] = useState(5), [search, setSearch] = useState('');
  const report = useReport(`/api/leagues/${leagueId}/performance?${filterQuery(filters)}`);
  const playerKeys = playerCategory === 'farming' ? farming : playerCategory === 'combat' ? combat : support;
  const teamKeys = category === 'economy' ? [`gold${minute}`, `xp${minute}`] : category === 'conversion' ? [`ahead${minute}`, `behind${minute}`]
    : category === 'objectives' ? ['firstTower', 'firstRoshan', 'roshanShare', 'firstTowerTime', 'firstRoshanTime']
      : ['wards10', 'dewards10', 'stacks10', 'damagePerMinute', 'healingPerMinute'];
  const term = search.trim().toLowerCase();
  const filteredPlayers = (report.data?.players || []).filter(p => p.games >= minimum && `${p.name} ${p.teamName}`.toLowerCase().includes(term));
  const eligiblePlayers = new Set(filteredPlayers.map(p => p.playerId)).size;
  return <div className="performance-report expanded-performance">
    <PerformanceFilters filters={filters} onChange={value => { setFilters(value); setMinute(10); }} patches={report.data?.options.patches} showSeason={false} />
    <ReportState report={report}>{data => <>
      <Coverage coverage={data.coverage} unknownStages={data.unknownStages} />
      <Panel title="Season overview"><MetricGrid>
        <Metric label="Average duration" metric={data.summary.duration} time showSamples={false} />
        <Metric label="Kills / game" metric={data.summary.kills} showSamples={false} />
        <Metric label="Radiant win rate" metric={data.summary.radiantWins} suffix="%" showSamples={false} />
        <Metric label="Dire win rate" metric={data.summary.direWins} suffix="%" showSamples={false} />
        <Metric label="Average First tower timing" metric={data.summary.firstTowerTime} time showSamples={false} />
        <Metric label="Average First Roshan timing" metric={data.summary.firstRoshanTime} time showSamples={false} />
      </MetricGrid></Panel>
      <CategoryTabs value={section} onChange={value => { setSection(value); setSearch(''); }} options={[
        ['teams', 'Teams'], ['players', 'Players'], ['heroes', 'Hero trends'], ['games', 'Notable games']]} />
      {(section === 'players' || section === 'teams') && <div className="performance-controls">
        <label>Search<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={section === 'teams' ? 'Team name' : 'Player or team name'} /></label>
        <label>Minimum games<select value={minimum} onChange={e => setMinimum(Number(e.target.value))}>{[1, 5, 10, 20].map(n => <option key={n} value={n}>{n} games</option>)}</select></label>
      </div>}
      {section === 'teams' && <Panel title="Team comparison">
        <CategoryTabs value={category} onChange={setCategory} options={[
          ['economy', 'Economy'], ['conversion', 'Converting the game'], ['objectives', 'Objectives'], ['support', 'Contributions']]} />
        {['economy', 'conversion'].includes(category) && <div className="performance-controls"><label>Checkpoint<select value={minute} onChange={e => setMinute(Number(e.target.value))}>
          {(data.checkpointMinutes.length ? data.checkpointMinutes : [10, 20]).map(n => <option key={n} value={n}>{n} minutes</option>)}
        </select></label></div>}
        <PagedPerformanceTable key={`teams:${category}`} rows={data.teams.filter(t => t.games >= minimum && t.name.toLowerCase().includes(term))} columns={[
          { key: 'name', label: 'Team', render: t => <Link to={`/team/${t.teamId}`}>{t.name}</Link> }, { key: 'games', label: 'Games' },
          ...statColumns(['winRate', ...teamKeys], { labels: { [`gold${minute}`]: `Gold advantage @${minute}`, [`xp${minute}`]: `XP advantage @${minute}`,
            [`ahead${minute}`]: `Win % ahead @${minute}`, [`behind${minute}`]: `Win % behind @${minute}` } }),
          { key: 'comebacks', label: '10K comeback wins' }, { key: 'leadsLost', label: '10K leads lost' }
        ].map(c => c.key.startsWith('ahead') || c.key.startsWith('behind') ? { ...c, render: row => <PerformanceValue metric={row[c.key]} percentile={row.percentiles?.[c.key]} percent /> } : c)} />
        <p className="performance-note">These comparisons use enriched games. Ahead/behind refers to gold advantage; tied gold and unknown results are excluded. Checkpoints only count games reaching that time. Earlier objective timing receives a higher percentile.</p>
      </Panel>}
      {section === 'players' && <Panel title={<>Player comparison <small className="performance-comparison-count">{eligiblePlayers} eligible {eligiblePlayers === 1 ? 'player' : 'players'}</small></>}>
        <CategoryTabs value={playerCategory} onChange={setPlayerCategory} options={[
          ['farming', 'Farming'], ['combat', 'Combat'], ['support', 'Support']]} />
        <PagedPerformanceTable key={`players:${playerCategory}`} rows={filteredPlayers} columns={[
          { key: 'name', label: 'Player / team', render: p => <><Link to={`/player/${p.playerId}`}>{p.name}</Link><small className="performance-record-team">
            {p.teamId ? <Link to={`/team/${p.teamId}`}>{p.teamName}</Link> : p.teamName}</small></> },
          { key: 'games', label: 'Games' }, ...statColumns(['winRate', ...playerKeys], { compactPercentile: true })
        ]} />
        <p className="performance-note">The header counts unique players matching the search and minimum-games filters. Each player's stats remain separate by team, including stand-in appearances.
          Percentiles require five eligible games per statistic; hover a percentile for its comparison pool. Search and minimum-games controls only hide rows.</p>
      </Panel>}
      {section === 'heroes' && <Panel title="Hero trends">
        <p className="performance-note">{data.draft.playedGames} games with known lineups · {data.draft.completeDrafts} complete drafts.
          Played heroes count even without a draft; bans and Pick/Ban % use complete drafts only.</p>
        <PagedPerformanceTable rows={data.draft.heroes} initialSort="picks" columns={[
          { key: 'name', label: 'Hero', render: h => <HeroDisplay heroId={h.heroId} heroName={h.name} /> },
          { key: 'picks', label: 'Picks' }, { key: 'bans', label: 'Bans' },
          ...statColumns(['pickRate', 'banRate', 'contestRate', 'winRate'], { percentile: false })
        ]} />
      </Panel>}
      {section === 'games' && <>
        <Panel title="Biggest comeback wins"><PagedPerformanceTable rows={data.notable.comebacks} rowKey="matchId" initialSort="comeback" columns={[
          { key: 'matchId', label: 'Match', render: row => <GameLink row={row} /> }, { key: 'comeback', label: 'Gold deficit overcome' },
          { key: 'duration', label: 'Duration', render: row => clock(row.duration) }
        ]} /></Panel>
        <div className="performance-columns">
          <Panel title="Smallest gold gap at the finish"><PagedPerformanceTable rows={data.notable.closest} rowKey="matchId" initialSort="finalLead" initialDirection="asc" columns={[
            { key: 'matchId', label: 'Match', render: row => <GameLink row={row} /> }, { key: 'finalLead', label: 'Final gold gap' }
          ]} /><p className="performance-note">Last recorded gold sample within one minute of the finish.</p></Panel>
          <Panel title="Longest games"><PagedPerformanceTable rows={data.notable.longest} rowKey="matchId" initialSort="duration" columns={[
            { key: 'matchId', label: 'Match', render: row => <GameLink row={row} /> }, { key: 'duration', label: 'Duration', render: row => clock(row.duration) }
          ]} /></Panel>
        </div>
        {[['damage', 'Hero damage / min'], ['healing', 'Healing / min'], ['farming', 'Last hits @10']].map(([key, title]) => <Panel key={key} className="league-standout-performance" title={`Standout performances: ${title}`}>
          <PagedPerformanceTable rows={data.notable[key]} rowKey="matchId" initialSort="value" columns={[
            { key: 'name', label: 'Player', render: p => <Link to={`/player/${p.playerId}`}>{p.name}</Link> },
            { key: 'heroName', label: 'Hero', className: 'performance-cell-left', render: p => <HeroDisplay heroId={p.heroId} heroName={p.heroName} /> },
            { key: 'value', label: title, render: p => fmt(p.value) }, { key: 'matchId', label: 'Match', render: p => <Link to={`/match/${p.matchId}`}>{p.matchId}</Link> }
          ]} /></Panel>)}
      </>}
      <PerformanceNotes><p className="performance-note">Team/player comparisons use enriched matches. Overall results, draft presence and game duration can include older matches awaiting enrichment.
        Stage filters use saved series stages or league stage boundaries; unknown stages are not guessed. First-objective timing ranks require five recorded first-objective events for each team.</p></PerformanceNotes>
    </>}</ReportState>
  </div>;
}
