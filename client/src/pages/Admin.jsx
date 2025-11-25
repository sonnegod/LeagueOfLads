import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import MatchEditorPanel from "../components/MatchEditorPanel";
import CurrentLeagueTeams from "../components/CurrentLeagueTeams";
import TeamStandingEditor from "../components/TeamStandingEditor";
import DeleteMatchCard from "../components/DeleteMatchCard";
import PlayoffAdminPanel from "../components/PlayoffAdminPanel";
import PlayoffBracketEditor from "../components/PlayoffBracketEditor";


export default function AdminPage() {
  const { user, loading } = useAuth();
  const [adminData, setAdminData] = useState(null);
  const [error, setError] = useState(null);

  const [stageInfo, setStageInfo] = useState(null);

  const [activeTab, setActiveTab] = useState("editor"); // editor | playoffs


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
          Editor Page
        </button>

        <button
          style={activeTab === "playoffs" ? tabActiveStyle : tabButtonStyle}
          onClick={() => setActiveTab("playoffs")}
        >
          Playoff Page
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
              <div style={placeholderBox}>[ Future Widget ]</div>
            </div>
          </div>
        )}

        {activeTab === "playoffs" && (
          <div>
            <PlayoffAdminPanel />
            <PlayoffBracketEditor />
          </div>
        )}
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
  gridTemplateColumns: "1fr 1fr",  // 2 columns
  gridTemplateRows: "1fr 1fr",     // 2 rows
  gap: "20px",
  height: "100%",        // <--- match left column

};

const placeholderBox = {
  border: "1px dashed #ccc",
  padding: "20px",
  borderRadius: "8px",
  height: "100%",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

const tabBarStyle = {
  display: "flex",
  gap: "12px",
  marginBottom: "20px",
};

const tabButtonStyle = {
  padding: "10px 18px",
  borderRadius: "6px",
  border: "1px solid #ccc",
  background: "#f4f4f4",
  cursor: "pointer",
};

const tabActiveStyle = {
  ...tabButtonStyle,
  background: "#007bff",
  color: "white",
  borderColor: "#005fcc",
};
