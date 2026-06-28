import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import './CurrentLeagueSeries.css';

export default function CurrentLeagueSeries({ leagueId }) {
  const [seriesList, setSeriesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedSeries, setExpandedSeries] = useState({});

  useEffect(() => {
    async function fetchSeries() {
      setLoading(true);
      try {
        const url = leagueId
          ? `/api/homepageSeries?leagueId=${leagueId}`
          : "/api/homepageSeries";
        const res = await fetch(url);
        const data = await res.json();
        setSeriesList(data || []);
      } catch (err) {
        console.error("Error fetching series:", err);
        setSeriesList([]);
      } finally {
        setLoading(false);
      }
    }

    fetchSeries();
  }, [leagueId]);

    const toggleExpanded = (SeriesId) => {
        setExpandedSeries(prev => ({
        ...prev,
        [SeriesId]: !prev[SeriesId],
        }));
    };

  if (loading) return <div>Loading series...</div>;
  if (seriesList.length === 0) return <div>No series available.</div>;

  return (
    <div className="current-series" style={{ padding: "1rem", overflowX: "auto", background: "var(--surface, #000)", borderRadius: "8px" }}>
      <table className="current-series-table" style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Time</th>
            <th style={thStyle}>Team</th>
            <th style={thStyle}>Team</th>
          </tr>
        </thead>
        <tbody>
          {seriesList.map((s) => (
            <React.Fragment key={s.SeriesId}>
            {/* Main series row */}
            <tr
              onClick={() => toggleExpanded(s.SeriesId)}
              style={{
                cursor: "pointer",
                backgroundColor: expandedSeries[s.SeriesId]
                  ? "var(--surface, #0b0b0b)"
                  : "transparent",
              }}
            >
              <td style={tdStyle}>{s.DateCreated}</td>
              <td style={tdStyle}><Link to={`/team/${s.Team1}`}>{s.team_one}</Link></td>
              <td style={tdStyle}><Link to={`/team/${s.Team2}`}>{s.team_two}</Link></td>
            </tr>

            {/* Expanded match rows */}
            {expandedSeries[s.SeriesId] && (
              <tr>
                <td colSpan="5" style={{ paddingLeft: "2rem"}}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      marginTop: "0.5rem",
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={thStyle}>Match ID</th>
                        <th style={thStyle}>Rad Team</th>
                        <th style={thStyle}>Dire Team</th>
                        <th style={thStyle}>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.seriesMatches?.map((match) => (
                        <tr key={match.MatchId}>
                          <td style={tdStyle}>
                            <Link to={`/match/${match.MatchId}`}>
                              {match.MatchId}
                            </Link>
                          </td>
                          <td style={tdStyle}>
                            <Link to={`/team/${match.rad_team_id}`}>
                              {match.rad_team_name}{match.WinnerSide === 'r' && '♔'}
                            </Link>
                          </td>
                          <td style={tdStyle}>
                            <Link to={`/team/${match.dire_team_id}`}>
                              {match.dire_team_name}{match.WinnerSide === 'd' && '♔'}
                            </Link>
                          </td>
                          <td style={tdStyle}>
                            {Math.floor(match.Duration / 60)}:{(match.Duration % 60).toString().padStart(2, '0')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            )}
          </React.Fragment>
          ))}
        </tbody>
      </table>
      <div className="current-series-cards">
        {seriesList.map((series) => {
          const expanded = expandedSeries[series.SeriesId];
          return (
            <article className="series-card" key={series.SeriesId}>
              <button
                type="button"
                className="series-card-summary"
                aria-expanded={Boolean(expanded)}
                onClick={() => toggleExpanded(series.SeriesId)}
              >
                <span className="series-card-date">{series.DateCreated}</span>
                <span className="series-card-matchup">
                  <span>{series.team_one}</span>
                  <span className="series-card-versus">vs</span>
                  <span>{series.team_two}</span>
                </span>
                <span className="series-card-chevron" aria-hidden="true">{expanded ? '\u2212' : '+'}</span>
              </button>
              {expanded && (
                <div className="series-match-list">
                  {series.seriesMatches?.map((match) => (
                    <div className="series-match-card" key={match.MatchId}>
                      <Link className="series-match-id" to={`/match/${match.MatchId}`}>
                        Match {match.MatchId}
                      </Link>
                      <div className="series-match-team">
                        <Link to={`/team/${match.rad_team_id}`}>{match.rad_team_name}</Link>
                        {match.WinnerSide === 'r' && <span className="series-winner">Winner</span>}
                      </div>
                      <div className="series-match-team">
                        <Link to={`/team/${match.dire_team_id}`}>{match.dire_team_name}</Link>
                        {match.WinnerSide === 'd' && <span className="series-winner">Winner</span>}
                      </div>
                      <span className="series-match-duration">
                        {Math.floor(match.Duration / 60)}:{(match.Duration % 60).toString().padStart(2, '0')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: "900px" };
const thStyle = { border: "1px solid var(--border, #222428)", padding: "8px", textAlign: "center", color: "var(--text, #e6e6e6)", background: "transparent" };
const tdStyle = { border: "1px solid var(--border, #222428)", padding: "8px", textAlign: "center",  color: "var(--text, #e6e6e6)" };
