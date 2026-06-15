import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import MatchEditorPanel from "../components/MatchEditorPanel";
import CurrentLeagueTeams from "../components/CurrentLeagueTeams";
import TeamStandingEditor from "../components/TeamStandingEditor";
import TeamGroupEditor from "../components/TeamGroupEditor";
import DeleteMatchCard from "../components/DeleteMatchCard";
import PlayoffAdminPanel from "../components/PlayoffAdminPanel";
import PlayoffBracketEditor from "../components/PlayoffBracketEditor";
import LeagueAdminPanel from "../components/LeagueAdminPanel";


export default function AdminPage() {
  const { user, loading } = useAuth();
  const [adminData, setAdminData] = useState(null);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState("editor"); // editor | playoffs | admin


  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = () => {
    setRefreshKey(k => k + 1);
  };

  useEffect(() => {
    if (!loading) {
      fetch('/api/admin')
        .then(res => {
          if (!res.ok) throw new Error('Not authorized');
          return res.json();
        })
        .then(data => setAdminData(data))
        .catch(err => setError(err.message));
    }
  }, [loading]);

  if (loading) return <div>Loading...</div>;
  if (error) return <Navigate to="/" />;
  if (!adminData) return <div>Loading admin data...</div>;

   return (
    <div style={{ padding: 20 }}>
      <h1>Admin Panel</h1>

      <div style={tabBarStyle}>
        <button
          style={activeTab === "editor" ? tabActiveStyle : tabButtonStyle}
          onClick={() => setActiveTab("editor")}
        >
          Editor Tab
        </button>

        <button
          style={activeTab === "playoffs" ? tabActiveStyle : tabButtonStyle}
          onClick={() => setActiveTab("playoffs")}
        >
          Playoff Tab
        </button>

        <button
          style={activeTab === "admin" ? tabActiveStyle : tabButtonStyle}
          onClick={() => setActiveTab("admin")}
        >
          Admin Tab
        </button>
      </div>


      {activeTab === "editor" && (
          <div style={pageContainer}>
            {/* LEFT COLUMN */}
            <div style={leftColumnStyle}>
              <CurrentLeagueTeams refreshKey={refreshKey} />
            </div>

            {/* RIGHT COLUMN 2x2 */}
            <div style={rightGridStyle}>
              <MatchEditorPanel onMatchUpdated={triggerRefresh} />
              <TeamStandingEditor onTeamUpdated={triggerRefresh} />
              <DeleteMatchCard onMatchDeleted={triggerRefresh} />
              <TeamGroupEditor onTeamUpdated={triggerRefresh} />
            </div>
          </div>
        )}

        {activeTab === "playoffs" && (
          <div>
            <PlayoffAdminPanel />
            <PlayoffBracketEditor />
          </div>
        )}

        {activeTab === "admin" && <LeagueAdminPanel />}
    </div>
  );
}

const pageContainer = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",  // Left = 50%, Right = 50%
  gap: "20px",
  width: "100%",
  alignItems: "flex-start",
};

const leftColumnStyle = {
  height: "100%", 
  overflow: "auto",      // keeps it scrollable
};

const rightGridStyle = {
  display: "grid",
  // 2x2 grid layout for the right column widgets
  gridTemplateColumns: "1fr 1fr",
  gridTemplateRows: "auto auto",
  gap: "20px",
  // keep items aligned to the top of each cell and avoid vertical stretching
  alignItems: "start",
  alignContent: "start",
};

const tabBarStyle = {
  display: "flex",
  gap: "12px",
  marginBottom: "20px",
};

const tabButtonStyle = {
  padding: "10px 18px",
  borderRadius: "6px",
  border: "1px solid var(--border, #222428)",
  background: "var(--surface, #0b0b0b)",
  color: "var(--text, #e6e6e6)",
  cursor: "pointer",
};

const tabActiveStyle = {
  ...tabButtonStyle,
  background: "var(--primary, #646cff)",
  color: "white",
  borderColor: "#005fcc",
};
