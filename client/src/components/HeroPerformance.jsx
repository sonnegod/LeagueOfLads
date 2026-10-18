import { useState } from 'react';
import { Link } from 'react-router-dom';
import items from '@dota-items';
import { useReport, ReportState, Panel, MetricGrid, Metric, ReportTable, clock } from './PerformanceUI';
import { PerformanceFilters, Coverage, PerformanceNotes, PerformanceValue, CategoryTabs, PagedPerformanceTable,
  statColumns, farming, combat, support, filterQuery } from './ExpandedPerformanceUI';

const itemByKey = new Map(Object.values(items).map(item => [item.key, item]));
function ItemLabel({ itemKey }) {
  const item = itemByKey.get(itemKey), name = item?.name || itemKey.replaceAll('_', ' ');
  return <span className="performance-item-label">{item?.image && <img src={`https://cdn.steamstatic.com${item.image}`} alt="" loading="lazy"
    onError={e => { e.currentTarget.style.display = 'none'; }} />}{name}</span>;
}

export default function HeroPerformance({ heroId }) {
  const [filters, setFilters] = useState({ leagueId: 'all', patchId: 'all' }), [category, setCategory] = useState('farming'), [minimum, setMinimum] = useState(5);
  const report = useReport(`/api/hero/${heroId}/performance?${filterQuery(filters)}`);
  const keys = category === 'farming' ? farming : category === 'combat' ? combat : support;
  return <div className="performance-report expanded-performance">
    <PerformanceFilters filters={filters} onChange={setFilters} patches={report.data?.options.patches} showStage={false} />
    <ReportState report={report}>{data => <>
      <Coverage coverage={data.coverage} />
      <Panel title="Hero performance"><p className="performance-note"><PerformanceValue metric={data.record.winRate} percent /> win rate · {data.record.wins} wins · {data.record.losses} losses.
        {data.record.games > data.record.resolved && ` ${data.record.games - data.record.resolved} results are unknown.`}
      </p>
      </Panel>
      <Panel title="Players on this hero">
        <div className="performance-controls"><label>Minimum games<select value={minimum} onChange={e => setMinimum(Number(e.target.value))}>
          {[1, 5, 10, 20].map(n => <option key={n} value={n}>{n} games</option>)}</select></label></div>
        <CategoryTabs value={category} onChange={setCategory} options={['farming', 'combat', 'support'].map(k => [k, k[0].toUpperCase() + k.slice(1)])} />
        <PagedPerformanceTable rows={data.players.filter(p => p.games >= minimum)} columns={[
          { key: 'name', label: 'Player', render: p => <Link to={`/player/${p.playerId}`}>{p.name}</Link> },
          { key: 'games', label: 'Games' }, ...statColumns(['winRate', ...keys])]} />
        <p className="performance-note">Player percentiles compare averages on this hero; different roles can still affect these numbers. Changing the minimum hides rows without changing the comparison pool.</p>
      </Panel>
      <div className="performance-columns performance-breakdowns">
        <Panel title="Draft presence">
          <p className="performance-note">{data.draft.playedGames} games with known played lineups · {data.draft.completeDrafts} complete recorded drafts.</p>
          <MetricGrid>{[['pickRate', 'Pick %'], ['banRate', 'Ban %'], ['contestRate', 'Pick/Ban %']].map(([key, label]) =>
            <Metric key={key} label={label} metric={data.draft[key]} suffix="%" colorPercentage={false} showSamples={false} />)}</MetricGrid>
          <p className="performance-note">Picks use actual played heroes. Bans, Pick/Ban % and phases use complete drafts; a played remake without a draft still counts as a pick.</p>
          <ReportTable centerStats rows={data.draft.phases} initialSort="actions" columns={[
            { key: 'phase', label: 'Phase' }, { key: 'actions', label: 'Actions' },
            { key: 'rate', label: 'Drafts %', value: p => p.rate.value, render: p => <PerformanceValue metric={p.rate} percent colorPercentage={false} /> },
            { key: 'winRate', label: 'Win % when picked', value: p => p.winRate.value, render: p => <PerformanceValue metric={p.winRate} percent /> }
          ]} />
        </Panel>
        <Panel title="Results by patch"><ReportTable centerStats rows={data.patches} columns={[
          { key: 'name', label: 'Patch' }, { key: 'games', label: 'Games' }, { key: 'wins', label: 'Wins' }, ...statColumns(['winRate'], { percentile: false })
        ]} /></Panel>
      </div>
      <Panel title="Common items & purchase timing">
        <p className="performance-note">Complete purchase logs are available for {data.purchaseCoverage} of {data.coverage.enriched} enriched games.
          Timings use the first recorded purchase per item per game. Recipes, pregame purchases and events after match end are excluded; these are purchases, not final inventories.</p>
        <PagedPerformanceTable rows={data.items} columns={[
          { key: 'key', label: 'Item', render: p => <ItemLabel itemKey={p.key} /> }, { key: 'games', label: 'Games purchased' },
          { key: 'timing', label: 'Median first purchase', value: p => p.timing.value, render: p => clock(p.timing.value) },
          ...statColumns(['winRate'], { percentile: false })
        ]} />
        <p className="performance-note">Purchase win rates describe those games; they do not establish that buying the item caused the result.</p>
      </Panel>
      <PerformanceNotes><p className="performance-note">Overall results and draft statistics use recorded played games, including games awaiting enrichment.
        Player comparisons and item timings use imported data. Denies are final-game totals; checkpoint deny counts are not stored.</p></PerformanceNotes>
    </>}</ReportState>
  </div>;
}
