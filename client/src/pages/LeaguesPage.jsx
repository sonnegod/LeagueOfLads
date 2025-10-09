// src/pages/LeaguesPage.jsx
import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";

export default function LeaguesPage() {
  const [leaguesData, setLeaguesData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeagues() {
      setLoading(true);
      try {
        const res = await fetch("/api/leagues");
        const data = await res.json();
        setLeaguesData(data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchLeagues();
  }, []);

  if (loading) return <div>Loading leagues...</div>;

  return (
    <div style={{ padding: "1rem", overflowX: "auto" }}>
      <h1>Leagues</h1>

      <table style={{ width: "100%", minWidth: "800px", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>League</th>
            <th style={thStyle}>Last Match</th>
            <th style={thStyle}>Winner</th>
          </tr>
        </thead>
        <tbody>
          {leaguesData.map(league => (
            <tr key={league.LeagueId}>
              <td style={tdStyle}>
                <Link to={`/league/${league.LeagueId}`}>{league.LeagueName}</Link>
              </td>
              <td style={tdStyle}>
                <Link to={`/match/${league.LastMatchId}`}>{league.LastMatchId}</Link>
                </td>
              <td style={tdStyle}>
                {league.WinnerTeamId ? (
                  <Link to={`/team/${league.WinnerTeamId}`}>{league.WinnerTeamName}</Link>
                ) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
};

const tdStyle = {
  border: "1px solid #ccc",
  padding: "12px 16px",
  textAlign: "center",
  color: 'black'
};
