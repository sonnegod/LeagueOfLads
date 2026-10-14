import {useEffect,useState} from 'react';
import '../css/BettingV2.css';

const initialChange={playerId:'',fromTeamKey:'',toTeamKey:'',replacementPlayerId:'',slot:0,localTime:'',kind:'permanent',reason:''};
function parserTime(value){const [day,time]=value.split('T');const [hour,minute]=time.split(':');const h=Number(hour);return `${day} ${h%12||12}:${minute} ${h>=12?'PM':'AM'} EST`;}

export default function RosterChangesPanel({refreshKey,onChanged}) {
  const [data,setData]=useState(null);const [error,setError]=useState('');const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);const [refresh,setRefresh]=useState(0);const [rosterChange,setRosterChange]=useState(initialChange);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/admin/betting/status',{signal:controller.signal}).then(async response=>{
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to load roster administration');return payload;
    }).then(payload=>{if(!controller.signal.aborted)setData(payload);}).catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return()=>controller.abort();
  },[refreshKey,refresh]);
  async function save(event) {
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try {
      const response=await fetch(`/api/admin/betting/seasons/${data.season.seasonId}/roster-changes`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...rosterChange,localTime:parserTime(rosterChange.localTime)})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to record roster change');
      setMessage('Roster change recorded. Markets and Analytics will refresh.');setRefresh(value=>value+1);onChanged?.();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <section className="betting-admin-panel">
    <div className="sportsbook-heading"><h2>Roster Changes</h2><button type="button" disabled={busy} onClick={()=>{setError('');setRefresh(value=>value+1);}}>Refresh view</button></div>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {!data&&!error&&<p>Loading roster administration…</p>}
    {data&&(data.season?.status!=='active'?<p>Roster changes are available during an active league.</p>:<section className="betting-admin-widget">
      <h3>{data.season.name}</h3><p>Permanent changes refund affected preseason player bets. Effective dates preserve earlier appearances on the original team.</p>
      <form className="betting-admin-form" onSubmit={save}>
        <label>Player account ID<input required type="number" min="1" value={rosterChange.playerId} onChange={e=>setRosterChange(r=>({...r,playerId:e.target.value}))} /></label>
        {['fromTeamKey','toTeamKey'].map((key,i)=><label key={key}>{i?'Move to team (optional)':'Remove from team (optional)'}<select value={rosterChange[key]} onChange={e=>setRosterChange(r=>({...r,[key]:e.target.value}))}><option value="">None</option>{data.teams.map(t=><option key={t.teamKey} value={t.teamKey}>{t.name}</option>)}</select></label>)}
        <label>Replacement account ID (optional)<input type="number" min="1" value={rosterChange.replacementPlayerId} onChange={e=>setRosterChange(r=>({...r,replacementPlayerId:e.target.value}))} /></label>
        <label>Destination slot<select value={rosterChange.slot} onChange={e=>setRosterChange(r=>({...r,slot:Number(e.target.value)}))}>{[0,1,2,3,4].map(n=><option key={n} value={n}>{n+1}</option>)}</select></label>
        <label>Effective time (New York)<input required type="datetime-local" value={rosterChange.localTime} onChange={e=>setRosterChange(r=>({...r,localTime:e.target.value}))} /></label>
        <label>Change type<select value={rosterChange.kind} onChange={e=>setRosterChange(r=>({...r,kind:e.target.value}))}><option value="permanent">Permanent change</option><option value="data_correction">Data correction</option></select></label>
        <label>Reason<input required maxLength="500" value={rosterChange.reason} onChange={e=>setRosterChange(r=>({...r,reason:e.target.value}))} /></label><button disabled={busy}>Record roster change</button>
      </form>
    </section>)}
  </section>;
}
