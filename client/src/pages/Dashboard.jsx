import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight,Pencil} from 'lucide-react';
import {useAuth} from '../context/AuthContext';
import NameChangeDashboard from '../components/NameChangeDashboard';
import {PersonalStats} from '../components/PersonalStats';
import SeasonBettingAccount from '../components/SeasonBettingAccount';
import './PlayerDashboard.css';

export default function Dashboard() {
  const {user,setUser,loading:authLoading}=useAuth();
  const [activeTab,setActiveTab]=useState('overview'),[editingName,setEditingName]=useState(false);
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const accountId=user?.accountId;
  useEffect(()=>{
    if(!accountId)return;
    const controller=new AbortController();setLoading(true);setError('');
    fetch(`/api/playerDashboard/${accountId}`,{signal:controller.signal}).then(async response=>{
      const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to load your dashboard');return result;
    }).then(result=>{if(!controller.signal.aborted)setData(result);})
      .catch(err=>{if(!controller.signal.aborted)setError(err.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[accountId,refresh]);
  if(authLoading)return <div className="ui-page" role="status">Loading your dashboard…</div>;
  if(!user)return <div className="ui-page player-dashboard"><section className="ui-panel player-dashboard-signed-out">
    <h1>Your player dashboard</h1><p>Sign in to see your league record, manage your league name, and track your season bets.</p>
    <a className="player-dashboard-primary-link" href="/api/auth/steam">Sign in with Steam <ArrowUpRight size={17} aria-hidden="true" /></a>
  </section></div>;
  const name=user.leagueName||data?.player?.name||user.personaname;
  return <div className="ui-page player-dashboard">
    <header className="player-dashboard-header">
      <div className="player-dashboard-identity">
        {user.avatar&&<img className="player-dashboard-avatar" src={user.avatar} alt="" width="72" height="72" />}
        <div><p className="player-dashboard-eyebrow">Your dashboard</p><h1>{name}</h1>
          <p className="player-dashboard-account">Account {accountId}{data?.player&&name!==user.personaname&&<span> · Steam: {user.personaname}</span>}</p></div>
      </div>
      <div className="player-dashboard-actions">
        <Link to={`/player/${accountId}`}>View player profile <ArrowUpRight size={16} aria-hidden="true" /></Link>
        <button type="button" aria-expanded={editingName} aria-controls="dashboard-name-editor" onClick={()=>setEditingName(value=>!value)}>
          <Pencil size={15} aria-hidden="true" /> Edit league name</button>
      </div>
    </header>
    {editingName&&<section className="ui-panel player-dashboard-name-panel" id="dashboard-name-editor" aria-label="Edit league name">
      <div><h2>Your league name</h2><p>This is the name shown on league pages. Your Steam name stays the same.</p></div>
      <NameChangeDashboard currentName={name} nextNameChangeAt={user.nameConfirmation?.nextNameChangeAt||data?.player?.nextNameChangeAt} onChanged={result=>{
        setData(current=>current?{...current,player:{...current.player,name:result.name,nextNameChangeAt:result.nextNameChangeAt}}:current);
        setUser(current=>current?{...current,leagueName:result.name,nameConfirmation:{...current.nameConfirmation,nextNameChangeAt:result.nextNameChangeAt}}:current);
      }} />
    </section>}
    <div className="player-dashboard-navigation">
      <div className="ui-tabs" aria-label="Dashboard sections">{[['overview','Overview'],['betting','Betting']].map(([key,label])=>
        <button type="button" className="ui-tab" key={key} aria-pressed={activeTab===key} onClick={()=>setActiveTab(key)}>{label}</button>)}</div>
    </div>
    {activeTab==='overview'?<PersonalStats data={data} loading={loading} error={error} accountId={accountId} onRetry={()=>setRefresh(value=>value+1)} />
      :<SeasonBettingAccount showTickets />}
  </div>;
}
