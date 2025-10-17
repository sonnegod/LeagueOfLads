import { useAuth } from '../context/AuthContext';
import NameChangeDashboard from '../components/NameChangeDashboard';
import { PersonalStats } from '../components/PersonalStats';

export default function Dashboard() {
  const { user, loading } = useAuth();

  if (loading) return <p>Loading...</p>;
  if (!user) return <p>You are not logged in.</p>;
  
  const { accountId } = user;
  
  return (
    <div>
      <h1>Welcome, {user.personaname}</h1>
      <img src={user.avatar} alt="Avatar" />
      <NameChangeDashboard />
      <PersonalStats accountId={accountId} />
    </div>
  );
}
