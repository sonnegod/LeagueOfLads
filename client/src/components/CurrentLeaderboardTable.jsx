import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

export default function CurrentLeagueSeries({ seriesList }) {

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch match data on mount
  useEffect(() => {
    async function fetchMatches() {
      setLoading(true);
      try {
        const res = await fetch('/api/currentLeaderboard');
        const data = await res.json();
        console.log(data)
        setGroups(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchMatches();
  }, []);

    return (
  <div style={containerStyle}>
    {groups.map(group => (
      <div key={group.GroupId} style={cardStyle}>
        <div style={{ flexGrow: 1 }}>

        <h3 style={{ textAlign: "center", }}>
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
  const greenStyle = { backgroundColor: "#d1fae5" };  // light green
  const blueStyle = { backgroundColor: "#bfdbfe" };   // light blue
  const redStyle = { backgroundColor: "#fecaca" };    // light red
  const tanStyle = { backgroundColor: "#fef3c7" };    // light tan

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
              // Diagonal cells (same team)
              if (rowTeam.TeamId === colTeam.TeamId) {
                return (
                  <td
                    key={colTeam.TeamId}
                    style={{
                      ...smallTd,
                      background: "#eee"
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
                  <td key={colTeam.TeamId} style={smallTd}>
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

              // Determine background color
              let bgColor = "white";

              if (winsRow === 2 && winsCol === 0) bgColor = "#d1fae5"; // green
              else if (winsRow === 0 && winsCol === 2) bgColor = "#fecaca"; // red
              else if (winsRow === 1 && winsCol === 1) bgColor = "#fed7aa"; // orange

              return (
                <td
                  key={colTeam.TeamId}
                  style={{
                    ...smallTd,
                    background: bgColor,
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
  color: "black",
};

const cardStyle = {
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  padding: "12px",
  boxSizing: "border-box",
  flex: "1 1 340px",    // allow grow, allow shrink, base width 340px
  minWidth: 0,          // IMPORTANT: allow flex child to shrink
  maxWidth: "800px",    // optional: limit how wide each card grows
  background: "white",
  color: "black",
   display: "flex",         // NEW
  flexDirection: "column", // NEW
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed", // important: columns respect available width
  minWidth: 0,          // allow table to shrink to parent
  color: "black",

};

const thStyle = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
  whiteSpace: "nowrap",
};

const tdStyle = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
  wordBreak: "break-word",
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
