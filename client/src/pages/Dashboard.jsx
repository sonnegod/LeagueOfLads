import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import NameChangeDashboard from '../components/NameChangeDashboard';
import { PersonalStats } from '../components/PersonalStats';

// ⚠️ You need to create and import these new components
import MyBets from '../components/MyBets'; 
import WalletInfo from '../components/WalletInfo'; 

export default function Dashboard() {
  const { user, loading } = useAuth();
  
  // State to track which tab is currently active (default to 'stats')
  const [activeTab, setActiveTab] = useState('stats'); 

  if (loading) return <p>Loading...</p>;
  if (!user) return <p>You are not logged in.</p>;
  
  const { accountId } = user;

  // --- Helper function to render the content based on the active tab ---
  const renderContent = () => {
    switch (activeTab) {
      case 'stats':
        return <PersonalStats accountId={accountId} />;
      case 'bets':
        // Pass the required ID to fetch user-specific bet data
        return <MyBets userId={user.accountId} />;
      case 'wallet':
        // Pass the required ID to fetch user-specific wallet data
        return <WalletInfo userId={user.accountId} />;
      default:
        return <PersonalStats accountId={accountId} />;
    }
  };

  return (
    <div>
      <h1>Welcome, {user.personaname}</h1>
      <img src={user.avatar} alt="Avatar" />
      <NameChangeDashboard />

      {/* --- Tab Navigation --- */}
      <div className="tab-navigation">
        <button 
          className={activeTab === 'stats' ? 'active' : ''} 
          onClick={() => setActiveTab('stats')}
        >
          Stats
        </button>
        <button 
          className={activeTab === 'bets' ? 'active' : ''} 
          onClick={() => setActiveTab('bets')}
        >
          My Bets
        </button>
        <button 
          className={activeTab === 'wallet' ? 'active' : ''} 
          onClick={() => setActiveTab('wallet')}
        >
          Wallet Info
        </button>
      </div>
      
      <hr />

      {/* --- Tab Content Area --- */}
      <div className="tab-content">
        {renderContent()}
      </div>
    </div>
  );
}