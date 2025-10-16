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
        const data = await res.json();4
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
        <h3 style={{ textAlign: "center", marginBottom: 8 }}>
          {group.GroupName ? group.GroupName : `Group ${group.GroupId}`}
        </h3>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Team</th>
              <th style={thStyle}>Wins</th>
              <th style={thStyle}>Losses</th>
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
                </tr>
              ))}
          </tbody>
        </table>
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
  maxWidth: "420px",    // optional: limit how wide each card grows
  background: "white",
  color: "black",

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
