import { useEffect, useState } from "react";

export default function LeagueAdminPanel() {
  const [activeLeague, setActiveLeague] = useState(null);
  const [leagueId, setLeagueId] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const loadActiveLeague = async () => {
      try {
        const res = await fetch("/api/admin/activeLeague");
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to load active league");
        }

        setActiveLeague(data.league);
      } catch (err) {
        setError(err.message);
      }
    };

    loadActiveLeague();
  }, []);

  const addLeague = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch("/api/admin/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, leagueName }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to add league");
      }

      setActiveLeague(data.league);
      setLeagueId("");
      setLeagueName("");
      setMessage(`${data.league.LeagueName} was added as active.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={panelGridStyle}>
      <div style={adminWidgetStyle}>
        <div>
          <h3 style={headingStyle}>Add New League</h3>
          <p style={descriptionStyle}>
            Adding a league inserts it as active.
          </p>

          <form onSubmit={addLeague} style={formStyle}>
            <label htmlFor="league-id">League ID</label>
            <input
              id="league-id"
              type="number"
              min="1"
              step="1"
              required
              value={leagueId}
              onChange={(event) => setLeagueId(event.target.value)}
              style={inputStyle}
            />

            <label htmlFor="league-name">League Name</label>
            <input
              id="league-name"
              type="text"
              maxLength="60"
              required
              value={leagueName}
              onChange={(event) => setLeagueName(event.target.value)}
              style={inputStyle}
            />

            <button type="submit" disabled={loading} style={submitButtonStyle}>
              {loading ? "Adding League..." : "Add and Activate League"}
            </button>
          </form>
        </div>

        <div>
          {message && <div style={successStyle}>{message}</div>}
          {error && <div style={errorStyle}>{error}</div>}
        </div>
      </div>

      <div style={adminWidgetStyle}>
        <div>
          <h3 style={headingStyle}>Current Active League</h3>
          {activeLeague ? (
            <div style={activeLeagueStyle}>
              <div style={labelStyle}>League ID</div>
              <div style={valueStyle}>{activeLeague.LeagueId}</div>
              <div style={labelStyle}>League Name</div>
              <div style={valueStyle}>{activeLeague.LeagueName}</div>
            </div>
          ) : (
            <p style={descriptionStyle}>No active league found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

const panelGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "20px",
  alignItems: "start",
};

const adminWidgetStyle = {
  height: "450px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  border: "1px solid var(--border, #ccc)",
  borderRadius: "8px",
  padding: "16px",
  boxSizing: "border-box",
  background: "var(--surface, #0b0b0b)",
};

const headingStyle = {
  textAlign: "center",
  marginTop: 0,
  marginBottom: "12px",
};

const descriptionStyle = {
  color: "var(--muted-text, #9aa0b4)",
};

const formStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  textAlign: "left",
  marginTop: "24px",
};

const inputStyle = {
  width: "100%",
  padding: "10px",
  border: "1px solid var(--border, #222428)",
  borderRadius: "6px",
  boxSizing: "border-box",
  background: "var(--button-bg, #1a1a1a)",
  color: "var(--text, #e6e6e6)",
};

const submitButtonStyle = {
  width: "100%",
  marginTop: "12px",
  background: "var(--primary, #646cff)",
  color: "white",
};

const activeLeagueStyle = {
  display: "grid",
  gap: "8px",
  marginTop: "32px",
  padding: "20px",
  border: "1px solid var(--border, #222428)",
  borderRadius: "8px",
  textAlign: "left",
};

const labelStyle = {
  color: "var(--muted-text, #9aa0b4)",
  fontSize: "0.9rem",
};

const valueStyle = {
  fontSize: "1.35rem",
  fontWeight: 600,
  marginBottom: "12px",
};

const successStyle = {
  color: "#4ade80",
  fontWeight: 600,
};

const errorStyle = {
  color: "#f87171",
  fontWeight: 600,
};
