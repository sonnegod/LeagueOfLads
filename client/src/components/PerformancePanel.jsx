import { useState } from 'react';
import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';
import LeagueFilter from './LeagueFilter';
import { percentageColor } from '../utils/performanceColors';
import { useReport, ReportState, Panel, Metric, MetricGrid, ReportTable, TimelineChart, fmt, clock } from './PerformanceUI';

const labels = {
  gold10: 'Gold earned @10', xp10: 'XP @10', lh10: 'Last hits @10', gold20: 'Gold earned @20', xp20: 'XP @20', lh20: 'Last hits @20',
  damagePerMinute: 'Hero damage / min', healingPerMinute: 'Healing / min', damageShare: 'Team damage share', networthShare: 'Net worth share',
  killParticipation: 'Kill participation', towerDamagePerMinute: 'Tower damage / min',
  wards10: 'Observers / 10 min', sentries10: 'Sentries / 10 min', dewards10: 'Dewards / 10 min',
  stacks10: 'Stacks / 10 min', stuns10: 'Stun seconds / 10 min', Denies: 'Denies / game', FinalLevel: 'Final level',
};
const metricCell = (metric, suffix = '', reference = 50, showSamples = true) => <span title={`${metric?.samples || 0} eligible games`}
  style={suffix === '%' ? { color: percentageColor(metric?.value, { reference }) } : undefined}>{fmt(metric?.value)}{metric?.value != null ? suffix : ''}
  {showSamples && <small className="performance-sample"> {metric?.samples || 0} GP</small>}</span>;
const shareMetric = key => key === 'damageShare' || key === 'networthShare';
const metricColumns = (keys, { showSamples = true } = {}) => keys.map(key => ({ key, label: labels[key] || key,
  value: row => row[key]?.value, render: row => metricCell(row[key], shareMetric(key) ? '%' : '', shareMetric(key) ? 20 : 50, showSamples) }));

