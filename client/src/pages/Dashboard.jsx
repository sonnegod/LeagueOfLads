import { useAuth } from '../context/AuthContext';
import NameChangeDashboard from '../components/NameChangeDashboard';

export default function Dashboard() {
  const { user, loading } = useAuth();

  if (loading) return <p>Loading...</p>;
  if (!user) return <p>You are not logged in.</p>;

  return (
    <div>
      <h1>Welcome, {user.personaname}</h1>
      <img src={user.avatar} alt="Avatar" />
      <NameChangeDashboard />

    </div>
  );
}
