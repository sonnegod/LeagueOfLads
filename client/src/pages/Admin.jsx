import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import MatchEditorPanel from "../components/MatchEditorPanel";
import CurrentLeagueTeams from "../components/CurrentLeagueTeams";
import LeagueSetupTable from "../components/LeagueSetupTable";
import GroupHeadToHeadEditor from "../components/GroupHeadToHeadEditor";
import DeleteMatchCard from "../components/DeleteMatchCard";
import PlayoffAdminPanel from "../components/PlayoffAdminPanel";
import PlayoffBracketEditor from "../components/PlayoffBracketEditor";
import LeagueAdminPanel from "../components/LeagueAdminPanel";
import LeagueRulesCard from "../components/LeagueRulesCard";
import AdminManagementPanel from "../components/AdminManagementPanel";


export default function AdminPage() {
  const { loading } = useAuth();
  const [adminData, setAdminData] = useState(null);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState("editor"); // editor | playoffs | admin
  const [activeEditorTab, setActiveEditorTab] = useState("teams");
  const [activeAdminTab, setActiveAdminTab] = useState("league");


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

        <button
          style={activeTab === "adminManagement" ? tabActiveStyle : tabButtonStyle}
          onClick={() => setActiveTab("adminManagement")}
        >
          Admin Management
        </button>
      </div>


      {activeTab === "editor" && (
          <div style={pageContainer}>
            <div role="tablist" aria-label="Editor sections" style={editorTabBarStyle}>
              <button
                id="admin-team-changes-tab"
                type="button"
                role="tab"
                aria-controls="admin-team-changes-panel"
                aria-selected={activeEditorTab === "teams"}
                style={activeEditorTab === "teams" ? editorTabActiveStyle : editorTabButtonStyle}
                onClick={() => setActiveEditorTab("teams")}
              >
                Team Changes
              </button>
              <button
                id="admin-result-changes-tab"
                type="button"
                role="tab"
                aria-controls="admin-result-changes-panel"
                aria-selected={activeEditorTab === "results"}
                style={activeEditorTab === "results" ? editorTabActiveStyle : editorTabButtonStyle}
                onClick={() => setActiveEditorTab("results")}
              >
                Result Changes
              </button>
              <button
                id="admin-match-changes-tab"
                type="button"
                role="tab"
                aria-controls="admin-match-changes-panel"
                aria-selected={activeEditorTab === "matches"}
                style={activeEditorTab === "matches" ? editorTabActiveStyle : editorTabButtonStyle}
                onClick={() => setActiveEditorTab("matches")}
              >
                Match Changes
              </button>
            </div>
            <div id="admin-team-changes-panel" role="tabpanel" aria-labelledby="admin-team-changes-tab"
              hidden={activeEditorTab !== "teams"} style={activeEditorTab === "teams" ? pageContainer : hiddenPanelStyle}>
              <CurrentLeagueTeams refreshKey={refreshKey} onTeamUpdated={triggerRefresh} />
            </div>
            <div id="admin-result-changes-panel" role="tabpanel" aria-labelledby="admin-result-changes-tab"
              hidden={activeEditorTab !== "results"} style={activeEditorTab === "results" ? pageContainer : hiddenPanelStyle}>
              <GroupHeadToHeadEditor refreshKey={refreshKey} onResultsUpdated={triggerRefresh} />
            </div>
            <div id="admin-match-changes-panel" role="tabpanel" aria-labelledby="admin-match-changes-tab"
              hidden={activeEditorTab !== "matches"} style={activeEditorTab === "matches" ? pageContainer : hiddenPanelStyle}>
              <div style={rightGridStyle}>
                <MatchEditorPanel onMatchUpdated={triggerRefresh} />
                <DeleteMatchCard onMatchDeleted={triggerRefresh} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "playoffs" && (
          <div>
            <PlayoffAdminPanel />
            <PlayoffBracketEditor />
          </div>
        )}

        {activeTab === "admin" && (
          <div style={pageContainer}>
            <div role="tablist" aria-label="Admin sections" style={editorTabBarStyle}>
              <button
                id="admin-new-league-tab"
                type="button"
                role="tab"
                aria-controls="admin-new-league-panel"
                aria-selected={activeAdminTab === "league"}
                style={activeAdminTab === "league" ? editorTabActiveStyle : editorTabButtonStyle}
                onClick={() => setActiveAdminTab("league")}
              >
                New League
              </button>
              <button
                id="admin-group-setup-tab"
                type="button"
                role="tab"
                aria-controls="admin-group-setup-panel"
                aria-selected={activeAdminTab === "groups"}
                style={activeAdminTab === "groups" ? editorTabActiveStyle : editorTabButtonStyle}
                onClick={() => setActiveAdminTab("groups")}
              >
                Group Setup
              </button>
            </div>
            {activeAdminTab === "league" && <div id="admin-new-league-panel" role="tabpanel"
              aria-labelledby="admin-new-league-tab" style={pageContainer}>
              <LeagueAdminPanel onLeagueAdded={triggerRefresh} />
              <LeagueRulesCard refreshKey={refreshKey} />
            </div>}
            {activeAdminTab === "groups" && <div id="admin-group-setup-panel" role="tabpanel"
              aria-labelledby="admin-group-setup-tab" style={pageContainer}>
              <LeagueSetupTable refreshKey={refreshKey} onUpdated={triggerRefresh} />
            </div>}
          </div>
        )}
        {activeTab === "adminManagement" && <AdminManagementPanel />}
    </div>
  );
}

const pageContainer = {
  display: "grid",
  gap: "20px",
  minWidth: 0,
};

const hiddenPanelStyle = { display: "none" };

const rightGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "20px",
  alignItems: "start",
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

const editorTabBarStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

const editorTabButtonStyle = {
  ...tabButtonStyle,
  padding: "8px 14px",
};

const editorTabActiveStyle = {
  ...editorTabButtonStyle,
  borderColor: "var(--primary, #646cff)",
  boxShadow: "inset 0 -2px 0 var(--primary, #646cff)",
};