export default function PerformancePanel({ type, id, leagueId, seasons, onLeagueChange }) {
  const [patchId, setPatchId] = useState('all'), [heroId, setHeroId] = useState('all');
  const params = new URLSearchParams({ leagueId: leagueId || 'all', patchId, ...(type === 'player' ? { heroId } : {}) });
  const report = useReport(`/api/${type === 'player' ? 'player' : 'teams'}/${id}/performance?${params}`);
  return <div className="performance-report"><ReportState report={report}>{data => <>
    <div className="performance-controls">
      {onLeagueChange && <label>Season<LeagueFilter leagues={seasons} value={leagueId || 'all'} onChange={onLeagueChange} /></label>}
      <label>Patch<select value={patchId} onChange={event => setPatchId(event.target.value)}>
        <option value="all">All patches</option>{data.patches.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      {type === 'player' && <label>Hero<select value={heroId} onChange={event => setHeroId(event.target.value)}>
        <option value="all">All heroes</option>{data.heroes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select></label>}
      <p className="performance-coverage"><strong>{data.coverage.enriched} enriched games</strong> of {data.coverage.total} recorded games in this selection</p>
    </div>
    {!data.coverage.enriched ? <Panel title="Performance"><p className="performance-message">Extended data is not available for this selection yet. Choose a season with imported matches to explore performance.</p></Panel>
      : type === 'player' ? <PlayerPerformance data={data} /> : <TeamPerformance data={data} />}
    <details className="performance-expand"><summary>How these numbers are calculated</summary>
      <p className="performance-note">Only enriched league games contribute to these reports. Each metric shows its own eligible-game count.
        Missing fields are excluded rather than treated as zero. Checkpoints require a recorded sample and a game that reached that time.
        Rates are averaged per game. Team assignments use match sides and corrected warehouse team IDs, including stand-in appearances.
        These are performance summaries, not roster eligibility or awards.</p>
      <p className="performance-note">Use the patch and hero filters before comparing performances across different metas or heroes.
        Gold earned describes cumulative income, not net worth. Parsed lane information is not a confirmed position assignment.</p>
    </details>
  </>}</ReportState></div>;
}

function PlayerPerformance({ data }) {
  const [trend, setTrend] = useState('lh10');
  const trends = ['lh10', 'gold10', 'xp10', 'lh20', 'gold20', 'xp20', 'damagePerMinute', 'healingPerMinute', 'damageShare', 'wards10', 'sentries10', 'dewards10', 'stacks10', 'stuns10'];
  const columns = [
    { key: 'name', label: 'Hero', render: row => <HeroDisplay heroId={row.key} heroName={row.name} /> },
    { key: 'games', label: 'Games' }, ...metricColumns(['lh10', 'gold10', 'damagePerMinute', 'damageShare', 'wards10', 'dewards10', 'stuns10'], { showSamples: false }),
  ];
  return <>
    <Panel title="Farming checkpoints"><MetricGrid>{['lh10', 'gold10', 'xp10', 'lh20', 'gold20', 'xp20'].map(key =>
      <Metric key={key} label={labels[key]} metric={data.summary[key]} digits={0} percentile={data.percentiles?.[key]} showSamples={false} />)}</MetricGrid></Panel>
    <Panel title="Combat & support contributions"><MetricGrid>{['damagePerMinute', 'healingPerMinute', 'damageShare', 'killParticipation', 'towerDamagePerMinute', 'wards10', 'sentries10', 'dewards10', 'stacks10', 'stuns10', 'Denies'].map(key =>
      <Metric key={key} label={labels[key]} metric={data.summary[key]} suffix={['damageShare', 'killParticipation'].includes(key) ? '%' : ''} percentageReference={key === 'damageShare' ? 20 : 50} percentile={data.percentiles?.[key]} showSamples={false} />)}</MetricGrid>
      <p className="performance-note">Percentiles compare player averages within the selected season, patch and hero. Each metric requires five eligible games per player and at least two qualifying players. Ties share a rank; higher means more of that statistic, with hero and role affecting its interpretation.</p>
    </Panel>
    <Panel title="Recent performance">
      <div className="performance-controls"><label>Statistic<select value={trend} onChange={event => setTrend(event.target.value)}>
        {trends.map(key => <option key={key} value={key}>{labels[key]}</option>)}
      </select></label></div>
      <TimelineChart key={trend} points={[...data.recent].reverse().map((g, index) => ({ time: index + 1, value: g[trend], label: `Match ${g.matchId} · ${g.HeroName}` }))}
        series={[{ key: 'value', label: labels[trend], color: '#60a5fa' }]} label="Recent player performances"
        axisLabel="Recorded games, oldest to newest" formatTime={n => fmt(n, 0)} showLegend={false} showScrubber={false} />
      <p className="performance-note">Up to 30 enriched games. Changing heroes and patches can affect these values.</p>
    </Panel>
    <Panel title="Hero breakdown"><ReportTable centerStats rows={data.byHero} columns={columns} /></Panel>
    <div className="performance-columns performance-breakdowns">
      <Panel title="By patch"><ReportTable centerStats rows={data.byPatch} columns={[
        { key: 'name', label: 'Patch', render: row => row.name }, { key: 'games', label: 'Games' }, ...metricColumns(['lh10', 'damagePerMinute', 'wards10', 'dewards10'], { showSamples: false }),
      ]} /></Panel>
      <Panel title="By team"><ReportTable centerStats rows={data.byTeam} columns={[
        { key: 'name', label: 'Team', render: row => row.key ? <Link to={`/team/${row.key}`}>{row.name}</Link> : row.name },
        { key: 'games', label: 'Games' }, ...metricColumns(['damageShare', 'wards10', 'dewards10'], { showSamples: false }),
      ]} /></Panel>
    </div>
    <Panel title="Notable performances">{data.notable.map(group => <details key={group.key} className="performance-expand">
      <summary>{labels[group.key]}</summary>{group.games.length ? <ul className="performance-examples">{group.games.map(game => <li key={game.matchId}>
        <Link to={`/match/${game.matchId}`}>Match {game.matchId}</Link> · {game.heroName} · <strong>{fmt(game.value)}</strong>
      </li>)}</ul> : <p className="performance-message">No eligible games.</p>}
    </details>)}</Panel>
    <Panel title="Recent game details"><ReportTable centerStats rows={data.recent} rowKey="matchId" initialSort="matchId" columns={[
      { key: 'matchId', label: 'Match', render: row => <Link to={`/match/${row.matchId}`}>{row.matchId}</Link> },
      { key: 'HeroName', label: 'Hero', render: row => <HeroDisplay heroId={row.HeroId} heroName={row.HeroName} /> },
      { key: 'teamName', label: 'Team', render: row => row.teamId ? <Link to={`/team/${row.teamId}`}>{row.teamName}</Link> : row.teamName },
      { key: 'patch', label: 'Patch', render: row => row.patch || '—' },
      ...['lh10', 'gold10', 'damagePerMinute', 'wards10', 'dewards10'].map(key => ({ key, label: labels[key] })),
    ]} /></Panel>
  </>;
}

function TeamPerformance({ data }) {
  return <>
    <Panel title="Early game"><MetricGrid>{[['gold10', 'Gold advantage @10'], ['gold20', 'Gold advantage @20'], ['xp10', 'XP advantage @10'], ['xp20', 'XP advantage @20']].map(([key, label]) =>
      <Metric key={key} label={label} metric={data.summary[key]} digits={0} percentile={data.percentiles?.[key]} showSamples={false} />)}</MetricGrid>
      <p className="performance-note">Positive values favor this team; negative values favor its opponents.</p>
      <p className="performance-note">Percentiles compare team averages and rates within the selected season and patch, requiring five eligible games per metric and at least two qualifying teams. Ties share a rank; earlier first-objective times receive a higher percentile.</p>
    </Panel>
    <Panel title="Converting the game"><MetricGrid>{[['ahead10', 'Win rate when ahead @10'], ['behind10', 'Win rate when behind @10'],
      ['ahead20', 'Win rate when ahead @20'], ['behind20', 'Win rate when behind @20']].map(([key, label]) =>
      <Metric key={key} label={label} metric={data.conversions[key]} suffix="%" percentile={data.percentiles?.[key]} showSamples={false} />)}</MetricGrid>
      <p className="performance-note">Ahead/behind refers to gold advantage</p>
    </Panel>
    <Panel title="Later game checkpoints">
      <ReportTable centerStats rows={(data.checkpoints || []).filter(point => point.minute >= 30)} rowKey="minute" initialSort="minute" initialDirection="asc" columns={[
        { key: 'minute', label: 'Time', render: point => `${point.minute} min` },
        { key: 'gold', label: 'Gold advantage', value: point => point.gold.value, render: point => metricCell(point.gold) },
        { key: 'xp', label: 'XP advantage', value: point => point.xp.value, render: point => metricCell(point.xp) },
        { key: 'ahead', label: 'Win rate when ahead', value: point => point.ahead.value, render: point => metricCell(point.ahead, '%') },
        { key: 'behind', label: 'Win rate when behind', value: point => point.behind.value, render: point => metricCell(point.behind, '%') },
      ]} empty="No recorded checkpoints at 30 minutes or later in this selection." />
      <p className="performance-note">Every 10 minutes where samples are available. Only games that reached that time and recorded a sample contribute; later checkpoints can have fewer games. Positive gold/XP favors this team.</p>
    </Panel>
    <Panel title="Objective control"><MetricGrid>
      <Metric label="First tower" metric={data.objectives.firstTower} suffix="%" percentile={data.percentiles?.firstTower} showSamples={false} />
      <Metric label="First Roshan" metric={data.objectives.firstRoshan} suffix="%" percentile={data.percentiles?.firstRoshan} showSamples={false} />
      <Metric label="Share of Roshan kills" metric={data.objectives.roshanShare} suffix="%" percentile={data.percentiles?.roshanShare} showSamples={false} />
      <Metric label="First-tower timing when taken first" metric={data.objectives.firstTowerTime} time percentile={data.percentiles?.firstTowerTime} showSamples={false} />
      <Metric label="First-Roshan timing when taken first" metric={data.objectives.firstRoshanTime} time percentile={data.percentiles?.firstRoshanTime} showSamples={false} />
    </MetricGrid><p className="performance-note">First-objective rates include games with an identifiable first event. Tower denies are excluded.
      Roshan share counts kills across those games, rather than giving each game equal weight.</p></Panel>
    <Panel title="Team contributions"><MetricGrid>{['wards10', 'dewards10', 'stacks10', 'damagePerMinute', 'healingPerMinute'].map(key =>
      <Metric key={key} label={labels[key]} metric={data.summary[key]} percentile={data.percentiles?.[key]} showSamples={false} />)}</MetricGrid>
    </Panel>
    <Panel title="Damage & support distribution"><ReportTable centerStats rows={data.distribution} rowKey="playerId" columns={[
      { key: 'name', label: 'Player', render: row => <Link to={`/player/${row.playerId}`}>{row.name}</Link> },
      { key: 'games', label: 'Games' }, ...metricColumns(['damageShare', 'networthShare'], { showSamples: false }),
      { key: 'wards', label: 'Observers / game', value: row => row.wards.value, render: row => metricCell(row.wards, '', 50, false) },
      { key: 'stacks', label: 'Stacks / game', value: row => row.stacks.value, render: row => metricCell(row.stacks, '', 50, false) },
    ]} /><p className="performance-note">Net worth share is each player's final net worth divided by their team's final total, averaged across eligible games. All five players need recorded net worth.</p></Panel>
    <div className="performance-columns">{data.notable.map(group => <Panel key={group.key} title={group.key === 'comebacks' ? 'Comeback wins' : 'Leads lost'}>
      <p className="performance-note">{group.key === 'comebacks' ? 'Wins after trailing by at least 10,000 gold.' : 'Losses after leading by at least 10,000 gold.'}</p>
      {group.games.length ? <ul className="performance-examples">{group.games.map(game => <li key={game.matchId}>
        <Link to={`/match/${game.matchId}`}>vs {game.opponent}</Link> · {fmt(group.key === 'comebacks' ? game.worstDeficit : game.largestLead, 0)} gold
      </li>)}</ul> : <p className="performance-message">None in the available games.</p>}
    </Panel>)}</div>
    <Panel title="Game examples">{data.recent.map(game => <details key={game.matchId} className="performance-expand">
      <summary>vs {game.opponent} · {game.won === null ? 'Result unavailable' : game.won ? 'Win' : 'Loss'} · {game.patch || 'Patch unavailable'}
        {' '}· Gold @10: {fmt(game.gold10, 0)}</summary>
      <Link to={`/match/${game.matchId}`}>View match {game.matchId}</Link>
      <MetricGrid>{[['gold10', 'Gold advantage @10'], ['gold20', 'Gold advantage @20'],
        ...(data.checkpoints || []).filter(point => point.minute >= 30 && game[`gold${point.minute}`] != null)
          .map(point => [`gold${point.minute}`, `Gold advantage @${point.minute}`]), ['worstDeficit', 'Lowest gold advantage'],
        ['largestLead', 'Highest gold advantage']].map(([key, label]) => <Metric key={key} label={label}
          metric={{ value: game[key], samples: game[key] == null ? 0 : 1 }} digits={0} showSamples={false} />)}</MetricGrid>
      <p className="performance-note">First tower: {game.firstTower === null ? 'Unavailable' : game.firstTower ? 'This team' : 'Opponent'} ({clock(game.firstTowerTime)}).
        {' '}First Roshan: {game.firstRoshan === null ? 'Unavailable' : game.firstRoshan ? 'This team' : 'Opponent'} ({clock(game.firstRoshanTime)}).</p>
    </details>)}</Panel>
  </>;
}
