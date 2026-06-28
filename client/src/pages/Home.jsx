import React, { useEffect, useState } from "react";

import CurrentLeagueSeries from "../components/CurrentLeagueSeries";
import CurrentLeaderboardTable from "../components/CurrentLeaderboardTable";
import TieBreakerView from "../components/TieBreakerView";   // you will create
import CurrentPlayoffBracketView from "../components/CurrentPlayoffBracketView"; // you will create
import './Home.css';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [stageInfo, setStageInfo] = useState(null);
  const [activeTab, setActiveTab] = useState("group"); // default tab

  // ----------------------------------------------------
  // Load stage info
  // ----------------------------------------------------
  useEffect(() => {
    setLoading(true);
    fetch("/api/leagueStage")
      .then((res) => res.json())
      .then((data) => {
        setStageInfo(data[0] || data.stageInfo);
        
        if (!data.exists) {
          setActiveTab("group"); // group stage
        } else if (data[0].GroupEndMatchId && !data[0].TieBreakerEndMatchId) {
          setActiveTab("tiebreakers");
        } else if (data[0].GroupEndMatchId && data[0].TieBreakerEndMatchId) {
          setActiveTab("playoffs");
        }
      })
      .catch((err) => {
        console.error("Error fetching league stage:", err);
        setStageInfo(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading recent series...</div>;
  if (!stageInfo) return <div>Loading league stage...</div>;

  const inGroupStage = !stageInfo.GroupEndMatchId && !stageInfo.TieBreakerEndMatchId;

  const inTiebreakers =
    stageInfo.GroupEndMatchId &&
    !stageInfo.TieBreakerEndMatchId;

  const inPlayoffs =
    stageInfo.GroupEndMatchId &&
    stageInfo.TieBreakerEndMatchId;

  const noSeparateTiebreaker =
    stageInfo.GroupEndMatchId === stageInfo.TieBreakerEndMatchId;

  // ----------------------------------------------------
  // Render GROUP STAGE (original view)
  // ----------------------------------------------------
  if (inGroupStage) {
    return (
      <div className="home-page" style={{ padding: "1rem" }}>
        <CurrentLeaderboardTable />

        <hr style={{ margin: "2rem 0" }} />

        <h2>Recent Series</h2>
        <CurrentLeagueSeries />
      </div>
    );
  }

  // ----------------------------------------------------
  // Render TIEBREAKERS / PLAYOFFS WITH TABS
  // ----------------------------------------------------

  return (
    <div className="home-page" style={{ padding: "1rem" }}>
      {/* TABS */}
      <div className="home-tabs" style={tabBarStyle}>
        {inPlayoffs && (
          <button
            style={activeTab === "playoffs" ? tabActive : tabInactive}
            onClick={() => setActiveTab("playoffs")}
          >
            Playoffs
          </button>
        )}

        {inPlayoffs && !noSeparateTiebreaker && (
          <button
            style={activeTab === "tiebreakers" ? tabActive : tabInactive}
            onClick={() => setActiveTab("tiebreakers")}
          >
            Tiebreakers
          </button>
        )}

        {inTiebreakers && (
          <button
            style={activeTab === "tiebreakers" ? tabActive : tabInactive}
            onClick={() => setActiveTab("tiebreakers")}
          >
            Tiebreakers
          </button>
        )}

        <button
          style={activeTab === "group" ? tabActive : tabInactive}
          onClick={() => setActiveTab("group")}
        >
          Groups
        </button>
      </div>

      {/* TAB CONTENT */}
      <div style={{ marginTop: "20px" }}>
        {activeTab === "group" && (
          <>
            <CurrentLeaderboardTable />
            <hr style={{ margin: "2rem 0" }} />
            <h2>Recent Series</h2>
            <CurrentLeagueSeries />
          </>
        )}

        {activeTab === "tiebreakers" && (
          <TieBreakerView />
        )}

        {activeTab === "playoffs" && (
          <CurrentPlayoffBracketView />
        )}
      </div>
    </div>
  );
}

/* ------------------ TAB STYLES -------------------- */

const tabBarStyle = {
  display: "flex",
  gap: "12px",
  marginBottom: "10px",
};

const tabBase = {
  padding: "10px 15px",
  borderRadius: "6px",
  cursor: "pointer",
  border: "1px solid var(--border, #222428)",
  background: "#000",
  color: "#fff",
};

const tabActive = {
  ...tabBase,
  background: "var(--primary, #646cff)",
  color: "white",
  borderColor: "#0057cc",
};

const tabInactive = {
  ...tabBase,
  background: "#0b0b0b",
};
