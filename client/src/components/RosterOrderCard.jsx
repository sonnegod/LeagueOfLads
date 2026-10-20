import {useEffect,useState} from 'react';
import './RosterOrderCard.css';

export default function RosterOrderCard({data,onChanged}) {
  const [teamKey,setTeamKey]=useState(''),[order,setOrder]=useState([0,1,2,3,4]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const selectedTeam=Number(teamKey||data.teams[0]?.teamKey);
  const slots=data.rosterSlots.filter(p=>p.teamKey===selectedTeam);
  const savedOrder=JSON.stringify(data.rosterOrders?.find(t=>t.teamKey===selectedTeam)?.order||[0,1,2,3,4]);
  const rosterKey=JSON.stringify(slots.map(p=>[p.slot,p.playerId,p.pending]));
  useEffect(()=>{setOrder(JSON.parse(savedOrder));setError('');},[selectedTeam,savedOrder,rosterKey]);
  const dirty=JSON.stringify(order)!==savedOrder;
  function move(index,delta) {
    setOrder(current=>{const next=[...current];[next[index],next[index+delta]]=[next[index+delta],next[index]];return next;});
    setMessage('');
  }
  async function save(event) {
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try {
      const response=await fetch(`/api/admin/rosters/seasons/${data.season.seasonId}/roster-order`,{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({teamKey:selectedTeam,order,
          expectedRoster:slots.map(({slot,playerId,pending})=>({slot,playerId,pending}))})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to save roster order');
      setMessage('Roster order saved.');onChanged?.();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <section className="betting-admin-widget roster-order-card">
    <h3>Roster order</h3><p>Choose a team and move players into positions 1–5 on its team page.</p>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {!data.teams.length?<p>No teams are available yet.</p>:<form onSubmit={save}>
      <label>Team<select disabled={busy} value={selectedTeam} onChange={event=>{setTeamKey(event.target.value);setMessage('');}}>
        {data.teams.map(team=><option key={team.teamKey} value={team.teamKey}>{team.name}</option>)}</select></label>
      <ol className="roster-order-list">{order.map((slot,index)=>{
        const player=slots.find(p=>p.slot===slot),name=player?.pending?'Player TBD':player?.name||(player?.playerId?`Player ${player.playerId}`:'Empty spot');
        return <li key={slot}><span className="roster-order-position">Pos {index+1}</span><span>{name}</span>
          <button type="button" disabled={busy||index===0} aria-label={`Move ${name} up`} onClick={()=>move(index,-1)}>↑</button>
          <button type="button" disabled={busy||index===order.length-1} aria-label={`Move ${name} down`} onClick={()=>move(index,1)}>↓</button></li>;
      })}</ol>
      <button disabled={busy||!dirty}>Save roster order</button>
    </form>}
  </section>;
}
