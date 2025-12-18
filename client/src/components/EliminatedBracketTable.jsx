// src/components/tiebreakers/EliminatedBracketTable.jsx
import React from "react";
import { Link } from 'react-router-dom';

export default function EliminatedBracketTable({ teams }) {
  return (
    <div>
      <h3 style={{ textAlign: "center" }}>Eliminated Teams</h3>

      {(!teams || teams.length === 0) && (
        <p style={{ textAlign: "center", marginTop: 8 }}>
          No eliminated teams.
        </p>
      )}

      {teams && teams.length > 0 && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Team</th>
            </tr>
          </thead>

          <tbody>
            {teams.map((team) => (
              <tr key={team.TeamId}>
                <td style={td}><Link to={`/team/${team.TeamId}`}>{team.TeamName}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* -------------------------------------
   Shared styling — matches LowerBracketTable
-------------------------------------- */
const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
};

const th = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
};

const td = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
};
