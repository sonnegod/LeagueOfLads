import { useEffect, useId, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Activity, ClipboardCheck, Eye, Info, Repeat, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AnalyticsStatusPanel from '../components/AnalyticsStatusPanel';
import BettingAdminPanel from '../components/BettingAdminPanel';
import BettingTicketsAdmin from '../components/BettingTicketsAdmin';
import './SiteManagement.css';

const formatCount = value => value == null ? '\u2014' : Number(value).toLocaleString('en-US');
const formatDate = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
});

function Metric({ icon, label, value, detail }) {
  return <section className="site-analytics-metric">
    <div><span>{label}</span>{icon}</div>
    <strong>{value}</strong>
    <small>{detail}</small>
  </section>;
}

function TrafficChart({ daily, metric, hourly = false }) {
  const chartId = useId().replaceAll(':', '');
  const width = 840, height = 230, left = 48, right = 18, top = 14, bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(50, Math.ceil(Math.max(...daily.map(day => day[metric])) / 50) * 50);
  const points = daily.map((day, index) => ({ ...day,
    x: left + (daily.length > 1 ? index / (daily.length - 1) : .5) * plotWidth,
    y: top + (1 - day[metric] / maximum) * plotHeight,
  }));
  const observed = points.filter(point => point[metric] != null);
  const line = observed.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const area = observed.length ? `${line} L${observed.at(-1).x},${top + plotHeight} L${observed[0].x},${top + plotHeight} Z` : '';
  const label = metric === 'visitors' ? 'Visitors' : 'Page views';
  const labelIndexes = hourly ? [0, 6, 12, 18, 23] : [...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])];
  const pointLabel = point => hourly ? `${String(point.hour).padStart(2, '0')}:00` : formatDate(point.date);

  return <svg className="site-analytics-traffic-chart" viewBox={`0 0 ${width} ${height}`}
    role="img" aria-labelledby={`${chartId}-title`}>
    <title id={`${chartId}-title`}>{hourly ? 'Hourly' : 'Daily'} {label.toLowerCase()} from {daily[0].date} to {daily.at(-1).date}{hourly ? ' · 00:00–23:59 New York time' : ''}</title>
    <defs><linearGradient id={`${chartId}-fill`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#38bdf8" stopOpacity=".24" />
      <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
    </linearGradient></defs>
    {[0, .5, 1].map(ratio => <g key={ratio}>
      <line x1={left} y1={top + ratio * plotHeight} x2={width - right} y2={top + ratio * plotHeight}
        stroke="#263449" strokeDasharray="4 5" />
      <text x={left - 12} y={top + ratio * plotHeight + 4} textAnchor="end">{formatCount(maximum * (1 - ratio))}</text>
    </g>)}
    <path d={area} fill={`url(#${chartId}-fill)`} />
    <path d={line} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />
    {observed.map(point => <g key={`${point.date}:${point.hour ?? ''}`}>
      <title>{pointLabel(point)}: {formatCount(point[metric])} {label.toLowerCase()}</title>
      <rect x={point.x - 10} y={top} width="20" height={plotHeight} fill="transparent" />
      <circle cx={point.x} cy={point.y} r="3.5" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
    </g>)}
    {labelIndexes.map(index => <text key={index} x={points[index].x} y={height - 8}
      textAnchor={index === 0 && daily.length > 1 ? 'start' : index === daily.length - 1 && daily.length > 1 ? 'end' : 'middle'}>
      {pointLabel(daily[index])}
    </text>)}
  </svg>;
}

