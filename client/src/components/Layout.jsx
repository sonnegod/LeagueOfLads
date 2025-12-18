import Navbar from './Navbar';
import Sidebar from './Sidebar';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { loading } = useAuth();

  if (loading) return <div>Loading...</div>;

  return (
    /* Use bg-white or bg-transparent here */
    <div className="flex h-screen w-full bg-white overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Navbar />
        {/* The background of this main tag is what 'HeadToHeadPage' sits on */}
        <main className="content flex-1 overflow-y-auto bg-transparent">
          <Outlet />
        </main>
      </div>
    </div>
  );
}