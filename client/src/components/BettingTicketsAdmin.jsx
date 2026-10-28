import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';

const statuses=[['all','All statuses'],['pending','Open'],['won','Won'],['lost','Lost'],['refunded','Refunded'],['cancelled','Cancelled']];
const statusLabel=value=>value==='pending'?'Open':value==='void'?'Voided':value?value[0].toUpperCase()+value.slice(1):'Unknown';
const points=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
const date=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'short',timeStyle:'short'}):'—';

export default function BettingTicketsAdmin(){
  const [status,setStatus]=useState('pending'),[season,setSeason]=useState('all'),[before,setBefore]=useState(null);
  const [attempt,setAttempt]=useState(0),[result,setResult]=useState(null),[error,setError]=useState(null);
  const query=new URLSearchParams({status,seasonId:season,...(before?{before:String(before)}:{})}).toString();
  useEffect(()=>{
    const controller=new AbortController();setError(null);
    fetch(`/api/site-management/betting/tickets?${query}`,{signal:controller.signal,cache:'no-store',credentials:'include'})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load tickets');return data;})
      .then(data=>{if(!controller.signal.aborted)setResult({query,data});})
      .catch(cause=>{if(!controller.signal.aborted)setError({query,message:cause.message});});
    return ()=>controller.abort();
  },[query,attempt]);
  const data=result?.query===query?result.data:null;
  const currentError=error?.query===query?error.message:null;
  const total=data?(status==='all'?Object.values(data.counts).reduce((sum,value)=>sum+value,0):data.counts[status]||0):null;
  return <div className="site-ticket-review">
    <section className="site-analytics-panel">
      <div className="site-analytics-panel-heading"><div><h2>Bet tickets</h2>
        <p>Open tickets are awaiting a final result. Markets can be closed to new bets while their tickets remain open.</p></div>
        <button type="button" onClick={()=>{setBefore(null);setAttempt(value=>value+1);}}>Refresh</button>
      </div>
      <div className="site-ticket-filters">
        <label>Ticket status<select value={status} onChange={event=>{setStatus(event.target.value);setBefore(null);}}>
          {statuses.map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Season<select value={season} onChange={event=>{setSeason(event.target.value);setBefore(null);}}>
          <option value="all">All seasons</option>
          {(data?.seasons||result?.data.seasons||[]).map(item=><option key={item.seasonId} value={item.seasonId}>{item.name}</option>)}
        </select></label>
        {data&&<p role="status">{points(total)} {status==='all'?'total':statusLabel(status).toLowerCase()} tickets · newest first</p>}
      </div>
      {data?.localTesting&&<p className="site-analytics-note">Showing tickets from the separate development test database.</p>}
    </section>
    {currentError?<div className="site-analytics-panel" role="alert"><p>{currentError}</p>
      <button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry</button></div>
      :!data?<p role="status">Loading bet tickets…</p>
      :<>
        {!data.tickets.length&&<p className="site-analytics-panel">No tickets match these filters.</p>}
        {data.tickets.map(ticket=><article className="site-analytics-panel site-ticket" key={ticket.ticketId}>
          <header className="site-ticket-heading"><div><h3>Ticket #{ticket.ticketId} · <Link to={`/player/${ticket.userId}`}>{ticket.name}</Link></h3>
            <p>{ticket.seasonName} · {date(ticket.placedAt)} NY</p></div>
            <span className="site-ticket-status" data-status={ticket.status}>{statusLabel(ticket.status)}</span></header>
          <dl className="site-ticket-values"><div><dt>Stake</dt><dd>{points(ticket.stake)} pts</dd></div>
            <div><dt>Payout</dt><dd>{ticket.status==='pending'?'Pending':`${points(ticket.payout)} pts`}</dd></div></dl>
          <ul className="site-ticket-legs">{ticket.legs.map(leg=><li key={leg.marketId}>
            <div><strong>{leg.title}</strong><span>{leg.selection} · {leg.odds.toFixed(2)}× accepted odds</span>
              {leg.eventId&&<Link to={`/bet/matchup/${leg.eventId}`}>View matchup</Link>}</div>
            <div className="site-ticket-leg-status"><span>Result: {leg.result==='pending'?'Pending':statusLabel(leg.result)}</span>
              <small>Market: {statusLabel(leg.marketStatus)}{leg.closeAt?` · closes ${date(leg.closeAt)} NY`:''}</small>
              {leg.tieDivisor>1&&<small>Tie divisor: {leg.tieDivisor}</small>}</div>
          </li>)}</ul>
        </article>)}
        {(before||data.nextBefore)&&<nav className="site-ticket-pagination" aria-label="Ticket pages">
          <button type="button" disabled={!before} onClick={()=>setBefore(null)}>Newest</button>
          <button type="button" disabled={!data.nextBefore} onClick={()=>setBefore(data.nextBefore)}>Older tickets</button>
        </nav>}
      </>}
  </div>;
}
