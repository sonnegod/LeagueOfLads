import { useState } from 'react';
import LeagueFilter from './LeagueFilter';
import { ReportTable, fmt, clock } from './PerformanceUI';
import { percentageColor } from '../utils/performanceColors';

export const metricLabels = {
  gold10: 'Gold earned @10', gold20: 'Gold earned @20', xp10: 'XP @10', xp20: 'XP @20', lh10: 'Last hits @10', lh20: 'Last hits @20',
  damagePerMinute: 'Hero damage / min', towerDamagePerMinute: 'Tower damage / min', healingPerMinute: 'Healing / min',
  killParticipation: 'Kill participation', damageShare: 'Team damage share', networthShare: 'Net worth share',
  wards10: 'Observers / 10 min', sentries10: 'Sentries / 10 min', dewards10: 'Dewards / 10 min', stacks10: 'Stacks / 10 min',
  stuns10: 'Stun seconds / 10 min', Denies: 'Denies / game', GPM: 'GPM', XPM: 'XPM', Kills: 'Kills', Deaths: 'Deaths', Assists: 'Assists',
  winRate: 'Win %', gold30: 'Gold advantage @30', xp30: 'XP advantage @30',
  firstTower: 'First tower %', firstRoshan: 'First Roshan %', roshanShare: 'Roshan share',
  firstTowerTime: 'Average First tower timing', firstRoshanTime: 'Average First Roshan timing',
  ahead10: 'Win % ahead @10', ahead20: 'Win % ahead @20', behind10: 'Win % behind @10', behind20: 'Win % behind @20',
  pickRate: 'Pick %', banRate: 'Ban %', contestRate: 'Pick/Ban %'
};
export const farming = ['lh10', 'gold10', 'xp10', 'lh20', 'gold20', 'xp20'];
export const combat = ['damagePerMinute', 'towerDamagePerMinute', 'healingPerMinute', 'killParticipation', 'damageShare', 'networthShare'];
export const support = ['wards10', 'sentries10', 'dewards10', 'stacks10', 'stuns10', 'Denies'];
const shares = ['damageShare', 'networthShare'];
const percentages = [...shares, 'killParticipation', 'winRate', 'firstTower', 'firstRoshan', 'roshanShare', 'ahead10', 'ahead20', 'behind10', 'behind20', 'pickRate', 'banRate', 'contestRate'];
const timings = ['firstTowerTime', 'firstRoshanTime'];

export function PercentileText({ percentile, compact = false }) {
  if (!percentile || percentile.value == null) return null;
  return <small className="performance-percentile performance-table-percentile" title={`Percentile out of ${percentile.entities} ${percentile.entity} within the selected filters; at least five eligible games per entry. Ties share a rank.`}>
    <span style={{ color: percentageColor(percentile.value) }}>{fmt(percentile.value, 0)}%</span>{!compact && <> out of {percentile.entities} {percentile.entity}</>}
  </small>;
}

export function PerformanceValue({ metric, percentile, compactPercentile = false, percent = false, time = false, reference = 50, colorPercentage = true }) {
  return <span title={`${metric?.samples || 0} eligible games${percentile?.value == null && percentile ? '; percentile requires five eligible games and two qualifying entries' : ''}`}>
    <span style={percent && colorPercentage ? { color: percentageColor(metric?.value, { reference }) } : undefined}>
      {time ? clock(metric?.value) : fmt(metric?.value)}{percent && metric?.value != null ? '%' : ''}
    </span><PercentileText percentile={percentile} compact={compactPercentile} />
  </span>;
}

export const statColumns = (keys, { percentile = true, compactPercentile = false, labels = {} } = {}) => keys.map(key => ({ key, label: labels[key] || metricLabels[key] || key,
  value: row => row[key]?.value,
  render: row => <PerformanceValue metric={row[key]} percentile={percentile ? row.percentiles?.[key] : undefined}
    compactPercentile={compactPercentile}
    percent={percentages.includes(key)} colorPercentage={!['pickRate', 'banRate', 'contestRate'].includes(key)} time={timings.includes(key)} reference={shares.includes(key) ? 20 : 50} />
}));

export function PerformanceFilters({ filters, onChange, patches = [], showSeason = true, showStage = true }) {
  const change = (key, value) => onChange({ ...filters, [key]: value, ...(key === 'leagueId' ? { patchId: 'all' } : {}) });
  return <div className="performance-controls">
    {showSeason && <label>Season<LeagueFilter value={filters.leagueId} onChange={value => change('leagueId', value)} /></label>}
    <label>Patch<select value={filters.patchId} onChange={e => change('patchId', e.target.value)}>
      <option value="all">All patches</option>{patches.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    {showStage && <label>Stage<select value={filters.stage} onChange={e => change('stage', e.target.value)}>
      <option value="all">All stages</option><option value="regular">Regular season</option><option value="tiebreakers">Tiebreakers</option>
      <option value="playoffs">Playoffs</option><option value="unknown">Unknown stage</option>
    </select></label>}
  </div>;
}

export function Coverage({ coverage, unknownStages = 0 }) {
  return <p className="performance-coverage"><strong>{coverage.enriched} enriched games</strong> of {coverage.total} recorded games in this selection.
    {unknownStages > 0 && <span>{unknownStages} games have no known stage.</span>}</p>;
}

export function PerformanceNotes({ children }) {
  return <details className="performance-expand"><summary>Samples, colors and percentiles</summary>
    <p className="performance-note">Extended metrics use enriched games. Each statistic excludes missing data and checkpoints after a game ended; hover a value for its sample size.
      Percentiles require at least five eligible games per entry and two qualifying entries. They compare averages or rates within the selected filters, including tied entries at a shared rank.
      Red-to-green colors increase with percentages; team damage and net worth shares use a 20% reference. Hero and player roles affect these comparisons.
      Gold earned is cumulative income, not net worth. Stand-in appearances remain included in performance statistics.</p>{children}
  </details>;
}

export function CategoryTabs({ value, onChange, options }) {
  return <div className="ui-tabs performance-subtabs">{options.map(([key, label]) => <button key={key} className="ui-tab" aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>)}</div>;
}

export function PagedPerformanceTable({ rows, ...props }) {
  const [limit, setLimit] = useState(50);
  return <><ReportTable centerStats rows={rows} limit={limit} {...props} />{rows.length > limit &&
    <button type="button" className="performance-more" onClick={() => setLimit(value => value + 50)}>Show more ({rows.length - limit} remaining)</button>}</>;
}

export const filterQuery = filters => new URLSearchParams(filters).toString();
export const defaultFilters = { leagueId: 'all', patchId: 'all', stage: 'all' };
