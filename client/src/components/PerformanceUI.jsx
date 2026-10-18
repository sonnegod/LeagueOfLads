import { useEffect, useRef, useState } from 'react';
import { percentageColor } from '../utils/performanceColors';
import './Performance.css';

export const fmt = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—'
  : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
export const clock = seconds => seconds == null ? '—' : `${seconds < 0 ? '−' : ''}${Math.floor(Math.abs(seconds) / 60)}:${String(Math.floor(Math.abs(seconds) % 60)).padStart(2, '0')}`;

export function useReport(url) {
  const [attempt, setAttempt] = useState(0), [state, setState] = useState({ url: null });
  useEffect(() => {
    if (!url) return undefined;
    const controller = new AbortController();
    setState({ url, loading: true });
    fetch(url, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load report');
      if (!controller.signal.aborted) setState({ url, data, loading: false });
    }).catch(error => { if (!controller.signal.aborted) setState({ url, error: error.message, loading: false }); });
    return () => controller.abort();
  }, [url, attempt]);
  return { ...(state.url === url ? state : { loading: true }), retry: () => setAttempt(n => n + 1) };
}

export function ReportState({ report, children }) {
  if (report.loading) return <p className="performance-message" role="status">Loading performance data…</p>;
  if (report.error) return <div className="performance-message" role="alert">{report.error}{' '}
    <button type="button" onClick={report.retry}>Retry</button></div>;
  return report.data ? children(report.data) : null;
}

export function Metric({ label, metric, suffix = '', digits = 1, time = false, description, percentageReference = 50, percentile, showSamples = true, colorPercentage = true }) {
  const entity = percentile?.entity || (percentile?.teams != null ? 'teams' : 'players');
  const comparison = `${entity} averages and rates in the selected filters`;
  return <div className="performance-metric" title={description ?? (!showSamples ? `${metric?.samples || 0} eligible games` : undefined)}>
    <span>{label}</span><strong style={suffix === '%' && colorPercentage ? { color: percentageColor(metric?.value, { reference: percentageReference }) } : undefined}>
      {time ? clock(metric?.value) : fmt(metric?.value, digits)}{metric?.value != null ? suffix : ''}</strong>
    {showSamples && <small>{metric?.samples || 0} eligible {metric?.samples === 1 ? 'game' : 'games'}</small>}
    {percentile && <small className="performance-percentile" title={`Percentile of ${comparison}. At least ${percentile.minimumGames} eligible games per comparison entry and two qualifying entries required; ties share a rank.${percentile.higherIsBetter === false ? ' Lower values receive a higher percentile.' : ''}`}>
      {percentile.value == null ? 'Percentile unavailable' : <><span style={{ color: percentageColor(percentile.value) }}>{fmt(percentile.value, 0)}%</span> out of {percentile.entities ?? percentile.teams ?? percentile.players} {entity}</>}
    </small>}
  </div>;
}

export function MetricGrid({ children }) { return <div className="performance-metrics">{children}</div>; }
export function Panel({ title, children, className = '' }) {
  return <section className={`performance-panel ${className}`}>{title && <h2>{title}</h2>}{children}</section>;
}

export function ReportTable({ columns, columnGroups, rows, rowKey = 'key', initialSort = 'games', initialDirection = 'desc', centerStats = false, limit = Infinity, empty = 'No eligible games in this selection.' }) {
  const [sort, setSort] = useState({ key: initialSort, direction: initialDirection });
  if (!rows.length) return <p className="performance-message">{empty}</p>;
  const column = columns.find(c => c.key === sort.key);
  const sorted = [...rows].sort((a, b) => {
    const av = column?.value ? column.value(a) : a[sort.key], bv = column?.value ? column.value(b) : b[sort.key];
    if (av == null || bv == null) return av == null && bv == null ? 0 : av == null ? 1 : -1;
    const result = typeof av === 'string' ? av.localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) : av - bv;
    return sort.direction === 'asc' ? result : -result;
  });
  return <div className="performance-table-scroll"><table className={`performance-table${centerStats ? ' performance-table--center-stats' : ''}`}>
    <thead>{columnGroups && <tr className="performance-column-groups">{columnGroups.map((group, index) =>
      <th key={group.label || index} scope="colgroup" colSpan={group.span} aria-hidden={!group.label || undefined}>{group.label}</th>)}</tr>}
    <tr>{columns.map(c => <th key={c.key} className={c.className} scope="col" aria-sort={sort.key === c.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
      {c.sortable === false ? c.label : <button className="detail-sort-button" type="button" title={c.description} onClick={() => setSort(s => ({ key: c.key,
        direction: s.key === c.key && s.direction === 'desc' ? 'asc' : 'desc' }))}>
        {c.label}<span aria-hidden="true">{sort.key === c.key ? sort.direction === 'asc' ? '▲' : '▼' : '↕'}</span>
      </button>}</th>)}</tr></thead>
    <tbody>{sorted.slice(0, limit).map((row, index) => <tr key={`${row[rowKey] ?? index}`}>
      {columns.map(c => {
        const value = c.value ? c.value(row) : row[c.key];
        return <td key={c.key} className={c.className}>{c.render ? c.render(row) : typeof value === 'string' ? value : fmt(value)}</td>;
      })}
    </tr>)}</tbody>
  </table></div>;
}

