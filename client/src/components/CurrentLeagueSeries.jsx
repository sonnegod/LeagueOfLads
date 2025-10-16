import React, { useState } from "react";
import { Link } from "react-router-dom";

export default function CurrentLeagueSeries({ seriesList }) {
    const [expandedSeries, setExpandedSeries] = useState({});


    const toggleExpanded = (SeriesId) => {
        setExpandedSeries(prev => ({
        ...prev,
        [SeriesId]: !prev[SeriesId],
        }));
    };

  if (seriesList.length === 0) return <div>No series today.</div>;

  return (
    <div style={{ padding: "1rem", overflowX: "auto" }}>
      <table style={tableStyle}>
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
                  ? "#f9f9f9"
                  : "white",
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
    </div>
  );
}

const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: "900px" };
const thStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };
const tdStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center",  color: "black" };