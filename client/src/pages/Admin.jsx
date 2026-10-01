import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import MatchEditorPanel from "../components/MatchEditorPanel";
import MatchTeamIdReplacementCard from "../components/MatchTeamIdReplacementCard";
import CurrentLeagueTeams from "../components/CurrentLeagueTeams";
import LeagueSetupTable from "../components/LeagueSetupTable";
import GroupHeadToHeadEditor from "../components/GroupHeadToHeadEditor";
import DeleteMatchCard from "../components/DeleteMatchCard";
import PlayoffBracketEditor from "../components/PlayoffBracketEditor";
import SeasonAdminPanel from "../components/SeasonAdminPanel";
import UnmatchedMatchTeamsPanel from "../components/UnmatchedMatchTeamsPanel";
import LeagueRulesCard from "../components/LeagueRulesCard";
import AdminManagementPanel from "../components/AdminManagementPanel";
import AdminRequestsPanel from "../components/AdminRequestsPanel";
import RulesAdminPanel from "../components/RulesAdminPanel";
import AdminAuditLogPanel from "../components/AdminAuditLogPanel";
import AdjustedPlayersPanel from "../components/AdjustedPlayersPanel";


export default function AdminPage() {
  const { loading } = useAuth();
  const [adminData, setAdminData] = useState(null);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState("league");
  const [activeLeagueTab, setActiveLeagueTab] = useState("overview");
  const [activeEditorTab, setActiveEditorTab] = useState("teams");
  const [activeAdminTab, setActiveAdminTab] = useState("requests");
  const [seasonStatus, setSeasonStatus] = useState(null);


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

  useEffect(() => {
    let active = true;
    fetch('/api/admin/seasons/current').then(response => response.json()).then(data => {
      if (!active) return;
      const status = data.season?.Status || null;
      setSeasonStatus(status);
      if (status !== 'active') setActiveLeagueTab('overview');
    }).catch(() => {});
    return () => { active = false; };
  }, [refreshKey]);

  if (loading) return <div>Loading...</div>;
  if (error) return <Navigate to="/" />;
  if (!adminData) return <div>Loading admin data...</div>;

   return (
    <div className={`ui-page admin-page${activeTab === 'admin' && activeAdminTab === 'rules' ? ' admin-page-rules' : ''}`}>
      <h1>Admin Panel</h1>

      <div className="ui-tabs" style={tabBarStyle}>
        <button
          className="ui-tab" aria-pressed={activeTab === "league"}
          style={activeTab === "league" ? tabActiveStyle : tabButtonStyle}
          onClick={() => setActiveTab("league")}
        >
          League
        </button>

        <button
          className="ui-tab" aria-pressed={activeTab === "admin"}
          style={activeTab === "admin" ? tabActiveStyle : tabButtonStyle}
          onClick={() => setActiveTab("admin")}
        >
          Admin
        </button>
      </div>

      {activeTab === "league" && <div className="ui-tabs" style={editorTabBarStyle}>
        {[
          ["overview", "Overview"],
          ...(seasonStatus === 'active' ? [["editor", "Editor"], ["playoffs", "Playoffs"],
            ["settings", "Settings"]] : []),
        ].map(([key, label]) => <button key={key} type="button" className="ui-tab"
          aria-pressed={activeLeagueTab === key}
          style={activeLeagueTab === key ? editorTabActiveStyle : editorTabButtonStyle}
          onClick={() => setActiveLeagueTab(key)}>{label}</button>)}
      </div>}

      {activeTab === "admin" && <div className="ui-tabs" style={editorTabBarStyle}>
        {[
          ["requests", "Requests"], ["rules", "Rules"],
          ["adjustedPlayers", "Adjusted Players"],
          ["adminManagement", "Admin Management"], ["auditLog", "Audit Log"],
        ].map(([key, label]) => <button key={key} type="button" className="ui-tab"
          aria-pressed={activeAdminTab === key}
          style={activeAdminTab === key ? editorTabActiveStyle : editorTabButtonStyle}
          onClick={() => setActiveAdminTab(key)}>{label}</button>)}
      </div>}

      {activeTab === "league" && activeLeagueTab === "editor" && (
          <div style={pageContainer}>
            <div role="tablist" aria-label="Editor sections" className="ui-tabs" style={editorTabBarStyle}>
              <button
                id="admin-team-changes-tab"
                type="button"
                role="tab"
                aria-controls="admin-team-changes-panel"
                aria-selected={activeEditorTab === "teams"}
                className="ui-tab"
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
                className="ui-tab"
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
                className="ui-tab"
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
                <MatchTeamIdReplacementCard refreshKey={refreshKey} onUpdated={triggerRefresh} />
                <DeleteMatchCard onMatchDeleted={triggerRefresh} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "league" && activeLeagueTab === "playoffs" && (
          <div className="playoff-workspace">
            <PlayoffBracketEditor />
          </div>
        )}

        {activeTab === "league" && activeLeagueTab === "overview" &&
          <div style={pageContainer}>
            {seasonStatus === 'active' && <UnmatchedMatchTeamsPanel refreshKey={refreshKey}
              onOpenMatchChanges={() => { setActiveLeagueTab('editor'); setActiveEditorTab('matches'); }}
              onOpenGroupSetup={() => setActiveLeagueTab('settings')} />}
            <SeasonAdminPanel onChanged={triggerRefresh} />
          </div>}
        {activeTab === "league" && activeLeagueTab === "settings" &&
          <div style={pageContainer}>
            <LeagueSetupTable refreshKey={refreshKey} onUpdated={triggerRefresh} />
            <LeagueRulesCard refreshKey={refreshKey} />
          </div>}
        {activeTab === "admin" && activeAdminTab === "adminManagement" && <AdminManagementPanel />}
        {activeTab === "admin" && activeAdminTab === "requests" && <AdminRequestsPanel />}
        {activeTab === "admin" && activeAdminTab === "rules" && <RulesAdminPanel />}
        {activeTab === "admin" && activeAdminTab === "adjustedPlayers" && <AdjustedPlayersPanel />}
        {activeTab === "admin" && activeAdminTab === "auditLog" && <AdminAuditLogPanel />}
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
