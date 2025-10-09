import Navbar from './Navbar';
import Sidebar from './Sidebar';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { loading, user } = useAuth();

  if (loading) return <div>Loading...</div>;

  return (
    <div className="app">
      <Sidebar />
      <div className="main-container">
        <Navbar />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
