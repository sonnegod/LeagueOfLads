// src/components/TiebreakerView.jsx
import React, { useEffect, useState } from "react";
import TieBreakerTable from "./TieBreakerTable";
import UpperBracketTable from "./UpperBracketTable";
import LowerBracketTable from "./LowerBracketTable";
import EliminatedBracketTable from "./EliminatedBracketTable";


export default function TiebreakerView() {
  const [tiebreakerTeams, setTiebreakerTeams] = useState([]);
  const [upperTeams, setUpperTeams] = useState([]);
  const [lowerTeams, setLowerTeams] = useState([]);
  const [eliminatedTeams, setEliminatedTeams] = useState([]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/tiebreakerInfo');
        const data = await res.json();

        console.log(data);

        setTiebreakerTeams(data.tiebreakerTeams || []);
        setUpperTeams(data.upperBracketTeams || []);
        setLowerTeams(data.lowerBracketTeams || []);
        setEliminatedTeams(data.eliminatedTeams || []);
      } catch (err) {
        console.error("Failed to load tiebreaker view data", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <p>Loading tiebreakers...</p>;

  return (
    <div style={{ padding: "1rem" }}>

      {/* Top: Tiebreaker Table */}
      <TieBreakerTable teams={tiebreakerTeams} />

      {/* Bottom: Upper + Lower Tables side-by-side */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "20px",
          marginTop: "2rem"
        }}
      >
        <UpperBracketTable teams={upperTeams} />
        <LowerBracketTable teams={lowerTeams} />
        <EliminatedBracketTable teams={eliminatedTeams} />

      </div>
    </div>
  );
}
