import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import MatchEditorPanel from "../components/MatchEditorPanel";
import MatchTeamIdReplacementCard from "../components/MatchTeamIdReplacementCard";
import LeagueSetupTable from "../components/LeagueSetupTable";
import GroupHeadToHeadEditor from "../components/GroupHeadToHeadEditor";
import PlayoffBracketEditor from "../components/PlayoffBracketEditor";
import SeasonAdminPanel from "../components/SeasonAdminPanel";
import LeagueEndPanel from "../components/LeagueEndPanel";
import LeagueOverviewPanel from "../components/LeagueOverviewPanel";
import SeasonSchedulePanel from "../components/SeasonSchedulePanel";
import UnmatchedMatchTeamsPanel from "../components/UnmatchedMatchTeamsPanel";
import AdminManagementPanel from "../components/AdminManagementPanel";
import AdminRequestsPanel from "../components/AdminRequestsPanel";
import RulesAdminPanel from "../components/RulesAdminPanel";
import AdminAuditLogPanel from "../components/AdminAuditLogPanel";
import AdjustedPlayersPanel from "../components/AdjustedPlayersPanel";
import HighlightsAdminPanel from "../components/HighlightsAdminPanel";
import RosterChangesPanel from "../components/RosterChangesPanel";
import MatchSchedulingPanel from "../components/MatchSchedulingPanel";
import PastChampionsPanel from "../components/PastChampionsPanel";
import RecordManagementPanel from "../components/RecordManagementPanel";
import AdminNavigation from "../components/AdminNavigation";
import InhouseAdminPanel from "../components/InhouseAdminPanel";
import SignupHistoryPanel from "../components/SignupHistoryPanel";
import {InhouseAdminProvider, InhouseAvailability} from "../components/InhouseAdminControls";
import './Admin.css';


