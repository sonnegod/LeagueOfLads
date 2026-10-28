import {useState} from 'react';
import {bettingRequest} from '../utils/bettingRequest';

export default function CancelBetButton({ticket,onCancelled}){
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!ticket.canCancel)return null;
  const points=Number(ticket.stake).toLocaleString('en-US',{maximumFractionDigits:2});
  async function cancel(){
    if(busy)return;
    setBusy(true);setError('');
    try{
      const result=await bettingRequest(`/api/betting/tickets/${ticket.ticketId}/cancel`,{method:'POST'});
      onCancelled(result);
    }catch(cause){setError(cause.message);}finally{setBusy(false);}
  }
  return <div className="sportsbook-cancel-ticket">
    {!confirm?<button type="button" onClick={()=>setConfirm(true)}>Cancel bet</button>:<>
      <p>Cancel ticket #{ticket.ticketId}? Your full {points}-point stake will be returned.</p>
      <div><button type="button" disabled={busy} onClick={cancel}>{busy?'Cancelling…':'Cancel bet and refund'}</button>
        <button type="button" disabled={busy} onClick={()=>{setConfirm(false);setError('');}}>Keep bet</button></div>
    </>}
    {error&&<p className="sportsbook-error" role="alert">{error}</p>}
  </div>;
}
