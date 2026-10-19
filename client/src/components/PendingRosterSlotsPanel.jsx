import {useEffect,useState} from 'react';
import AsyncSelect from 'react-select/async';

const parserTime=value=>{const [day,time]=value.split('T'),[hour,minute]=time.split(':'),h=Number(hour);return `${day} ${h%12||12}:${minute} ${h>=12?'PM':'AM'} EST`;};
const pickerStyles={control:base=>({...base,background:'var(--surface, #111827)',color:'var(--text, white)',minWidth:220}),
  menu:base=>({...base,background:'var(--surface, #111827)',zIndex:10}),
  singleValue:base=>({...base,color:'var(--text, white)'}),input:base=>({...base,color:'var(--text, white)'}),
  option:(base,state)=>({...base,background:state.isFocused?'#334155':'transparent',color:'var(--text, white)'})};

export default function PendingRosterSlotsPanel({data,onChanged}) {
  const [teamKey,setTeamKey]=useState(''),[slot,setSlot]=useState(0),[estimatedMMR,setEstimatedMMR]=useState('');
  const [player,setPlayer]=useState(null),[mmr,setMMR]=useState(''),[localTime,setLocalTime]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const selectedTeam=Number(teamKey||data.teams[0]?.teamKey);
  const slots=(data.rosterSlots||[]).filter(p=>p.teamKey===selectedTeam);
  const selected=slots.find(p=>p.slot===slot);
  const eligible=p=>p?.pending||p?.playerId==null||(data.rosterSlots||[]).filter(other=>other.playerId===p.playerId).length>1;
  useEffect(()=>{setEstimatedMMR(selected?.estimatedMMR??'');setPlayer(null);setMMR('');setLocalTime('');},[selectedTeam,slot,selected?.estimatedMMR]);
  async function searchPlayers(input) {
    if(!input.trim())return [];
    const response=await fetch(`/api/admin/rosters/players?search=${encodeURIComponent(input.trim())}`);
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Player search failed');
    return result.players.map(p=>({value:p.PlayerId,label:`${p.PlayerName} (${p.PlayerId})`}));
  }
  async function save(event,confirm=false) {
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try {
      const body=confirm?{teamKey:selectedTeam,slot,playerId:player?.value,mmr:Number(mmr),...(localTime?{localTime:parserTime(localTime)}:{})}
        :{teamKey:selectedTeam,slot,estimatedMMR:Number(estimatedMMR),expectedPlayerId:selected?.playerId??null};
      const response=await fetch(`/api/admin/rosters/seasons/${data.season.seasonId}/pending-slots${confirm?'/confirm':''}`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to save roster slot');
      setMessage(confirm?'Player confirmed. Existing bets keep their accepted odds. Analytics and markets will refresh.':'Player TBD saved. Analytics and markets will refresh.');onChanged?.();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <section className="betting-admin-widget">
    <h3>Pending roster spots</h3>
    <p>Before the season begins, replace a duplicated placeholder or empty spot with Player TBD. Its estimated MMR contributes to team odds; it has no player stats or bets. League-wide player-leader markets wait for complete rosters.</p>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    <div className="betting-admin-form">
      <label>Team<select disabled={busy} value={selectedTeam||''} onChange={e=>{setTeamKey(e.target.value);setSlot(0);}}>
        {data.teams.map(t=><option key={t.teamKey} value={t.teamKey}>{t.name}</option>)}</select></label>
      <label>Roster spot<select disabled={busy} value={slot} onChange={e=>setSlot(Number(e.target.value))}>
        {slots.map(p=><option key={p.slot} value={p.slot}>{p.slot+1} · {p.pending?'Player TBD':p.name||'Empty spot'}</option>)}</select></label>
    </div>
    {eligible(selected)?<form className="betting-admin-form" onSubmit={event=>save(event)}>
      <label>Estimated MMR<input required type="number" step="1" min="5501" value={estimatedMMR} onChange={e=>setEstimatedMMR(e.target.value)} /></label>
      <button disabled={busy||!selected}>{selected?.pending?'Update estimate':'Mark Player TBD'}</button>
    </form>:<p>This spot belongs to a confirmed player. Use permanent roster changes below for replacements.</p>}
    {selected?.pending&&<><h4>Confirm this player</h4><p>Choose the actual player and their MMR. Filling a pending spot preserves existing tickets. An optional effective time controls when their roster membership begins; the default is now.</p>
      <form className="betting-admin-form" onSubmit={event=>save(event,true)}>
        <label htmlFor="pending-slot-player">Player<AsyncSelect inputId="pending-slot-player" cacheOptions loadOptions={input=>searchPlayers(input).catch(err=>{setError(err.message);return [];})}
          value={player} onChange={setPlayer} placeholder="Search player name or account ID…" styles={pickerStyles} isClearable isDisabled={busy} /></label>
        <label>Confirmed MMR<input required type="number" min="5501" step="1" value={mmr} onChange={e=>setMMR(e.target.value)} /></label>
        <label>Effective time (New York, optional)<input type="datetime-local" value={localTime} onChange={e=>setLocalTime(e.target.value)} /></label>
        <button disabled={busy||!player}>Confirm player</button>
      </form></>}
    {(data.rosterSlots||[]).some(p=>p.pending)&&<p className="admin-help">Pending: {data.rosterSlots.filter(p=>p.pending)
      .map(p=>`${data.teams.find(t=>t.teamKey===p.teamKey)?.name} · spot ${p.slot+1}`).join('; ')}.</p>}
  </section>;
}
