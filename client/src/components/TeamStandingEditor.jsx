import React, { useState } from "react";

export default function TeamStandingsEditor({onTeamUpdated}) {
  const [teamId, setTeamId] = useState("");
  const [teamName, setTeamName] = useState("");

  const [wins, setWins] = useState("");
  const [losses, setLosses] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [original, setOriginal] = useState(null);
  

  // --------------------------
  // Load standings from backend
  // --------------------------
  const loadStandings = async () => {
    if (!teamId.trim() || isNaN(teamId)) {
      setMessage("Enter a valid Team ID.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch(`/api/admin/teamStandings/${teamId}`);
      const data = await res.json();

      if (!data) {
        setMessage("Team not found in current league.");
      } else {
        setWins(data.result[0].Wins);
        setLosses(data.result[0].Losses);
        setTeamId(data.result[0].TeamId);
        setTeamName(data.result[0].TeamName);
        setMessage("Standings loaded.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error loading standings.");
    } finally {
      setLoading(false);
    }
  };

  // --------------------------
  // Update standings
  // --------------------------
  const updateStandings = async () => {
    if (wins === "" || losses === "") {
      setMessage("Wins and Losses cannot be empty.");
      return;
    }

    if (isNaN(wins) || isNaN(losses)) {
      setMessage("Wins and Losses must be numeric.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/updateTeamStandings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: Number(teamId),
          wins: Number(wins),
          losses: Number(losses)
        })
      });

      const data = await res.json();

      if (data.success) {
        setMessage("Standings updated successfully!");

        onTeamUpdated && onTeamUpdated();

      } else {
        setMessage("Update failed.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error updating standings.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={adminWidgetStyle}
    >
      <h3 style={{ textAlign: "center", marginBottom: "12px" }}>
        Team Standings Editor
      </h3>

      {/* TEAM ID */}
      <div style={{ marginBottom: "12px" }}>
        <label>Team ID</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            style={{ flex: 1 }}
            placeholder="Enter Team ID"
          />
          <button onClick={loadStandings}>Load</button>
        </div>
      </div>

      {/* TEAM NAME (read-only) */}
        <div style={{ marginBottom: "12px" }}>
          <label>Team Name</label>
          <input
            type="text"
            value={teamName}
            readOnly
            style={{
              width: "100%",
              cursor: "default",
              userSelect: "none",

            }}
          />
        </div>

      {/* WINS */}
      <div style={{ marginBottom: "12px" }}>
        <label>Wins</label>
        <input
          type="text"
          value={wins}
          onChange={(e) => setWins(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      {/* LOSSES */}
      <div style={{ marginBottom: "12px" }}>
        <label>Losses</label>
        <input
          type="text"
          value={losses}
          onChange={(e) => setLosses(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      <button
        onClick={updateStandings}
        disabled={loading}
        style={{
          width: "100%",
          padding: "8px",
          background: "#0077ff",
          color: "white",
          border: "none",
          borderRadius: "6px"
        }}
      >
        {loading ? "Updating..." : "Update Standings"}
      </button>

      {message && (
        <div style={{ marginTop: "12px", color: "green", fontWeight: "bold" }}>
          {message}
        </div>
      )}
    </div>
  );
}

const adminWidgetStyle = {
  height: "450px",       // match CurrentLeagueTeams
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  border: "1px solid #ccc",
  borderRadius: "8px",
  padding: "16px",
  boxSizing: "border-box",
};
