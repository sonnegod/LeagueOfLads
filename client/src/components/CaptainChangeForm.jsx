import {useEffect,useState} from 'react';

export default function CaptainChangeForm({data,teamKey,disabled,onBusyChange,onChanged}) {
  const [captainId,setCaptainId]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const selectedTeam=teamKey;
  const captain=data.captains?.find(t=>t.teamKey===selectedTeam);
  const savedCaptain=captain?.captainId??null;
  const players=data.rosterSlots.filter(p=>p.teamKey===selectedTeam&&!p.pending&&p.playerId);
  const rosterKey=JSON.stringify(players.map(p=>[p.slot,p.playerId]));
  useEffect(()=>{setCaptainId('');setError('');},[selectedTeam,savedCaptain,rosterKey]);
  const selectedCaptain=players.find(p=>String(p.playerId)===captainId);
  async function save(event) {
    event.preventDefault();if(busy||disabled||!selectedCaptain||Number(captainId)===savedCaptain)return;
    setBusy(true);onBusyChange?.(true);setError('');setMessage('');
    try {
      const response=await fetch(`/api/admin/rosters/seasons/${data.season.seasonId}/captain`,{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({teamKey:selectedTeam,captainId:Number(captainId),expectedCaptainId:savedCaptain})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to change captain');
      setMessage(`Captain changed to ${selectedCaptain?.name||`Player ${captainId}`}.`);onChanged?.();
    }catch(err){setError(err.message);}finally{setBusy(false);onBusyChange?.(false);}
  }
  return <div className="roster-captain-fields">
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    <form onSubmit={save}>
      <p className="roster-captain-current">Current captain: <strong>{captain?.captainName||(savedCaptain?`Player ${savedCaptain}`:'Not assigned')}</strong></p>
      {!players.length?<p>No confirmed players are available on this team.</p>:<>
        <label>New captain<select required disabled={busy||disabled} value={captainId} onChange={event=>{setCaptainId(event.target.value);setMessage('');}}>
          <option value="">Choose a player</option>{players.map(p=><option key={p.playerId} value={p.playerId}>
            {p.name||`Player ${p.playerId}`} ({p.playerId}){p.playerId===savedCaptain?' · Current captain':''}</option>)}
        </select></label>
        <button disabled={busy||disabled||!selectedCaptain||Number(captainId)===savedCaptain}>{busy?'Saving…':'Save captain'}</button>
      </>}
    </form>
  </div>;
}
