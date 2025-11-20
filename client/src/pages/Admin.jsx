import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import MatchEditorPanel from "../components/MatchEditorPanel";
import CurrentLeagueTeams from "../components/CurrentLeagueTeams";
import TeamStandingEditor from "../components/TeamStandingEditor";
import DeleteMatchCard from "../components/DeleteMatchCard";


export default function AdminPage() {
  const { user, loading } = useAuth();
  const [adminData, setAdminData] = useState(null);
  const [error, setError] = useState(null);

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

     <div style={pageContainer}>
      {/* LEFT COLUMN */}
      <div style={leftColumnStyle}>
        <CurrentLeagueTeams refreshKey={refreshKey} />
      </div>

      {/* RIGHT COLUMN: 2x2 GRID */}
      <div style={rightGridStyle}>
        <MatchEditorPanel onMatchUpdated={triggerRefresh} />
        <TeamStandingEditor onTeamUpdated={triggerRefresh} />
        <DeleteMatchCard onMatchDeleted={triggerRefresh} />
        <div style={placeholderBox}>[ Future Widget ]</div>
      </div>
    </div>

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