function AnalyticsDashboard({ data }) {
  const [metric, setMetric] = useState('visitors');
  const steps = data.signups.steps;
  const largestFeature = Math.max(...data.features.map(feature => feature.count), 1);

  return <>
    <div className="site-analytics-metrics">
      <Metric icon={<Users size={18} aria-hidden="true" />} label="Visitors" value={formatCount(data.summary.visitors)} detail="Unique browsers in this period" />
      <Metric icon={<Eye size={18} aria-hidden="true" />} label="Page views" value={formatCount(data.summary.pageViews)} detail="Public page navigation" />
      <Metric icon={<Repeat size={18} aria-hidden="true" />} label="Returning visitors" value={`${data.summary.returningPercent}%`} detail="Seen on an earlier day within retention" />
      <Metric icon={<ClipboardCheck size={18} aria-hidden="true" />} label="Signup completion" value={`${data.summary.completionPercent}%`} detail="Browsers submitting / starting forms" />
    </div>

    <div className="site-analytics-row site-analytics-row--traffic">
      <section className="site-analytics-panel">
        <div className="site-analytics-panel-heading">
          <div><h2>Traffic overview</h2><p>{formatDate(data.period.from)} – {formatDate(data.period.to)} · New York time</p></div>
          <div className="ui-tabs site-analytics-chart-tabs" role="group" aria-label="Traffic metric">
            {[['visitors', 'Visitors'], ['pageViews', 'Page views']].map(([key, label]) =>
              <button type="button" className="ui-tab" key={key} aria-pressed={metric === key}
                onClick={() => setMetric(key)}>{label}</button>)}
          </div>
        </div>
        <TrafficChart daily={data.days === 1 ? data.hourly : data.daily} hourly={data.days === 1} metric={metric} />
        {data.days === 1 && <p className="site-analytics-note">Hourly activity · 00:00–23:59 New York time. Visitors are unique within each hour.
          {' '}{data.hourlyStartedAt ? `Hourly collection began ${new Date(data.hourlyStartedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}. Earlier daily totals remain included above.` : 'Hourly activity will appear as new visits are recorded.'}</p>}
      </section>
      <section className="site-analytics-panel">
        <div className="site-analytics-panel-heading"><div><h2>Where visitors come from</h2><p>Traffic sources</p></div></div>
        <div className="site-analytics-source-strip" aria-hidden="true">{data.sources.map(source =>
          <span key={source.name} style={{ width: `${source.percent}%`, background: source.color }} />)}</div>
        <ul className="site-analytics-sources">{data.sources.map(source => <li key={source.name}>
          <span><i style={{ background: source.color }} aria-hidden="true" />{source.name}</span>
          <strong>{source.percent}%</strong>
        </li>)}</ul>
        <p className="site-analytics-note">First source in this period per browser. Discord links should include ?utm_source=discord; apps often hide the referrer.</p>
      </section>
    </div>

    <div className="site-analytics-row">
      <section className="site-analytics-panel">
        <div className="site-analytics-panel-heading"><div><h2>Most visited pages</h2><p>Grouped by page type</p></div></div>
        <div className="site-analytics-table-scroll"><table className="site-analytics-table">
          <thead><tr><th>Page</th><th>Views</th><th>Visitors</th></tr></thead>
          <tbody>{data.pages.map(page => <tr key={page.name}>
            <td><strong>{page.name}</strong><small>{page.route}</small></td>
            <td>{formatCount(page.views)}</td><td>{formatCount(page.visitors)}</td>
          </tr>)}{!data.pages.length && <tr><td colSpan="3">No public page visits recorded in this period.</td></tr>}</tbody>
        </table></div>
      </section>
      <section className="site-analytics-panel">
        <div className="site-analytics-panel-heading"><div><h2>What players explore</h2><p>Feature interactions</p></div><Activity size={18} aria-hidden="true" /></div>
        <ul className="site-analytics-features">{data.features.map(feature => <li key={feature.name}>
          <div><span>{feature.name}</span><strong>{formatCount(feature.count)}</strong></div>
          <div className="site-analytics-feature-track" aria-hidden="true">
            <span style={{ width: `${feature.count / largestFeature * 100}%` }} />
          </div>
        </li>)}</ul>
      </section>
    </div>

    <div className="site-analytics-row">
      <section className="site-analytics-panel">
        <div className="site-analytics-panel-heading"><div><h2>From visitor to registered team</h2><p>Signup funnel</p></div></div>
        <div className="site-analytics-funnel">{steps.map((step, index) => <div key={step.name}>
          <span className="site-analytics-step-number">{index + 1}</span>
          <strong>{formatCount(step.count)}</strong><span>{step.name}</span>
          <small>{index ? steps[index - 1].count ? `${Math.round(step.count / steps[index - 1].count * 100)}% of previous step` : 'No activity yet' : 'Entry point'}</small>
        </div>)}</div>
        <p className="site-analytics-note"><strong>{data.signups.uploadFailures} screenshot processing or upload failures</strong> in this period. Stages count unique browsers; submission is confirmed by the server and implies prior steps. Seasons are combined for this period.</p>
      </section>
      <section className="site-analytics-panel">
        <div className="site-analytics-panel-heading"><div><h2>Site health</h2><p>Reliability and response times</p></div></div>
        <div className="site-analytics-health">
          <div><strong>{data.health.p95ResponseMs === 60000 ? '>30,000' : formatCount(data.health.p95ResponseMs)}{data.health.p95ResponseMs != null && <small>ms</small>}</strong><span>Approximate 95th percentile API time</span></div>
          <div><strong>{data.health.apiErrorPercent}<small>%</small></strong><span>API error rate</span></div>
        </div>
        <ul className="site-analytics-issues">{data.health.issues.map(issue => <li key={issue.name}>
          <span>{issue.name}</span><strong>{formatCount(issue.count)}</strong>
        </li>)}</ul>
        <p className="site-analytics-note">Across {formatCount(data.health.requests)} API requests, including admin requests and polling. Analytics requests are excluded. Timings use latency buckets; errors include 4xx and 5xx responses.</p>
      </section>
    </div>
  </>;
}

