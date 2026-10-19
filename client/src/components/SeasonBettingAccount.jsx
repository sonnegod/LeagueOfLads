import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import '../css/BettingV2.css';

const points=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
async function get(url,signal) {
  const response=await fetch(url,{signal});const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Unable to load betting account');return data;
}
export default function SeasonBettingAccount({showTickets=false}) {
  const [meta,setMeta]=useState(null);const [season,setSeason]=useState('');const [data,setData]=useState(null);
  const [error,setError]=useState('');const [before,setBefore]=useState(null);const [pages,setPages]=useState([]);
  useEffect(()=>{const controller=new AbortController();get('/api/betting/meta',controller.signal).then(value=>{
    setMeta(value);setSeason(String(value.defaultSeasonId||''));
  }).catch(err=>{if(err.name!=='AbortError')setError(err.message);});return()=>controller.abort();},[]);
  useEffect(()=>{
    if(!season)return;const controller=new AbortController();setData(null);setError('');
    const params=new URLSearchParams({seasonId:season});if(before)params.set('before',before);
    get(`/api/betting/${showTickets?'tickets':'wallet'}?${params}`,controller.signal).then(setData)
      .catch(err=>{if(err.name!=='AbortError')setError(err.message);});return()=>controller.abort();
  },[season,showTickets,before]);
  return <section><div className="sportsbook-toolbar"><label>Season <select value={season} onChange={e=>{
    setSeason(e.target.value);setBefore(null);setPages([]);
  }}>{meta?.seasons.map(s=><option key={s.seasonId} value={s.seasonId}>{s.name}</option>)}</select></label>
    <Link to={`/betting?tab=${showTickets?'tickets':'markets'}`}>Open betting</Link><Link to="/betting?tab=legacy">Legacy account</Link></div>
    {error&&<p role="alert">{error}</p>}
    {!season&&meta?<p>No season is available yet.</p>:!data&&!error?<p>Loading betting account…</p>:data&&(!showTickets?
      <><h2>{points(data.balance)} season points</h2><p>Each season starts with 10,000 points. Older season and legacy accounts remain separate.</p></>:
      <><h2>Your season tickets</h2>{!data.tickets.length&&<p>No tickets in this season yet.</p>}
        {data.tickets.map(t=><article className="sportsbook-market" key={t.ticketId}>
          <h3>Ticket #{t.ticketId} · {t.status}</h3><p>{points(t.stake)} points staked{t.status!=='pending'&&` · ${points(t.payout)} returned`} · {new Date(t.placedAt).toLocaleString('en-US',{timeZone:'America/New_York'})} NY</p>
          <ul>{t.legs.map((l,i)=><li key={i}>{l.title} — {l.selection} @ {l.odds.toFixed(2)} · {l.result}</li>)}</ul>
        </article>)}
        <div className="sportsbook-paging"><button type="button" disabled={!pages.length} onClick={()=>{setBefore(pages.at(-1));setPages(p=>p.slice(0,-1));}}>Previous</button>
          <span>Page {pages.length+1}</span><button type="button" disabled={!data.nextBefore} onClick={()=>{setPages(p=>[...p,before]);setBefore(data.nextBefore);}}>Next</button></div>
      </>)}
  </section>;
}
