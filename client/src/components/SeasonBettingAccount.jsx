import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight} from 'lucide-react';
import '../css/BettingV2.css';
import './SeasonBettingAccount.css';

const points=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
async function get(url,signal) {
  const response=await fetch(url,{signal});const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Unable to load betting account');return data;
}
export default function SeasonBettingAccount({showTickets=false}) {
  const [meta,setMeta]=useState(null);const [season,setSeason]=useState('');const [data,setData]=useState(null);
  const [error,setError]=useState('');const [before,setBefore]=useState(null);const [pages,setPages]=useState([]);
  const [refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true);
  useEffect(()=>{const controller=new AbortController();get('/api/betting/meta',controller.signal).then(value=>{
    setMeta(value);setSeason(current=>value.seasons.some(s=>String(s.seasonId)===current)?current:String(value.defaultSeasonId||''));
  }).catch(err=>{if(err.name!=='AbortError')setError(err.message);});return()=>controller.abort();},[refresh]);
  useEffect(()=>{
    if(!season)return;const controller=new AbortController();setData(null);setError('');setLoading(true);
    const params=new URLSearchParams({seasonId:season});if(before)params.set('before',before);
    Promise.allSettled([get(`/api/betting/wallet?seasonId=${season}`,controller.signal),
      ...(showTickets?[get(`/api/betting/tickets?${params}`,controller.signal)]:[])])
      .then(([wallet,tickets])=>{if(!controller.signal.aborted)setData({
        wallet:wallet.status==='fulfilled'?wallet.value:null,walletError:wallet.status==='rejected'?wallet.reason.message:null,
        tickets:tickets?.status==='fulfilled'?tickets.value:null,ticketsError:tickets?.status==='rejected'?tickets.reason.message:null,
      });}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
  },[season,showTickets,before,refresh]);
  const tickets=data?.tickets;
  return <section className="season-account">
    <div className="season-account-heading"><div><h2>Your betting account</h2><p>Season points, accepted odds, and the latest on your tickets.</p></div>
      <Link to={`/betting?seasonId=${season}`}>Browse markets <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
    <div className="season-account-toolbar"><label>Season<select value={season} onChange={e=>{
      setSeason(e.target.value);setBefore(null);setPages([]);
    }}>{meta?.seasons.map(s=><option key={s.seasonId} value={s.seasonId}>{s.name}</option>)}</select></label>
      <Link to="/betting?tab=legacy">Legacy account →</Link></div>
    {error&&<p role="alert" className="season-account-error">{error} <button type="button" onClick={()=>{setError('');setRefresh(value=>value+1);}}>Try again</button></p>}
    {!season&&meta?<p className="season-account-empty">No season is available yet. Your legacy account is still accessible above.</p>:!data&&!error?<p role="status">Loading betting account…</p>:data&&<>
      <div className="season-account-wallet"><div><span>Available season points</span><strong>{data.wallet?points(data.wallet.balance):'—'}</strong>
        {data.walletError&&<p role="alert" className="season-account-error">{data.walletError}</p>}</div>
        <p>Each season starts with <strong>10,000 points</strong>. Your wallet and tickets stay with their original season.</p></div>
      {showTickets&&<section className="season-account-tickets"><div className="season-account-ticket-heading"><h3>Your tickets</h3>
        {tickets&&<span>{tickets.tickets.length} on this page · expand for selections</span>}</div>
        {data.ticketsError&&<p role="alert" className="season-account-error">{data.ticketsError}</p>}
        {tickets&&!tickets.tickets.length&&<div className="season-account-empty"><h3>No bets placed this season</h3><p>Find a matchup or preseason market, then choose a selection to build your slip.</p>
          <Link to={`/betting?seasonId=${season}`}>Explore betting →</Link></div>}
        {tickets?.tickets.length>0&&<><div className="season-account-ticket-columns" aria-hidden="true"><span>Ticket / Selection</span><span>Stake</span><span>Returned</span><span>Status</span></div>
          {tickets.tickets.map(ticket=><details className="season-account-ticket" key={ticket.ticketId}><summary>
            <div className="season-account-ticket-title"><strong>#{ticket.ticketId} · {ticket.legs.length>1?`${ticket.legs.length}-leg parlay`:ticket.legs[0]?.selection||'Bet'}</strong>
              <span title={ticket.legs[0]?.title}>{ticket.legs[0]?.title}</span><small>{new Date(ticket.placedAt).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'})} NY</small></div>
            <div className="season-account-amount"><small>Stake</small>{points(ticket.stake)}</div>
            <div className="season-account-amount"><small>Returned</small>{ticket.status==='pending'?'—':points(ticket.payout)}</div>
            <span className={`season-account-status status-${ticket.status}`}>{ticket.status}</span></summary>
            <div className="season-account-leg-scroll"><table className="season-account-legs"><thead><tr><th>Selection</th><th>Accepted odds</th><th>Result</th></tr></thead><tbody>
              {ticket.legs.map((leg,i)=><tr key={i}><td><strong>{leg.title}</strong><span>{leg.selection}</span></td><td>{leg.odds.toFixed(2)}×</td>
                <td>{leg.result}{leg.tieDivisor>1&&<small>Shared winner · payout ÷ {leg.tieDivisor}</small>}</td></tr>)}
            </tbody></table></div></details>)}
        </>}
        {tickets&&(pages.length>0||tickets.nextBefore)&&<div className="sportsbook-paging"><button type="button" disabled={loading||!pages.length} onClick={()=>{setBefore(pages.at(-1));setPages(p=>p.slice(0,-1));}}>Previous</button>
          <span>Page {pages.length+1}</span><button type="button" disabled={loading||!tickets.nextBefore} onClick={()=>{setPages(p=>[...p,before]);setBefore(tickets.nextBefore);}}>Next</button></div>}
      </section>}
    </>}
  </section>;
}