export default function SiteManagement() {
  const { user, loading } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [['traffic', 'Traffic'], ['analytics', 'Analytics'], ['betting', 'Betting'], ['tickets', 'Bet tickets']];
  const activeTab = tabs.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'traffic';
  const [days, setDays] = useState(7);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loading || !user?.isSiteManager || activeTab !== 'traffic') return undefined;
    const controller = new AbortController();
    fetch(`/api/site-management/analytics?days=${days}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load site analytics');
        return data;
      })
      .then(data => { if (!controller.signal.aborted) { setResult({ days, data }); setError(null); } })
      .catch(cause => { if (!controller.signal.aborted) setError({ days, message: cause.message }); });
    return () => controller.abort();
  }, [days, loading, user?.isSiteManager, attempt, activeTab]);

  if (loading) return <div className="ui-page">Checking site access...</div>;
  if (!user?.isSiteManager) return <Navigate to="/" replace />;

  const currentError = error?.days === days ? error.message : null;
  const data = result?.days === days ? result.data : null;
  function selectTab(key, focus = false) {
    const next = new URLSearchParams(params); next.set('tab', key); setParams(next);
    if (focus) document.getElementById(`site-management-${key}-tab`)?.focus();
  }
  function navigateTabs(event) {
    const index = tabs.findIndex(([key]) => key === activeTab);
    const key = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length][0]
      : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length][0]
      : event.key === 'Home' ? tabs[0][0] : event.key === 'End' ? tabs.at(-1)[0] : null;
    if (key) { event.preventDefault(); selectTab(key, true); }
  }
  return <div className="ui-page site-management-page">
    <header className="site-management-heading">
      <div><div className="site-management-title"><h1>Site Management</h1>
        <span className="site-manager-badge"><ShieldCheck size={14} aria-hidden="true" />Site manager</span></div>
        <p>Traffic, league analytics, highlights, and betting operations.</p></div>
      {activeTab === 'traffic' && <div className="ui-tabs site-analytics-range" role="group" aria-label="Analytics date range">
        <button type="button" className="ui-tab" onClick={() => setAttempt(value => value + 1)}>Refresh</button>
        {[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([value, label]) =>
          <button key={value} type="button" className="ui-tab" aria-pressed={days === value}
            onClick={() => setDays(value)}>{label}</button>)}
      </div>}
    </header>
    <div className="ui-tabs" role="tablist" aria-label="Site management sections" onKeyDown={navigateTabs}>
      {tabs.map(([key, label]) => <button key={key} type="button" className="ui-tab" role="tab"
        id={`site-management-${key}-tab`} aria-selected={activeTab === key} aria-pressed={activeTab === key}
        aria-controls={`site-management-${key}-panel`} tabIndex={activeTab === key ? 0 : -1}
        onClick={() => selectTab(key)}>{label}</button>)}
    </div>
    <section id={`site-management-${activeTab}-panel`} role="tabpanel" aria-labelledby={`site-management-${activeTab}-tab`}>
    {activeTab === 'analytics' && <AnalyticsStatusPanel />}
    {activeTab === 'betting' && <BettingAdminPanel />}
    {activeTab === 'tickets' && <BettingTicketsAdmin />}
    {activeTab === 'traffic' && <>
    <div className="site-analytics-preview"><Info size={18} aria-hidden="true" />
      <p>{data ? <><strong>{data.collectionEnabled ? 'Live first-party analytics.' : 'Collection disabled in this environment.'}</strong>{' '}
        {data.startedAt ? `Data since ${new Date(data.startedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}. ` : 'No activity recorded yet. '}
        Public usage excludes signed-in league admins and site managers, known bots, and opted-out browsers. Anonymous usage records are retained for 90 days; visitor counts are estimates.</> : 'Loading collection status...'}</p>
    </div>
    {currentError ? <div className="site-analytics-panel" role="alert"><p>{currentError}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
    </div> : !data ? <div className="site-analytics-panel" role="status">Loading site analytics...</div>
      : <AnalyticsDashboard data={data} />}
    </>}
    </section>
  </div>;
}
