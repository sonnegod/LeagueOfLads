import React, { useState } from "react";

export default function DeleteMatchCard({ onMatchDeleted }) {
  const [matchId, setMatchId] = useState("");
  const [matchData, setMatchData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // ------------------------------
  // Load match info
  // ------------------------------
  const loadMatch = async () => {
    if (!matchId.trim()) {
      setMessage("Enter a match ID.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch(`/api/matchEdit/${matchId}`);
      const data = await res.json();


      if (!data) {
        setMatchData(null);
        setMessage("Match not found.");
      } else {
        setMatchData(data);
        setMessage("Match loaded.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error loading match.");
    }

    setLoading(false);
  };

  // ------------------------------
  // Delete match
  // ------------------------------
  const deleteMatch = async () => {
    if (!matchData) {
      setMessage("Load a match first.");
      return;
    }

    const confirmDelete = window.confirm(
      `Are you sure you want to delete Match ${matchId}?`
    );

    if (!confirmDelete) return;

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/deleteMatch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });

      const data = await res.json();

      if (data.success) {
        setMessage(`Match ${matchId} deleted successfully.`);
        setMatchData(null);
        setMatchId("");

        onMatchDeleted && onMatchDeleted();
      } else {
        setMessage("Delete failed.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error deleting match.");
    }

    setLoading(false);
  };

  return (
    <div
      style={{
        padding: "20px",
        border: "1px solid #ccc",
        borderRadius: 8,
        width: "100%",
        maxWidth: "none",
        minHeight: "450px", // match the height of others
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h3 style={{ marginTop: 0 }}>Delete Match</h3>

      {/* MATCH ID INPUT */}
      <label>Match ID</label>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <input
          type="text"
          value={matchId}
          onChange={(e) => setMatchId(e.target.value)}
          placeholder="Enter match ID"
          style={{ flex: 1 }}
        />
        <button onClick={loadMatch}>Load</button>
      </div>

      {/* MATCH PREVIEW */}
      {matchData && (
        <div
          style={{
            background: "#f4f4f4",
            padding: "10px",
            borderRadius: 6,
            marginBottom: "16px",
          }}
        >
          <strong>Team 1:</strong> {matchData.team1.TeamName || 'Null'} <br />
          <strong>Team 2:</strong> {matchData.team2.TeamName || 'Null'} <br />
        </div>
      )}

      {/* DELETE BUTTON */}
      <button
        onClick={deleteMatch}
        disabled={loading || !matchData}
        style={{
          width: "100%",
          padding: "10px",
          background: "#d11a2a",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          marginTop: "auto",
        }}
      >
        {loading ? "Deleting…" : "Delete Match"}
      </button>

      {message && (
        <div style={{ marginTop: 12, color: "green", fontWeight: 600 }}>
          {message}
        </div>
      )}
    </div>
  );
}
