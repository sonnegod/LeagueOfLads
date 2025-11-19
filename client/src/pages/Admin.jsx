import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import MatchEditorPanel from "../components/MatchEditorPanel";
import CurrentLeagueTeams from "../components/CurrentLeagueTeams";


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

      <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",   // two equal columns
        gap: "20px",
        alignItems: "flex-start",
        marginTop: "20px"      // <-- add this

      }}
    >
      <CurrentLeagueTeams refreshKey={refreshKey} />

      <MatchEditorPanel onMatchUpdated={triggerRefresh} />
    </div>
    </div>
  );
}
