import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function CurrentLeagueSeries({ leagueId }) {

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch match data on mount
  useEffect(() => {
    async function fetchMatches() {
      setLoading(true);
      try {
        const url = leagueId
          ? `/api/currentLeaderboard?leagueId=${leagueId}`
          : "/api/currentLeaderboard";
        const res = await fetch(url);
        const data = await res.json();

        setGroups(data || []);
      } catch (err) {
        console.error(err);
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }
    fetchMatches();
  }, [leagueId]);

    return (
    <div style={containerStyle}>
    {loading && <div>Loading leaderboard...</div>}
    {groups.map(group => (
      <div key={group.GroupId} style={cardStyle}>
        <div style={{ flexGrow: 1 }}>

          <h3 style={{ textAlign: "center", color: 'var(--text, #ffffff)' }}>
          {group.GroupName ? group.GroupName : `Group ${group.GroupId}`}
        </h3>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Team</th>
              <th style={thStyle}>Wins</th>
              <th style={thStyle}>Losses</th>
              <th style={thStyle}>Neustadtl</th>
            </tr>
          </thead>
          <tbody>
            {group.groupTeams.map((team, index) => (
                <tr
                  key={team.TeamId}
                  style={getRowStyle(index, group.groupTeams.length)}
                >
                  <td style={tdStyle}>
                    <Link to={`/team/${team.TeamId}`}>{team.TeamName}</Link>
                  </td>
                  <td style={tdStyle}>{team.Wins}</td>
                  <td style={tdStyle}>{team.Losses}</td>
                  <td style={tdStyle}>{team.Score}</td>
                </tr>
              ))}
          </tbody>
        </table>
        </div>
        <div style={h2hContainerStyle}>
      {buildH2HMatrix(group)}
    </div>
      </div>
      
    ))}
  </div>
);

}

function getRowStyle(index, total) {
  // Use same dark palette as TieBreakerTable: darker green/red/orange, lighter blue
  const greenStyle = { backgroundColor: "#123d1a" };  // dark green
  const blueStyle = { backgroundColor: "#2a3a66" };   // slightly lighter blue
  const redStyle = { backgroundColor: "#3d1212" };    // dark red
  const tanStyle = { backgroundColor: "#4b3b1f" };    // darker orange (used for 'tan' rows)

  const isOdd = total % 2 === 1


  if (index < 2) return greenStyle;                  // top 2
  if (index === 2) return blueStyle;                 // 3rd

  if (isOdd && index >= total - 3) return redStyle;      //bottom 3 for odd nmber
  if (!isOdd && index >= total - 2) return redStyle;
  
  return tanStyle;                                  // rest (middle)
}

function buildH2HMatrix(group) {
  if (!group.groupH2H || !Array.isArray(group.groupH2H)) return null;

  const teams = group.groupTeams;

  // Fast lookup map
  const h2hMap = {};
  group.groupH2H.forEach(row => {
    const key = `${row.TeamA}-${row.TeamB}`;
    h2hMap[key] = row;
  });

  const smallTd = {
    ...tdStyle,
    fontSize: "10px",
    padding: "4px"
  };

  return (
    <table style={{ ...tableStyle, marginTop: "12px" }}>
      <thead>
        <tr>
          <th style={h2hThStyle}></th>
          {teams.map(t => (
            <th key={t.TeamId} style={h2hThStyle}>
              {t.TeamName}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {teams.map(rowTeam => (
          <tr key={rowTeam.TeamId}>
            <th style={h2hThStyle}>{rowTeam.TeamName}</th>

            {teams.map(colTeam => {
              // Diagonal cells (same team) — render white with black text per request
              if (rowTeam.TeamId === colTeam.TeamId) {
                return (
                  <td
                    key={colTeam.TeamId}
                    style={{
                        ...smallTd,
                        background: "#d1d5db",
                        color: "#000000"
                      }}
                  >
                    —
                  </td>
                );
              }

              // Look up H2H match record
              const match =
                h2hMap[`${rowTeam.TeamId}-${colTeam.TeamId}`] ||
                h2hMap[`${colTeam.TeamId}-${rowTeam.TeamId}`];

              if (!match) {
                return (
                  <td
                    key={colTeam.TeamId}
                    style={{ ...smallTd, background: "#d1d5db", color: "#000000" }}
                  >
                    0–0
                  </td>
                );
              }

              // Determine rowTeam and colTeam results
              let winsRow = 0;
              let winsCol = 0;

              if (match.TeamA === rowTeam.TeamId) {
                winsRow = match.WinsA;
                winsCol = match.WinsB;
              } else {
                winsRow = match.WinsB;
                winsCol = match.WinsA;
              }

              // Determine background color — use a slightly lighter TieBreakerTable palette
              // default: white (non-highlighted)
              let bgColor = "#ffffff";
              let textColor = "#000000";

              // Lighter highlight colors for better contrast on dark backgrounds
              if (winsRow === 2 && winsCol === 0) {
                bgColor = "#1f7a46"; // lighter green
                textColor = "#f1f1f1";
              } else if (winsRow === 0 && winsCol === 2) {
                bgColor = "#7a2b2b"; // lighter red
                textColor = "#f1f1f1";
              } else if (winsRow === 1 && winsCol === 1) {
                bgColor = "#8a6638"; // lighter orange
                textColor = "#f1f1f1";
              }

              return (
                <td
                  key={colTeam.TeamId}
                  style={{
                    ...smallTd,
                    background: bgColor,
                    color: textColor
                  }}
                >
                  {winsRow}–{winsCol}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}




// Styles (replace your existing ones)
const containerStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "16px",          // spacing between cards
  justifyContent: "center",
  color: "var(--text, #e6e6e6)",
};

const cardStyle = {
  border: "1px solid var(--border, #222428)",
  background: "var(--surface, #121315)",
  borderRadius: "8px",
  padding: "12px",
  boxSizing: "border-box",
  flex: "1 1 340px",    // allow grow, allow shrink, base width 340px
  minWidth: 0,          // IMPORTANT: allow flex child to shrink
  maxWidth: "800px",    // optional: limit how wide each card grows
  display: "flex",
  flexDirection: "column",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed", // important: columns respect available width
  minWidth: 0,          // allow table to shrink to parent
  color: 'var(--text, #e6e6e6)'
};

const thStyle = {
  border: "1px solid var(--border, #222428)",
  padding: "8px",
  textAlign: "center",
  whiteSpace: "nowrap",
  color: 'var(--text, #e6e6e6)'
};

const tdStyle = {
  border: "1px solid var(--border, #222428)",
  padding: "8px",
  textAlign: "center",
  wordBreak: "break-word",
  color: 'var(--text, #e6e6e6)'
};

const h2hThStyle = {
  ...thStyle,
  whiteSpace: "normal",   // allow wrapping
  fontSize: "10px",       // smaller text
  maxWidth: "100px",       // prevents giant columns
  padding: "4px",         // tighter look
  overflowWrap: "break-word",   // modern
  wordBreak: "break-word", 
};

const h2hContainerStyle = {
  marginTop: "16px",
  flexGrow: 1,               // forces matrix areas to fill equally
  display: "flex",
  alignItems: "stretch",
};