export default function AdminPage() {
  const { loading } = useAuth();
  const [adminData, setAdminData] = useState(null);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState("league");
  const [activeLeagueTab, setActiveLeagueTab] = useState("overview");
  const [activeEditorTab, setActiveEditorTab] = useState("groups");
  const [activeAdminTab, setActiveAdminTab] = useState("requests");
  const [activeInhouseTab, setActiveInhouseTab] = useState("settings");
  const [season, setSeason] = useState(null);
  const seasonStatus=season?.Status||null;
  const seasonId=season?.SeasonId||null;


  const [refreshKey, setRefreshKey] = useState(0);
  const [rosterRefreshKey,setRosterRefreshKey]=useState(0);
  const editorTabs=useRef(null);

  useEffect(()=>{
    editorTabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  },[activeTab,activeLeagueTab,activeEditorTab,seasonStatus]);

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
      setSeason(data.season||null);
      if (status === 'signup_closed') setActiveEditorTab('rosterChanges');
      if (status !== 'active') setActiveLeagueTab(current =>
        (current === 'signups' || (current === 'match' && data.season) || (status === 'signup_closed' && current === 'editor')) ? current : 'overview');
    }).catch(() => {});
    return () => { active = false; };
  }, [refreshKey]);

  if (loading) return <div>Loading...</div>;
  if (error) return <Navigate to="/" />;
  if (!adminData) return <div>Loading admin data...</div>;

  const sections=activeTab==='league'?[
    ['overview','Overview'],['signups','Signups'],
    ...(seasonId?[['match','Match']]:[]),
    ...(['signup_closed','active'].includes(seasonStatus)?[['editor','Editor']]:[]),
    ...(seasonStatus==='active'?[['schedule','Schedule'],['highlights','Highlights'],['settings','Settings']]:[]),
  ]:activeTab==='inhouses'?[
    ['settings','Settings'],['games','Queue & Games'],['communityManagers','Community Managers'],['audit','Activity'],
  ]:[
    ['requests','Requests'],['rules','Rules'],['adjustedPlayers','Adjusted Players'],['champions','Champions'],
    ['recordManagement','Record Management'],['adminManagement','Admin Management'],['auditLog','Audit Log'],
  ];
  const editorSections=[
    ...(seasonStatus==='active'?[
      ['groups','Groups','groups'],
      ['results','Result Changes','result-changes'],['matches','Match Changes','match-changes'],
    ]:[]),
    ...(['signup_closed','active'].includes(seasonStatus)?[['rosterChanges','Roster Changes','roster-changes']]:[]),
    ...(seasonStatus==='active'?[['playoffs','Playoffs','playoffs']]:[]),
  ];

   return (
    <InhouseAdminProvider><div className={`ui-page admin-page${activeTab === 'admin' && activeAdminTab === 'rules' ? ' admin-page-rules' : ''}`}>
      <AdminNavigation workspace={activeTab} onWorkspaceChange={setActiveTab} sections={sections}
        actions={activeTab === 'inhouses' ? <InhouseAvailability /> : undefined}
        activeSection={activeTab==='league'?activeLeagueTab:activeTab==='inhouses'?activeInhouseTab:activeAdminTab}
        onSectionChange={activeTab==='league'?setActiveLeagueTab:activeTab==='inhouses'?setActiveInhouseTab:setActiveAdminTab} />

      {activeTab === 'inhouses' && <InhouseAdminPanel section={activeInhouseTab} />}
      {activeTab === 'league' && activeLeagueTab === 'signups' && <SignupHistoryPanel />}

      {activeTab === "league" && activeLeagueTab === "editor" && (
          <div style={pageContainer}>
            <div className="admin-editor-toolbar">
            <div ref={editorTabs} role="tablist" aria-label="Editor sections" className="ui-tabs admin-editor-tabs" style={editorTabBarStyle}>
              {editorSections.map(([key,label,id])=><button
                key={key}
                id={`admin-${id}-tab`}
                type="button"
                role="tab"
                aria-controls={`admin-${id}-panel`}
                aria-selected={activeEditorTab === key}
                className="ui-tab"
                style={activeEditorTab === key ? editorTabActiveStyle : editorTabButtonStyle}
                onClick={() => setActiveEditorTab(key)}
              >
                {label}
              </button>)}
            </div>
            {activeEditorTab==='rosterChanges'&&<button type="button" className="admin-editor-refresh"
              onClick={()=>setRosterRefreshKey(value=>value+1)}>Refresh view</button>}
            </div>
            {seasonStatus==='active'&&activeEditorTab==='groups'&&<div id="admin-groups-panel" role="tabpanel" aria-labelledby="admin-groups-tab" style={pageContainer}>
              <LeagueSetupTable refreshKey={refreshKey} onUpdated={triggerRefresh} />
            </div>}
            {seasonStatus==='active'&&<><div id="admin-result-changes-panel" role="tabpanel" aria-labelledby="admin-result-changes-tab"
              hidden={activeEditorTab !== "results"} style={activeEditorTab === "results" ? pageContainer : hiddenPanelStyle}>
              <GroupHeadToHeadEditor refreshKey={refreshKey} onResultsUpdated={triggerRefresh} />
            </div>
            <div id="admin-match-changes-panel" role="tabpanel" aria-labelledby="admin-match-changes-tab"
              hidden={activeEditorTab !== "matches"} style={activeEditorTab === "matches" ? pageContainer : hiddenPanelStyle}>
              <div className="match-admin-workspace">
                <MatchEditorPanel refreshKey={refreshKey} onMatchUpdated={triggerRefresh} />
                <MatchTeamIdReplacementCard refreshKey={refreshKey} onUpdated={triggerRefresh} />
              </div>
            </div></>}
            {activeEditorTab==='rosterChanges'&&<div id="admin-roster-changes-panel" role="tabpanel" aria-labelledby="admin-roster-changes-tab" style={pageContainer}>
              <RosterChangesPanel refreshKey={`${refreshKey}:${rosterRefreshKey}`} onChanged={triggerRefresh} />
            </div>}
            {seasonStatus==='active'&&activeEditorTab==='playoffs'&&<div id="admin-playoffs-panel" role="tabpanel" aria-labelledby="admin-playoffs-tab" className="playoff-workspace">
              <PlayoffBracketEditor />
            </div>}
          </div>
        )}

        {activeTab === 'league' && activeLeagueTab === 'schedule' && seasonId &&
          <SeasonSchedulePanel key={seasonId} seasonId={seasonId} />}
        {activeTab === 'league' && activeLeagueTab === 'match' && seasonId &&
          <MatchSchedulingPanel key={seasonId} seasonId={seasonId} refreshKey={refreshKey} />}
        {activeTab === 'league' && activeLeagueTab === 'highlights' && seasonStatus === 'active' &&
          <HighlightsAdminPanel refreshKey={refreshKey} />}

        {activeTab === "league" && activeLeagueTab === "overview" &&
          <div style={pageContainer}>
            {seasonStatus === 'active' && <UnmatchedMatchTeamsPanel refreshKey={refreshKey}
              onOpenMatchChanges={() => { setActiveLeagueTab('editor'); setActiveEditorTab('matches'); }}
              onOpenGroupSetup={() => { setActiveLeagueTab('editor'); setActiveEditorTab('groups'); }} />}
            <SeasonAdminPanel onChanged={triggerRefresh} showActiveSummary={seasonStatus!=='active'} />
            {seasonStatus==='active'&&<LeagueOverviewPanel key={seasonId} seasonId={seasonId} refreshKey={refreshKey}
              onOpenSettings={()=>setActiveLeagueTab('settings')}
              onOpenMatches={()=>setActiveLeagueTab('match')} />}
          </div>}
        {activeTab === "league" && activeLeagueTab === "settings" && seasonStatus==='active' &&
          <div style={pageContainer}>
            <LeagueEndPanel key={seasonId} season={season} onEnded={triggerRefresh} />
          </div>}
        {activeTab === "admin" && activeAdminTab === "adminManagement" && <AdminManagementPanel />}
        {activeTab === "admin" && activeAdminTab === "requests" && <AdminRequestsPanel />}
        {activeTab === "admin" && activeAdminTab === "rules" && <RulesAdminPanel />}
        {activeTab === "admin" && activeAdminTab === "adjustedPlayers" && <AdjustedPlayersPanel />}
        {activeTab === "admin" && activeAdminTab === "champions" && <PastChampionsPanel onChanged={triggerRefresh} />}
        {activeTab === "admin" && activeAdminTab === "recordManagement" && <RecordManagementPanel refreshKey={refreshKey} onChanged={triggerRefresh} />}
        {activeTab === "admin" && activeAdminTab === "auditLog" && <AdminAuditLogPanel />}
    </div></InhouseAdminProvider>
  );
}

const pageContainer = {
  display: "grid",
  gap: "var(--ui-content-gap)",
  minWidth: 0,
};

const hiddenPanelStyle = { display: "none" };

const tabButtonStyle = {
  padding: "10px 18px",
  borderRadius: "6px",
  border: "1px solid var(--border, #222428)",
  background: "var(--surface, #0b0b0b)",
  color: "var(--text, #e6e6e6)",
  cursor: "pointer",
};

const editorTabBarStyle = {
  display: "flex",
  marginBottom: 0,
  flexWrap: "nowrap",
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
