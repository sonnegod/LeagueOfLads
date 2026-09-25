import React, { useState, useEffect } from "react";

export default function PlayoffAdminPanel() {
  const [stageInfo, setStageInfo] = useState(null);     // row from LeagueStageBoundaries OR null
  const [stage, setStage] = useState(null);
  const [message, setMessage] = useState("");
  const [leagueRules, setLeagueRules] = useState(null);

  // -----------------------------------------------------
  // Load existing stage info + latest match ID
  // -----------------------------------------------------
  const loadStageInfo = async () => {
    try {
      const res = await fetch(`/api/leagueStage`);
      const data = await res.json();


      setStageInfo(data[0] || data.stageInfo);
      const rulesRes = await fetch('/api/admin/leagueRules');
      const rulesData = await rulesRes.json();
      setLeagueRules(rulesData.rules || null);
      
      if (!data.exists) {
        setStage("Group Stage in Progress");
      } 
      else if (data[0].GroupEndMatchId && !data[0].TieBreakerEndMatchId) {
        setStage("Tiebreakers in Progress");
      } 
      else if (data[0].GroupEndMatchId && data[0].TieBreakerEndMatchId) {
        setStage("Playoffs in Progress");
      }
    } catch (err) {
      console.error("Failed to load stage info:", err);
    }
  };

  useEffect(() => {
    loadStageInfo();
  }, []);

  // -----------------------------------------------------
  // Start Tiebreakers
  // -----------------------------------------------------
  const triggerTiebreakers = async () => {
    if (!window.confirm("Are you sure you want to start the Tiebreaker stage?")) {
      return;
    }

    try {
      const res = await fetch("/api/admin/activateTiebreakers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();


      if (data.success) {
        setMessage("Tiebreaker stage activated.");
        setStageInfo(data.updatedRow);
      } else {
        setMessage(data.error || "Failed to activate tiebreakers.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Server error.");
    }

    loadStageInfo();
  };

  // -----------------------------------------------------
  // Start Playoffs
  // -----------------------------------------------------
  const triggerPlayoffs = async () => {

    if (!window.confirm("Are you sure you want to start the Playoffs?")) {
      return;
    }

    try {
      const res = await fetch("/api/admin/activatePlayoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();



      if (data.success) {
        setMessage("Playoffs stage activated.");
        setStageInfo(data.updatedRow);
      } else {
        setMessage(data.error || "Failed to activate playoffs.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Server error.");
    }

    loadStageInfo();
  };

  const triggerEndOfSeason = async () => {

    if (!window.confirm("Are you sure you want to End the Season?")) {
      return;
    }

    try {
      const res = await fetch("/api/admin/endSeason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();



      if (data.success) {
        setMessage("Season Ended.");
        setStageInfo(data.updatedRow);
      } else {
        setMessage("Failed to end season.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Server error.");
    }

    loadStageInfo();
  };

  // -----------------------------------------------------
  // UI Logic
  // -----------------------------------------------------

  if (!stageInfo) {
    return <div>Loading stage info...</div>;
  }
  
  const { GroupEndMatchId, TieBreakerEndMatchId } = stageInfo;

  const showTiebreakerBtn = !GroupEndMatchId && Boolean(Number(leagueRules?.HasTiebreaker));
  const showPlayoffBtn = !(GroupEndMatchId && TieBreakerEndMatchId);
  const showEndSeasonBtn = Boolean(GroupEndMatchId && TieBreakerEndMatchId);

  return (
    <div className="playoff-admin-panel" style={panelStyle}>
      <h2>Tiebreaker / Playoff Administration</h2>

      <p style={{ fontWeight: "bold" }}>
        Current Stage: <span style={{ color: "var(--primary)" }}>{stage}</span>
      </p>

      <div className="playoff-stage-actions" style={{ marginBottom: "10px" }}>
        {showTiebreakerBtn && (
          <button className="ui-button-primary" style={buttonStyle} onClick={triggerTiebreakers}>
            Start Tiebreakers
          </button>
        )}

        {showPlayoffBtn && (
          <button className="ui-button-primary" style={buttonStyle} onClick={triggerPlayoffs}>
            Start Playoffs
          </button>
        )}
        {showEndSeasonBtn && (
          <button className="ui-button-danger" style={buttonStyle} onClick={triggerEndOfSeason}>
            End Season
          </button>
        )}
      </div>

      {message && (
        <p style={{ color: "#86efac", fontWeight: "bold", marginTop: "10px" }}>
          {message}
        </p>
      )}
    </div>
  );
}

const panelStyle = {
  border: "1px solid var(--border)",
  padding: "20px",
  borderRadius: "12px",
  background: "var(--surface)",
  color: "var(--text)",
  boxShadow: "var(--ui-shadow)",
};

const buttonStyle = {
  padding: "10px 15px",
  marginRight: "10px",
  background: "#1d4ed8",
  border: "1px solid #3b82f6",
  borderRadius: "8px",
  color: "white",
  cursor: "pointer",
};
