import React, { useState, useEffect } from "react";

export default function MatchEditorPanel({ onMatchUpdated }) {
  const [matchId, setMatchId] = useState("");
  const [teamList, setTeamList] = useState([]);

  const [team1, setTeam1] = useState("");
  const [team2, setTeam2] = useState("");
  const [winner, setWinner] = useState("");

  const [original, setOriginal] = useState(null);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // ---------------------------------------------------------
  // Load full list of teams (used for dropdowns)
  // ---------------------------------------------------------
  useEffect(() => {
    fetch("/api/activeTeams")
      .then(res => res.json())
      .then(data => setTeamList(data.teams))
      .catch(err => console.error("Team load error:", err));
  }, []);

  // ---------------------------------------------------------
  // Load match data by ID
  // ---------------------------------------------------------
  const loadMatch = async () => {
    if (!matchId.trim()) {
        setMessage("Enter a Match ID.");
        return;
    }

    setLoading(true);
    setMessage("");

    try {
        const res = await fetch(`/api/matchEdit/${matchId}`);
        const data = await res.json();


        if (!data || Object.keys(data).length === 0) {
        setMessage("Match not found.");
        } else {
        setTeam1(data.team1.TeamId || "");
        setTeam2(data.team2.TeamId || "");
        setWinner(data.winner.TeamId || "");
        setMessage("Match loaded successfully.");

        //helps check for change
        setOriginal({
            team1: data.team1.TeamId,
            team2: data.team2.TeamId,
            winner: data.winner.TeamId,
        });
        }
    } catch (err) {
        console.error("Load error:", err);
        setMessage("Error loading match.");
    }

    setLoading(false);
  };


  // ---------------------------------------------------------
  // Update match in DB
  // ---------------------------------------------------------
  const updateMatch = async () => {
    if (!team1 || !team2) {
      setMessage("Team1 and Team2 must be selected.");
      return;
    }

    if (
        team1 === original.team1 &&
        team2 === original.team2 &&
        winner === original.winner
    ) {
        setMessage("No changes detected.");
        return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/updateMatchTeams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId,
          team1,
          team2,
          winner,

          team1Old: original.team1,
          team2Old: original.team2,
        })
      });

      const result = await res.json();

      if (result.success) {
        setMessage("Match updated successfully!");
        
        //need to reset new values
        setOriginal({
            team1,
            team2,
            winner,
        });

        onMatchUpdated && onMatchUpdated();
      } else {
        setMessage("Update failed.");
      }
    } catch (err) {
      console.error("Update error:", err);
      setMessage("Error updating match.");
    }

    setLoading(false);
  };

  return (
    <div
      style={{
        padding: "20px",
        border: "1px solid #ccc",
        borderRadius: 8,
        maxWidth: 400,
      }}
    >
      <h3 style={{ marginTop: 0 }}>Match Editor</h3>

      {/* MATCH ID INPUT */}
      <label>Match ID</label>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <input
          type="text"
          value={matchId}
          onChange={e => setMatchId(e.target.value)}
          placeholder="Enter match ID"
          style={{ flex: 1 }}
        />
        <button onClick={loadMatch}>Load</button>
      </div>

      {/* TEAM 1 */}
      <label>Team 1</label>
      <select
        value={team1}
        onChange={e => setTeam1(e.target.value)}
        style={{ width: "100%", marginBottom: 12 }}
      >
        <option value="">Select Team</option>
        {teamList.map(t => (
            <option key={t.TeamId} value={t.TeamId}>
            {t.TeamName}
            </option>
        ))}
      </select>

      {/* TEAM 2 */}
      <label>Team 2</label>
      <select
        value={team2}
        onChange={e => setTeam2(e.target.value)}
        style={{ width: "100%", marginBottom: 12 }}
      >
        <option value="">Select Team</option>
        {teamList.map(t => (
            <option key={t.TeamId} value={t.TeamId}>
            {t.TeamName}
            </option>
        ))}
      </select>

      {/* WINNER */}
      <label>Winner</label>
      <select
        value={winner}
        onChange={e => setWinner(e.target.value)}
        style={{ width: "100%", marginBottom: 18 }}
      >
        <option value="">Select Winner</option>

        {team1 && (
            <option value={team1}>
            {teamList.find(t => t.TeamId == team1)?.TeamName}
            </option>
        )}

        {team2 && (
            <option value={team2}>
            {teamList.find(t => t.TeamId == team2)?.TeamName}
            </option>
        )}
      </select>

      <button
        onClick={updateMatch}
        disabled={loading}
        style={{
          width: "100%",
          padding: "8px 12px",
          background: "#0077ff",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer"
        }}
      >
        {loading ? "Updating…" : "Update Match"}
      </button>

      {message && (
        <div style={{ marginTop: 12, color: "green", fontWeight: 600 }}>
          {message}
        </div>
      )}
    </div>
  );
}
