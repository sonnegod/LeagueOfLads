import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import MatchResultBadge from './MatchResultBadge';
import MatchResultsTable from './MatchResultsTable';
import { groupLeagueSeries } from '../utils/leagueSeries';
import './LeagueSeriesTab.css';

export default function LeagueSeriesTab({ series = [], matches = [] }) {
  const grouped = useMemo(() => groupLeagueSeries(series, matches), [series, matches]);
  const [expandedSeries, setExpandedSeries] = useState({});
  if (!matches.length) return <div>No series available.</div>;

  return <div className="league-series-list">
    {grouped.series.map(item => {
      const expanded = Boolean(expandedSeries[item.SeriesId]);
      const tied = item.team1Wins === item.team2Wins;
      const winnerSide = item.hasPendingResults || tied ? null : item.team1Wins > item.team2Wins ? 'r' : 'd';
      return <section className="league-series-item" key={item.SeriesId}>
        <button type="button" className="league-series-summary" aria-expanded={expanded}
          onClick={() => setExpandedSeries(previous => ({ ...previous, [item.SeriesId]: !expanded }))}>
          <span className="league-series-date">{item.DateCreated}</span>
          <span className="league-series-team">{item.team_one}{' '}
            <MatchResultBadge winnerSide={winnerSide} side="r" /></span>
          <span className="league-series-result">
            <strong>{item.team1Wins} – {item.team2Wins}</strong>
            {item.hasPendingResults ? <small>Pending results</small> : tied ? <small>Draw</small> : null}
          </span>
          <span className="league-series-team">{item.team_two}{' '}
            <MatchResultBadge winnerSide={winnerSide} side="d" /></span>
          <span className="league-series-expand" aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>
        {expanded && <div className="league-series-content">
          <Link className="league-series-detail-link" to={`/series/${item.SeriesId}`}>View series</Link>
          <MatchResultsTable matches={item.matches} />
        </div>}
      </section>;
    })}
    {grouped.ungroupedMatches.length > 0 && <section>
      <h2>Other matches</h2>
      <MatchResultsTable matches={grouped.ungroupedMatches} />
    </section>}
  </div>;
}
