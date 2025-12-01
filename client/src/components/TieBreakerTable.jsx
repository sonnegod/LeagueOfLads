// src/components/tiebreakers/TieBreakerTable.jsx
import React, { useEffect, useState } from "react";
import { Link } from 'react-router-dom';

export default function TieBreakerTable({ teams }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  // ------------------------------------------------------
  // Load all tiebreaker matches
  // ------------------------------------------------------
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/tiebreakerMatches");
        const data = await res.json();

        setMatches(data || []);
      } catch (err) {
        console.error("TieBreaker match load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <p>Loading tiebreaker data...</p>;
  if (!teams || teams.length === 0) return <p>No tiebreaker teams available.</p>;

  // ------------------------------------------------------
  // Build H2H map
  // ------------------------------------------------------
  const h2hMap = {};
  for (const m of matches) {
    const k1 = `${m.TeamA}-${m.TeamB}`;
    const k2 = `${m.TeamB}-${m.TeamA}`;

    h2hMap[k1] = m;
    h2hMap[k2] = {
      TeamA: m.TeamB,
      TeamB: m.TeamA,
      WinsA: m.WinsB,
      WinsB: m.WinsA
    };
  }

  return (
    <div style={wrapper}>
      {/* LEFT SIDE — Standings */}
      <div style={left}>
        <h3 style={{ textAlign: "center" }}>Tiebreaker Standings</h3>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headerTh}>Team</th>
            </tr>
          </thead>

          <tbody>
            {teams.map((t) => (
              <tr key={t.TeamId}>
                <td style={td}><Link to={`/team/${t.TeamId}`}>{t.TeamName}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* RIGHT SIDE — Matrix */}
      <div style={right}>
        <h3 style={{ textAlign: "center" }}>Head-to-Head</h3>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thSmall}></th>
              {teams.map((t) => (
                <th key={t.TeamId} style={thSmall}>
                  {t.TeamName}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {teams.map((row) => (
              <tr key={row.TeamId}>
                <th style={thSmall}>{row.TeamName}</th>

                {teams.map((col) => {
                  if (row.TeamId === col.TeamId)
                    return (
                      <td
                        key={col.TeamId}
                        style={{ ...tdSmall, background: "#eee" }}
                      >
                        —
                      </td>
                    );

                  const key = `${row.TeamId}-${col.TeamId}`;
                  const result = h2hMap[key];

                  let winsRow = result?.WinsA || 0;
                  let winsCol = result?.WinsB || 0;

                  // Color coding
                  let bg = "#fff";
                  if (winsRow === winsCol) bg = "#ffe7c4"; // 1–1 tie
                  else if (winsRow > winsCol) bg = "#d4ffd4"; // win
                  else bg = "#ffd4d4"; // loss

                  return (
                    <td key={col.TeamId} style={{ ...tdSmall, background: bg }}>
                      {winsRow}–{winsCol}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------- Styles ---------------------- */

const wrapper = {
  display: "grid",
  gridTemplateColumns: "0.5fr 1fr",
  gap: "24px",
  marginTop: "1rem",
};

const left = {};
const right = {};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed", // ⭐ forces equal column sizes
};

const thSmall = {
  border: "1px solid #ccc",
  padding: "6px",
  fontSize: "11px",      // ⭐ matches matrix header to name font size
  textAlign: "center",
  wordBreak: "keep-all",
};

const tdSmall = {
  border: "1px solid #ccc",
  padding: "6px",
  fontSize: "11px",
  textAlign: "center",
};

const headerTh = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
  fontWeight: "bold",
};

const td = {
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
};
