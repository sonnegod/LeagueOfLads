import {useEffect,useMemo,useState} from 'react';
import PendingRosterSlotsPanel from './PendingRosterSlotsPanel';
import AddRosterTeamCard from './AddRosterTeamCard';
import RosterOrderCard from './RosterOrderCard';
import CurrentLeagueTeams from './CurrentLeagueTeams';
import RosterPlayerPicker from './RosterPlayerPicker';
import '../css/BettingV2.css';
import './RosterChangesPanel.css';

const initialChange={playerId:'',playerName:'',fromTeamKey:'',toTeamKey:'',replacementPlayerId:'',replacementPlayerName:'',slot:0,localTime:'',kind:'permanent',reason:''};
function parserTime(value){const [day,time]=value.split('T');const [hour,minute]=time.split(':');const h=Number(hour);return `${day} ${h%12||12}:${minute} ${h>=12?'PM':'AM'} EST`;}

export default function RosterChangesPanel({refreshKey,onChanged}) {
  const [data,setData]=useState(null);const [error,setError]=useState('');const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);const [refresh,setRefresh]=useState(0);const [rosterChange,setRosterChange]=useState(initialChange);
  const playerOptions=useMemo(()=>{
    const players=new Map();
    for(const player of data?.rosterSlots||[])if(player.playerId&&!player.pending){
      const name=String(player.name??'').trim()||`Player ${player.playerId}`;
      players.set(player.playerId,{value:player.playerId,name,label:`${name} (${player.playerId})`});
    }
    return [...players.values()].sort((a,b)=>a.name.localeCompare(b.name));
  },[data]);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/admin/rosters/status',{signal:controller.signal}).then(async response=>{
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to load roster administration');return payload;
    }).then(payload=>{if(!controller.signal.aborted)setData(payload);}).catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return()=>controller.abort();
  },[refreshKey,refresh]);
  async function save(event) {
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try {
      const response=await fetch(`/api/admin/rosters/seasons/${data.season.seasonId}/roster-changes`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...rosterChange,localTime:parserTime(rosterChange.localTime)})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to record roster change');
      setMessage('Roster change recorded. Markets and Analytics will refresh.');setRefresh(value=>value+1);onChanged?.();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <section className="betting-admin-panel">
    <div className="sportsbook-heading"><h2>Roster Changes</h2><button type="button" disabled={busy} onClick={()=>{setError('');setRefresh(value=>value+1);}}>Refresh view</button></div>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {!data&&!error&&<p>Loading roster administration…</p>}
    {data&&['signup_closed','active'].includes(data.season?.status)&&<div className="roster-management-cards">
      <RosterOrderCard data={data} onChanged={()=>{setRefresh(value=>value+1);onChanged?.();}} />
      <CurrentLeagueTeams key={data.season.seasonId} data={data} refreshKey={`${refreshKey}:${refresh}`}
        onTeamUpdated={()=>{setRefresh(value=>value+1);onChanged?.();}} />
    </div>}
    {data?.season?.status==='signup_closed'&&<PendingRosterSlotsPanel data={data}
      onChanged={()=>{setRefresh(value=>value+1);onChanged?.();}} />}
    {data&&(data.season?.status!=='active'?<p>Roster changes are available during an active league.</p>:<section className="betting-admin-widget roster-change-card">
      <h3>Replace player</h3><p>Permanent changes refund affected preseason player bets. Effective dates preserve earlier appearances on the original team.</p>
      <form className="betting-admin-form" onSubmit={save}>
        <RosterPlayerPicker id="roster-change-player" label="Player" required allowManualEntry={false} disabled={busy} options={playerOptions}
          accountId={rosterChange.playerId} onChange={(playerId,playerName)=>setRosterChange(r=>({...r,playerId,playerName}))}/>
        {['fromTeamKey','toTeamKey'].map((key,i)=><label key={key}>{i?'Move to team (optional)':'Remove from team (optional)'}<select value={rosterChange[key]} onChange={e=>setRosterChange(r=>({...r,[key]:e.target.value}))}><option value="">None</option>{data.teams.map(t=><option key={t.teamKey} value={t.teamKey}>{t.name}</option>)}</select></label>)}
        {rosterChange.toTeamKey&&!rosterChange.fromTeamKey&&<label>Player name (optional)<input maxLength="40" value={rosterChange.playerName}
          onChange={e=>setRosterChange(r=>({...r,playerName:e.target.value}))} /></label>}
        <RosterPlayerPicker id="roster-change-replacement" label="Replacement (optional)" disabled={busy} options={playerOptions}
          accountId={rosterChange.replacementPlayerId} onChange={(replacementPlayerId,replacementPlayerName)=>setRosterChange(r=>({...r,replacementPlayerId,replacementPlayerName}))}/>
        {rosterChange.replacementPlayerId&&<label>Replacement name (optional)<input maxLength="40" value={rosterChange.replacementPlayerName}
          onChange={e=>setRosterChange(r=>({...r,replacementPlayerName:e.target.value}))} /></label>}
        <label>Destination slot<select value={rosterChange.slot} onChange={e=>setRosterChange(r=>({...r,slot:Number(e.target.value)}))}>{[0,1,2,3,4].map(n=><option key={n} value={n}>{n+1}</option>)}</select></label>
        <label>Effective time (New York)<input required type="datetime-local" value={rosterChange.localTime} onChange={e=>setRosterChange(r=>({...r,localTime:e.target.value}))} /></label>
        <label>Change type<select value={rosterChange.kind} onChange={e=>setRosterChange(r=>({...r,kind:e.target.value}))}><option value="permanent">Permanent change</option><option value="data_correction">Data correction</option></select></label>
        <label>Reason<input required maxLength="500" value={rosterChange.reason} onChange={e=>setRosterChange(r=>({...r,reason:e.target.value}))} /></label><button disabled={busy}>Record roster change</button>
      </form>
    </section>)}
    {data&&['signup_closed','active'].includes(data.season?.status)&&<AddRosterTeamCard key={data.season.seasonId} season={data.season}
      onChanged={()=>{setRefresh(value=>value+1);onChanged?.();}} />}
  </section>;
}
