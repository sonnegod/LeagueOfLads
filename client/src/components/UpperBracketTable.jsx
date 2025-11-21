// src/components/tiebreakers/UpperBracketTable.jsx
import React from "react";

export default function UpperBracketTable({ teams }) {
  return (
    <div>
      <h3 style={{ textAlign: "center" }}>Upper Bracket (Locked)</h3>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: "#e0ffe0" }}>
            <th style={th}>Team</th>
          </tr>
        </thead>

        <tbody>
          {teams.map((t, idx) => (
            <tr key={t.TeamId}>
              <td style={td}>{t.TeamName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
};

const th = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
  background: "#f0fff0"
};

const td = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center"
};
