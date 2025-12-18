// src/components/tiebreakers/UpperBracketTable.jsx
import React from "react";
import { Link } from 'react-router-dom';

export default function UpperBracketTable({ teams }) {
  return (
    <div>
      <h3 style={{ textAlign: "center", color: 'var(--text, #e6e6e6)' }}>Upper Bracket (Locked)</h3>

      <table style={tableStyle}>
        <thead>
          <tr style={{ background: 'var(--surface, #121315)' }}>
            <th style={{ ...th, color: 'var(--text, #e6e6e6)', background: 'var(--surface, #121315)' }}>Team</th>
          </tr>
        </thead>

        <tbody>
          {teams.map((t, idx) => (
            <tr key={t.TeamId}>
              <td style={{ ...td, color: 'var(--text, #e6e6e6)' }}><Link to={`/team/${t.TeamId}`} style={{ color: 'inherit' }}>{t.TeamName}</Link></td>
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
