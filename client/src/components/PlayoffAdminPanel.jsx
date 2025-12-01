import React, { useState, useEffect } from "react";

export default function PlayoffAdminPanel() {
  const [stageInfo, setStageInfo] = useState(null);     // row from LeagueStageBoundaries OR null
  const [stage, setStage] = useState(null);
  const [message, setMessage] = useState("");

  // -----------------------------------------------------
  // Load existing stage info + latest match ID
  // -----------------------------------------------------
  const loadStageInfo = async () => {
    try {
      const res = await fetch(`/api/leagueStage`);
      const data = await res.json();


      setStageInfo(data[0] || data.stageInfo);
      
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
        setMessage("Failed to activate tiebreakers.");
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
        setMessage("Failed to activate playoffs.");
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
  
  const { groupEndMatchId, tieBreakerEndMatchId } = stageInfo;

  const showTiebreakerBtn = !groupEndMatchId;                              // No record OR no group end match → can tiebreak
  const showPlayoffBtn = !(groupEndMatchId && tieBreakerEndMatchId);       // Show until both filled

  return (
    <div style={panelStyle}>
      <h2>Tiebreaker / Playoff Administration</h2>

      <p style={{ fontWeight: "bold" }}>
        Current Stage: <span style={{ color: "#0077ff" }}>{stage}</span>
      </p>

      <div style={{ marginBottom: "10px" }}>
        {showTiebreakerBtn && (
          <button style={buttonStyle} onClick={triggerTiebreakers}>
            Start Tiebreakers
          </button>
        )}

        {showPlayoffBtn && (
          <button style={buttonStyle} onClick={triggerPlayoffs}>
            Start Playoffs
          </button>
        )}
      </div>

      {message && (
        <p style={{ color: "green", fontWeight: "bold", marginTop: "10px" }}>
          {message}
        </p>
      )}
    </div>
  );
}

const panelStyle = {
  border: "1px solid #ddd",
  padding: "20px",
  borderRadius: "8px",
  background: "white",
};

const buttonStyle = {
  padding: "10px 15px",
  marginRight: "10px",
  background: "#0077ff",
  border: "none",
  borderRadius: "6px",
  color: "white",
  cursor: "pointer",
};
