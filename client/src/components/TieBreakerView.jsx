// src/components/TiebreakerView.jsx
import React, { useEffect, useState } from "react";
import TieBreakerTable from "./TieBreakerTable";
import UpperBracketTable from "./UpperBracketTable";
import LowerBracketTable from "./LowerBracketTable";
import EliminatedBracketTable from "./EliminatedBracketTable";
import './TieBreakerView.css';


export default function TiebreakerView({ leagueId }) {
  const [tiebreakerTeams, setTiebreakerTeams] = useState([]);
  const [upperTeams, setUpperTeams] = useState([]);
  const [lowerTeams, setLowerTeams] = useState([]);
  const [eliminatedTeams, setEliminatedTeams] = useState([]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const url = leagueId
          ? `/api/tiebreakerInfo?leagueId=${leagueId}`
          : "/api/tiebreakerInfo";
        const res = await fetch(url);
        const data = await res.json();

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
  }, [leagueId]);

  if (loading) return <p>Loading tiebreakers...</p>;

  return (
    <div className="tiebreaker-view" style={{ padding: "1rem" }}>

      {/* Top: Tiebreaker Table */}
      <TieBreakerTable teams={tiebreakerTeams} leagueId={leagueId} />

      {/* Bottom: Upper + Lower Tables side-by-side */}
      <div
        className="tiebreaker-brackets"
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
