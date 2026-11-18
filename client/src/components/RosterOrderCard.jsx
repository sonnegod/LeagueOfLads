import {useEffect,useState} from 'react';
import {Crown,RefreshCw} from 'lucide-react';
import RosterReplacementForm from './RosterReplacementForm';
import './RosterOrderCard.css';

export default function RosterOrderCard({data,teamKey,disabled=false,onBusyChange,onChanged}) {
  const [order,setOrder]=useState([0,1,2,3,4]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [editing,setEditing]=useState(null),[replacing,setReplacing]=useState(false);
  const [appointing,setAppointing]=useState(false);
  const selectedTeam=Number(teamKey);
  const savedCaptain=data.captains?.find(team=>team.teamKey===selectedTeam)?.captainId??null;
  const slots=data.rosterSlots.filter(p=>p.teamKey===selectedTeam);
  const savedOrder=JSON.stringify(data.rosterOrders?.find(t=>t.teamKey===selectedTeam)?.order||[0,1,2,3,4]);
  useEffect(()=>{setOrder(JSON.parse(savedOrder));setError('');},[selectedTeam,savedOrder]);
  const editingCurrent=!editing||slots.some(player=>player.slot===editing.slot&&player.playerId===editing.playerId&&!player.pending);
  useEffect(()=>{if(!editingCurrent){setEditing(null);setError('The roster changed. Select the player again.');}},[editingCurrent]);
  const working=busy||disabled||replacing||appointing;
  const dirty=JSON.stringify(order)!==savedOrder;
  function move(index,delta) {
    setOrder(current=>{const next=[...current];[next[index],next[index+delta]]=[next[index+delta],next[index]];return next;});
    setMessage('');
  }
  async function save(event) {
    event.preventDefault();if(working||editing||!dirty)return;
    setBusy(true);onBusyChange?.(true);setError('');setMessage('');
    try {
      const response=await fetch(`/api/admin/rosters/seasons/${data.season.seasonId}/roster-order`,{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({teamKey:selectedTeam,order,
          expectedRoster:slots.map(({slot,playerId,pending})=>({slot,playerId,pending}))})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to save roster order');
      setMessage('Roster order saved.');onChanged?.();
    }catch(err){setError(err.message);}finally{setBusy(false);onBusyChange?.(false);}
  }
  async function changeCaptain(player,name) {
    if(working||editing||player.pending||!player.playerId||player.playerId===savedCaptain)return;
    setAppointing(true);onBusyChange?.(true);setError('');setMessage('');
    try {
      const response=await fetch(`/api/admin/rosters/seasons/${data.season.seasonId}/captain`,{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({teamKey:selectedTeam,captainId:player.playerId,expectedCaptainId:savedCaptain}),
      });
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to change captain');
      setMessage(`Captain changed to ${name}.`);onChanged?.();
    }catch(error){setError(error.message);}finally{setAppointing(false);onBusyChange?.(false);}
  }
  return <section className="roster-order-fields" aria-label="Roster order">
    <h4>Roster order</h4>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
      <ol className="roster-order-list">{order.map((slot,index)=>{
        const player=slots.find(p=>p.slot===slot),name=player?.pending?'Player TBD':player?.name||(player?.playerId?`Player ${player.playerId}`:'Empty spot');
        const isCaptain=Boolean(player?.playerId&&!player.pending&&player.playerId===savedCaptain);
        if(editing?.slot===slot)return <li key={slot} className="is-replacing" style={{height:editing.rowHeight,boxSizing:'border-box'}}><span className="roster-order-position">Pos {index+1}</span>
          <RosterReplacementForm key={editing.playerId} seasonId={data.season.seasonId} teamKey={selectedTeam} player={editing}
            disabled={busy||disabled} onBusyChange={value=>{setReplacing(value);onBusyChange?.(value);}}
            onError={setError} onCancel={()=>{setEditing(null);setError('');}} onSaved={message=>{setEditing(null);setMessage(message);onChanged?.();}} /></li>;
        return <li key={slot}><span className="roster-order-position">Pos {index+1}</span><span>{name}</span>
          <div className="roster-order-actions">
          <button type="button" disabled={working||Boolean(editing)||index===0} aria-label={`Move ${name} up`} onClick={()=>move(index,-1)}>↑</button>
          <button type="button" disabled={working||Boolean(editing)||index===order.length-1} aria-label={`Move ${name} down`} onClick={()=>move(index,1)}>↓</button>
          {player?.playerId&&!player.pending&&<button type="button" className="roster-captain-button"
            aria-pressed={isCaptain} aria-label={isCaptain?`${name} is the current captain`:`Make ${name} captain`}
            title={isCaptain?'Current captain':`Make ${name} captain`} style={isCaptain?{opacity:1}:undefined}
            disabled={working||Boolean(editing)||isCaptain} onClick={()=>changeCaptain(player,name)}>
            <Crown size={16} aria-hidden="true" style={isCaptain?{color:'#facc15',fill:'currentColor'}:undefined} />
          </button>}
          {data.season.status==='active'&&player?.playerId&&!player.pending&&<button type="button" title={`Replace ${name}`} aria-label={`Replace ${name}`}
            disabled={working||Boolean(editing)} onClick={event=>{setEditing({...player,name,rowHeight:event.currentTarget.closest('li').getBoundingClientRect().height});setMessage('');setError('');}}><RefreshCw size={16} aria-hidden="true" /></button>}
          </div></li>;
      })}</ol>
    <form onSubmit={save} className="roster-order-save">
      <button disabled={working||Boolean(editing)||!dirty}>{busy?'Saving…':'Save roster order'}</button>
    </form>
  </section>;
}
