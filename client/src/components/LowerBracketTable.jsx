import React from "react";
import { Link } from 'react-router-dom';

export default function LowerBracketTable({ teams }) {
  // Split teams evenly for 2-column layout
  const midpoint = Math.ceil(teams.length / 2);
  const col1 = teams.slice(0, midpoint);
  const col2 = teams.slice(midpoint);

  return (
    <div>
  <h3 style={{ textAlign: "center", color: 'var(--text, #e6e6e6)' }}>Lower Bracket (Locked)</h3>

      {/* HEADER ROW (same height as UpperBracketTable) */}
      <table style={{ ...tableStyle, marginBottom: "8px" }}>
        <thead>
          <tr>
            <th style={{ ...headerTh, background: 'var(--surface, #121315)', color: 'var(--text, #e6e6e6)' }}>Team</th>
          </tr>
        </thead>
      </table>

      {/* TWO COLUMN GRID */}
  <div style={gridWrapper}>
        {/* LEFT COLUMN */}
        <table style={tableStyle}>
          <tbody>
            {col1.map((t) => (
              <tr key={t.TeamId}>
                <td style={{ ...td, color: 'var(--text, #e6e6e6)' }}><Link to={`/team/${t.TeamId}`} style={{ color: 'inherit' }}>{t.TeamName}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* RIGHT COLUMN */}
        <table style={tableStyle}>
          <tbody>
            {col2.map((t) => (
              <tr key={t.TeamId}>
                <td style={{ ...td, color: 'var(--text, #e6e6e6)' }}><Link to={`/team/${t.TeamId}`} style={{ color: 'inherit' }}>{t.TeamName}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------ Styles ------------------ */

const gridWrapper = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "12px",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
};

const headerTh = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
  background: "#fef3c7",    
  fontWeight: "bold",
};

const td = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
};
