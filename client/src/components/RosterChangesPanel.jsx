import {useEffect,useState} from 'react';
import PendingRosterSlotsPanel from './PendingRosterSlotsPanel';
import AddRosterTeamCard from './AddRosterTeamCard';
import CurrentLeagueTeams from './CurrentLeagueTeams';
import '../css/BettingV2.css';
import './RosterChangesPanel.css';

export default function RosterChangesPanel({refreshKey,onChanged}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{
    setError('');
    const controller=new AbortController();
    fetch('/api/admin/rosters/status',{signal:controller.signal}).then(async response=>{
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to load roster administration');return payload;
    }).then(payload=>{if(!controller.signal.aborted)setData(payload);}).catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return()=>controller.abort();
  },[refreshKey,refresh]);
  return <section key={data?.season?.seasonId??'roster-loading'} className="betting-admin-panel">
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}
    {!data&&!error&&<p>Loading roster administration…</p>}
    {data&&['signup_closed','active'].includes(data.season?.status)&&<CurrentLeagueTeams key={`team-management:${data.season.seasonId}`}
      data={data} refreshKey={`${refreshKey}:${refresh}`} onTeamUpdated={()=>{setRefresh(value=>value+1);onChanged?.();}} />}
    {data?.season?.status==='signup_closed'&&<PendingRosterSlotsPanel data={data}
      onChanged={()=>{setRefresh(value=>value+1);onChanged?.();}} />}
    {data&&['signup_closed','active'].includes(data.season?.status)&&<AddRosterTeamCard key={data.season.seasonId} season={data.season}
      onChanged={()=>{setRefresh(value=>value+1);onChanged?.();}} />}
  </section>;
}
