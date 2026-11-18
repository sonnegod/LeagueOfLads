import {useState} from 'react';
import {Check,X} from 'lucide-react';
import RosterPlayerPicker from './RosterPlayerPicker';

export default function RosterReplacementForm({seasonId,teamKey,player,disabled,onBusyChange,onSaved,onCancel,onError}) {
  const [replacement,setReplacement]=useState({id:'',name:''});
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false);
  async function save(event) {
    event.preventDefault();
    if(busy||disabled||!replacement.id)return;
    if(Number(replacement.id)===Number(player.playerId)){onError('Choose a different replacement player.');return;}
    setBusy(true);onBusyChange(true);onError('');
    try {
      const response=await fetch(`/api/admin/rosters/seasons/${seasonId}/roster-changes`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({playerId:player.playerId,fromTeamKey:teamKey,replacementPlayerId:Number(replacement.id),
          replacementPlayerName:replacement.name.trim(),effectiveNow:true,kind:'permanent',
          reason:`${reason?`${reason}: `:''}Replaced ${player.name} with ${replacement.name.trim()||`Player ${replacement.id}`}.`}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Unable to replace player');
      onSaved(`Replaced ${player.name} with ${replacement.name.trim()||`Player ${replacement.id}`}.`);
    }catch(error){onError(error.message);}finally{setBusy(false);onBusyChange(false);}
  }
  return <form className="roster-inline-replacement" aria-label={`Replace ${player.name}`} onSubmit={save}>
    <RosterPlayerPicker id={`roster-replacement-${teamKey}-${player.slot}`} label="Replacement player" required
      compact disabled={busy||disabled} options={[]} accountId={replacement.id} onSearchError={onError}
      onChange={(id,name)=>{setReplacement({id,name});onError('');}} />
    <select aria-label="Replacement reason (optional)" title={reason||'Reason (optional)'} disabled={busy||disabled} value={reason} onChange={event=>setReason(event.target.value)}>
      <option value="">Reason</option>
      {[['Roster change','Roster change'],['Player unavailable','Unavailable'],['Player left','Player left'],['Team decision','Team decision']]
        .map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select>
    <button className="ui-button-primary" aria-label="Confirm replacement" title="Confirm permanent replacement, effective immediately"
      disabled={busy||disabled||!replacement.id}><Check size={16} aria-hidden="true" /></button>
    <button type="button" aria-label="Cancel replacement" title="Cancel replacement" disabled={busy||disabled} onClick={onCancel}>
      <X size={16} aria-hidden="true" /></button>
  </form>;
}