export function TimelineChart({ points, series, markers = [], activeMarkerId = null, onMarkerHover, onMarkerFocus, endTime = 0, label = 'Progression', signed = false, formatTime = clock, axisLabel = 'Game time', showLegend = true }) {
  const [hidden, setHidden] = useState([]), [cursor, setCursor] = useState(null);
  const [chartWidth, setChartWidth] = useState(760), chartRef = useRef(null);
  const visible = series.filter(s => !hidden.includes(s.key));
  const values = points.flatMap(p => visible.map(s => p[s.key])).filter(v => v != null && Number.isFinite(v));
  const hasData = points.length > 0 && series.some(s => points.some(p => p[s.key] != null && Number.isFinite(p[s.key])));
  useEffect(() => {
    if (!hasData || !chartRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setChartWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, [hasData]);
  if (!hasData) return <p className="performance-message">No timeline samples available.</p>;
  const width = chartWidth, left = 58, right = 18, top = 18, bottom = 36;
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  if (signed) { const extent = Math.max(Math.abs(min), Math.abs(max), 1); min = -extent; max = extent; }
  if (max === min) { min -= 1; max += 1; }
  const end = Math.max(1, endTime || 0, ...points.map(p => p.time));
  // Align same-side events within 30 seconds of the first event into one column.
  // Keep exact source times for hover details and the highlighted event line.
  const iconSize = 22, iconGap = 3, spacing = iconSize + iconGap;
  const placedMarkers = [], laneCounts = [];
  for (const side of [0, 1, null]) {
    const groups = [];
    for (const marker of markers.filter(m => m.time >= 0 && m.time <= end && (m.teamSide ?? null) === side).sort((a, b) => a.time - b.time)) {
      let group = groups.at(-1);
      if (!group || marker.time - group.events[0].time > 30) { group = { events: [] }; groups.push(group); }
      group.events.push(marker);
    }
    for (const group of groups) group.position = left + group.events.reduce((sum, m) => sum + m.time, 0) / group.events.length / end * (width - left - right);
    // Separate neighboring columns without splitting a stack. On narrow screens,
    // move whole stacks inward only when there isn't enough horizontal space.
    if ((groups.length - 1) * spacing <= width - left - right) {
      for (let i = 1; i < groups.length; i++) groups[i].position = Math.max(groups[i].position, groups[i - 1].position + spacing);
      if (groups.length) groups.at(-1).position = Math.min(groups.at(-1).position, width - right);
      for (let i = groups.length - 2; i >= 0; i--) groups[i].position = Math.min(groups[i].position, groups[i + 1].position - spacing);
    }
    const occupied = [];
    for (const group of groups) {
      let startLane = 0;
      while (occupied.some(old => Math.abs(old.position - group.position) < spacing - .01
        && startLane < old.end && startLane + group.events.length > old.start)) startLane++;
      occupied.push({ position: group.position, start: startLane, end: startLane + group.events.length });
      group.events.forEach((m, index) => placedMarkers.push({ ...m, chartX: group.position, lane: startLane + index }));
      laneCounts.push(startLane + group.events.length);
    }
  }
  const height = Math.max(230, Math.min(markers.length ? 460 : 340, width * (markers.length ? .4 : .32)),
    markers.length ? (Math.max(1, ...laneCounts) * spacing + 50) * 2 + bottom : 0);
  const x = t => left + t / end * (width - left - right), y = v => height - bottom - (v - min) / (max - min) * (height - top - bottom);
  const index = cursor == null ? points.length - 1 : Math.min(cursor, points.length - 1), selected = points[index];
  const path = key => { let pen = false; return points.map(p => {
    if (p[key] == null || !Number.isFinite(p[key])) { pen = false; return ''; }
    const command = `${pen ? 'L' : 'M'}${x(p.time)},${y(p[key])}`; pen = true; return command;
  }).join(' '); };
  return <div className="performance-chart" ref={chartRef}>
    {series.length > 2 && <div className="performance-chart-actions">
      <button type="button" onClick={() => setHidden([])}>Show all players</button>
      <button type="button" onClick={() => setHidden(series.map(s => s.key))}>Hide all players</button>
    </div>}
    {showLegend && <div className="performance-chart-legend">{series.map(s => <button key={s.key} type="button" title={s.description} aria-pressed={!hidden.includes(s.key)}
      onClick={() => setHidden(old => old.includes(s.key) ? old.filter(k => k !== s.key) : [...old, s.key])}>
      <i style={{ background: s.color }} />{s.legendLabel || s.label}</button>)}</div>}
    {!visible.length && <p className="performance-message" role="status">Select a line above to show it on the chart.</p>}
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}
      onPointerMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const t = ((event.clientX - rect.left) / rect.width * width - left) / (width - left - right) * end;
        let nearest = 0;
        for (let i = 1; i < points.length; i++) if (Math.abs(points[i].time - t) < Math.abs(points[nearest].time - t)) nearest = i;
        setCursor(nearest);
      }}>
      <title>{label}</title>
      {Array.from({ length: 5 }, (_, i) => { const v = min + (max - min) * i / 4; return <g key={`y${i}`}>
        <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} className="performance-chart-grid" />
        <text x={left - 9} y={y(v) + 4} textAnchor="end">{Math.abs(v) >= 1000 ? `${fmt(v / 1000, 1)}k` : fmt(v, 0)}</text>
      </g>; })}
      {Array.from({ length: 5 }, (_, i) => <text key={`x${i}`} x={x(end * i / 4)} y={height - 12} textAnchor="middle">{formatTime(end * i / 4)}</text>)}
      {signed && <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className="performance-chart-zero" />}
      {visible.map(s => <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2.5" />)}
      {placedMarkers.map((m, i) => {
        const cy = m.teamSide === 0 ? top + iconSize / 2 + m.lane * (iconSize + iconGap)
          : m.teamSide === 1 ? height - bottom - iconSize / 2 - m.lane * (iconSize + iconGap) : y(0) + m.lane * (iconSize + iconGap);
        const title = `${clock(m.time)} · ${m.label}`;
        return <g key={m.index ?? i} data-event-index={m.index} data-event-side={m.teamSide} data-event-category={m.category}
          className={`performance-chart-event${activeMarkerId != null && m.index === activeMarkerId ? ' performance-chart-event--active' : ''}`}
          tabIndex={0} role="img" aria-label={title}
          onPointerEnter={() => onMarkerHover?.(m.index)} onPointerLeave={() => onMarkerHover?.(null)}
          onFocus={() => onMarkerFocus?.(m.index)} onBlur={() => onMarkerFocus?.(null)}>
          <title>{title}</title>
          <line x1={x(m.time)} x2={x(m.time)} y1={top} y2={height - bottom} className="performance-chart-marker" />
          <g transform={`translate(${m.chartX - iconSize / 2},${cy - iconSize / 2})`}>
            <rect className="performance-chart-event-frame" width={iconSize} height={iconSize} rx="3"
              fill="#0b1424" stroke={m.teamSide === 0 ? '#4fd6a3' : m.teamSide === 1 ? '#ff8b8b' : '#cbd5e1'} />
            {m.heroId ? <image href={`/heroes/icons/${m.heroId}.png`} x="1" y="1" width="20" height="20" />
              : <EventGlyph category={m.category} />}
          </g>
        </g>;
      })}
      <line x1={x(selected.time)} x2={x(selected.time)} y1={top} y2={height - bottom} className="performance-chart-cursor" />
      {visible.filter(s => selected[s.key] != null).map(s => <circle key={s.key} cx={x(selected.time)} cy={y(selected[s.key])} r="4" fill={s.color} />)}
    </svg>
    <label className="performance-chart-scrubber">{axisLabel} <input aria-label={`${label}: ${axisLabel}`} type="range" min="0" max={points.length - 1}
      value={index} onChange={event => setCursor(Number(event.target.value))} /></label>
    <div className="performance-chart-readout"><strong>{selected.label || formatTime(selected.time)}</strong>{visible.map(s => <span key={s.key}>
      {s.label}: <b style={{ color: s.color }}>{fmt(selected[s.key], 0)}</b></span>)}</div>
  </div>;
}

function EventGlyph({ category }) {
  if (category === 'tower') return <g fill="#e2e8f0" stroke="#94a3b8" strokeWidth=".8" strokeLinejoin="round">
    <path d="M7 8h8l-1 8H8Z" />
    <path d="M4 3h3v3h2V3h4v3h2V3h3v6H4Z" />
    <path d="M6 16h10v2h2v2H4v-2h2Z" />
  </g>;
  if (category === 'barracks') return <g fill="#e2e8f0" stroke="#94a3b8" strokeWidth=".8" strokeLinejoin="round">
    {[false, true].map(mirrored => <g key={String(mirrored)} transform={mirrored ? 'translate(22 0) scale(-1 1)' : undefined}>
      <path d="m3 3 5 2 7 7-3 3-7-7Z" />
      <path d="m11 15 4-4m-1 3 5 5m-1 1 2-2" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
    </g>)}
  </g>;
  if (category === 'building') return <g fill="#e2e8f0" stroke="#94a3b8" strokeWidth=".8">
    <path d="M5 3h3v3h2V3h3v3h2V3h3v6l-2 2v7h2v2H4v-2h2v-7L5 9Z" />
    <path d="M10 14h3v6h-3Z" fill="#334155" />
  </g>;
  if (category === 'roshan') return <image href="/icons/roshan.png" x="1" y="1" width="20" height="20" />;
  if (category === 'tormentor') return <g fill="#d1a183" stroke="#7c4935" strokeWidth="1">
    <path d="m5 8-3-6 7 4h4l7-4-3 6 1 6-4 6H8l-4-6Z" />
    <path d="m7 10 3 2m5-2-3 2" stroke="#fee2a1" strokeWidth="2" /><path d="m8 16 3-2 3 2" fill="none" />
  </g>;
  return <path d="m11 3 8 8-8 8-8-8Z" fill="#cbd5e1" />;
}
