import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import MatchDetails from '../components/MatchDetails';
import { useReport, ReportState, fmt } from '../components/PerformanceUI';
import './MatchSeriesPages.css';

export default function SeriesPage() {
  const { seriesId } = useParams();
  const report = useReport(`/api/series/${seriesId}`);
  return <div className="series-detail-page ui-page"><ReportState report={report}>{data =>
    data.series?.[0]?.SeriesId ? <SeriesView key={seriesId} data={data} /> : <p>Series not found or no matches recorded.</p>}
  </ReportState></div>;
}

function SeriesView({ data }) {
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const series = data.series[0];
  const games = [...(data.seriesMatchesWithData || [])].sort((a, b) => Number(a.MatchId) - Number(b.MatchId));
  const currentMatch = games[activeMatchIndex];
  return <>
    <header className="series-overview-header">
      <h1 className="series-matchup-title">
        <Link to={`/team/${series.Team1}`}>{series.Team1Name}</Link>
        <span className="series-overview-score" aria-label={`Series score ${series.Team1Wins} to ${series.Team2Wins}`}>
          {fmt(series.Team1Wins, 0)} – {fmt(series.Team2Wins, 0)}
        </span>
        <Link to={`/team/${series.Team2}`}>{series.Team2Name}</Link>
      </h1>
    </header>
    {games.length ? <>
      <nav className="series-game-navigation" aria-label="Series games">
        <div className="series-game-tabs ui-tabs">{games.map((game, index) =>
          <button type="button" className="ui-tab" aria-pressed={index === activeMatchIndex} aria-controls="series-game-view"
            key={game.MatchId} onClick={() => setActiveMatchIndex(index)}>Game {index + 1}</button>)}
        </div>
        <Link className="series-match-link" to={`/match/${currentMatch.MatchId}`}>Open match {currentMatch.MatchId} ↗</Link>
      </nav>
      <section id="series-game-view" className="series-match-details" aria-label={`Game ${activeMatchIndex + 1}`}>
        <MatchDetails key={currentMatch.MatchId} matchId={currentMatch.MatchId} embedded />
      </section>
    </> : <p>No games recorded for this series.</p>}
  </>;
}
