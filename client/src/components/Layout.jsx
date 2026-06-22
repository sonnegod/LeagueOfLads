import Navbar from './Navbar';
import Sidebar from './Sidebar';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { loading } = useAuth();

  if (loading) return <div>Loading...</div>;

  return (
    /* Use bg-transparent so the global page background shows through (prevents white gaps) */
    <div className="flex h-screen w-full bg-transparent overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Navbar />
        {/* The background of this main tag is what 'HeadToHeadPage' sits on */}
        <main className="content flex-1 overflow-y-auto bg-transparent">
          <Outlet />
          <footer style={footerStyle}>
            <Link to="/privacy-policy" style={footerLinkStyle}>Privacy Policy</Link>
          </footer>
        </main>
      </div>
    </div>
  );
}

const footerStyle = {
  padding: '1rem',
  textAlign: 'center',
  fontSize: '0.82rem',
  color: 'var(--muted-text, #9aa0b4)',
};

const footerLinkStyle = {
  color: 'inherit',
  textDecoration: 'underline',
};
