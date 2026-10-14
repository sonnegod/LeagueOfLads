import { useEffect,useRef,useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { quotedReturn } from '../utils/bettingPoints';
import '../css/BettingV2.css';
import HistoricalBettingPreview from '../components/HistoricalBettingPreview';
import {PlayerOddsRow,TeamOddsGroups} from '../components/PreseasonOdds';

const date=value=>new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const points=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
const types=[['','All markets'],['series_winner','Series result'],['exact_score','Exact score'],['player_prop','Player props'],
  ['season_player','Season totals / averages'],['player_leader','Player leaders'],['champion','League champion'],['placement','Bracket placement']];
async function request(url,options) {const response=await fetch(url,options);const data=await response.json();if(!response.ok){const error=new Error(data.error||'Request failed');error.code=data.code;throw error;}return data;}

function SportsbookPage() {
  const [params]=useSearchParams();
  const {user}=useAuth();const [meta,setMeta]=useState(null);const [season,setSeason]=useState('');const [type,setType]=useState('');
  const [search,setSearch]=useState('');const [event,setEvent]=useState('');const [data,setData]=useState({markets:[]});
  const [marketView,setMarketView]=useState('series');const [preseasonGroup,setPreseasonGroup]=useState('player');
  const [events,setEvents]=useState([]);const [wallet,setWallet]=useState(null);const [tickets,setTickets]=useState({tickets:[]});
  const [leaderboard,setLeaderboard]=useState([]);const [legacy,setLegacy]=useState(null);const [tab,setTab]=useState(()=>['tickets','leaderboard','legacy'].includes(params.get('tab'))?params.get('tab'):'markets');
  const [before,setBefore]=useState(null);const [pages,setPages]=useState([]);const [ticketBefore,setTicketBefore]=useState(null);const [ticketPages,setTicketPages]=useState([]);
  const [slip,setSlip]=useState([]);const [stake,setStake]=useState('100');const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');const [message,setMessage]=useState('');const [refresh,setRefresh]=useState(0);const [reviewQuotes,setReviewQuotes]=useState(false);
  const requestKey=useRef(crypto.randomUUID());
  useEffect(()=>{const controller=new AbortController();request('/api/betting/meta',{signal:controller.signal}).then(value=>{setMeta(value);setSeason(String(value.defaultSeasonId||''));})
    .catch(err=>{if(err.name!=='AbortError')setError(err.message);});return()=>controller.abort();},[]);
  useEffect(()=>{setSlip([]);setBefore(null);setPages([]);setEvent('');setTicketBefore(null);setTicketPages([]);},[season]);
  useEffect(()=>{requestKey.current=crypto.randomUUID();},[slip,stake]);
  useEffect(()=>{
    if(!season)return;const controller=new AbortController();setLoading(true);setError('');
    const view=marketView==='preseason'?preseasonGroup:marketView;
    const params=new URLSearchParams({seasonId:season,limit:'20',view:view==='leaders'?'all':view});
    if(view==='leaders')params.set('type','player_leader');else if(view==='series'&&type)params.set('type',type);
    if(search)params.set('search',search);if(view==='series'&&event)params.set('eventId',event);if(before)params.set('before',before);
    const ticketParams=new URLSearchParams({seasonId:season});if(ticketBefore)ticketParams.set('before',ticketBefore);
    Promise.all([request(`/api/betting/markets?${params}`,{signal:controller.signal}),request(`/api/betting/events?seasonId=${season}`,{signal:controller.signal}),
      request(`/api/betting/leaderboard?seasonId=${season}`,{signal:controller.signal}),
      ...(user?[request(`/api/betting/wallet?seasonId=${season}`,{signal:controller.signal}),request(`/api/betting/tickets?${ticketParams}`,{signal:controller.signal})]:[])])
      .then(([markets,fixtures,leaders,balance,history])=>{if(controller.signal.aborted)return;setData(markets);setEvents(fixtures.events);setLeaderboard(leaders.players);setWallet(balance||null);setTickets(history||{tickets:[]});})
      .catch(err=>{if(err.name!=='AbortError')setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[season,marketView,preseasonGroup,type,search,event,before,ticketBefore,user,refresh]);
  useEffect(()=>{if(tab!=='legacy'||!user)return;const controller=new AbortController();request('/api/betting/legacy',{signal:controller.signal}).then(setLegacy)
    .catch(err=>{if(err.name!=='AbortError')setError(err.message);});return()=>controller.abort();},[tab,user,refresh]);
  function choose(market,selection) {
    setMessage('');setReviewQuotes(false);
    const old=slip;
    if(old.some(s=>s.selectionId===selection.selectionId)){setSlip(old.filter(s=>s.selectionId!==selection.selectionId));return;}
    const retained=old.filter(s=>s.marketId!==market.marketId&&(market.eventId?s.eventId!==market.eventId:!!s.eventId));
    if(retained.length>=8){setError('A ticket can contain at most eight selections.');return;}
    setSlip([...retained,{marketId:market.marketId,eventId:market.eventId,selectionId:selection.selectionId,quoteVersion:market.quoteVersion,odds:selection.odds,title:market.title,label:selection.label}]);
  }
  async function updateQuotes() {
    setBusy(true);try {const response=await request(`/api/betting/quotes?ids=${slip.map(s=>s.selectionId).join(',')}`);
      if(response.quotes.some(q=>q.status!=='open'))throw new Error('One of your selections is no longer open. Remove it before betting.');
      setSlip(old=>old.map(s=>({...s,...response.quotes.find(q=>q.selectionId===s.selectionId)})));setReviewQuotes(false);setMessage('Quotes updated. Review the slip before placing your bet.');
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  async function place(event) {
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try {const result=await request('/api/betting/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      seasonId:Number(season),stake,requestKey:requestKey.current,legs:slip.map(s=>({selectionId:s.selectionId,quoteVersion:s.quoteVersion}))})});
      setMessage(`Ticket #${result.ticketId} placed.`);setSlip([]);setRefresh(r=>r+1);
    }catch(err){setError(err.message);if(err.code==='QUOTE_CHANGED')setReviewQuotes(true);setRefresh(r=>r+1);}finally{setBusy(false);}
  }
  const odds=slip.reduce((product,s)=>product*s.odds,1);
  const potential=quotedReturn(stake,slip.map(s=>s.odds));
  const playerView=marketView==='preseason'&&preseasonGroup==='player';
  const teamView=marketView==='preseason'&&preseasonGroup==='team';
  function changeMarketView(value){setMarketView(value);setBefore(null);setPages([]);setData({markets:[]});}
  function changePreseasonGroup(value){setPreseasonGroup(value);setBefore(null);setPages([]);setData({markets:[]});}
  return <div className="ui-page sportsbook-page">
    <header className="sportsbook-heading"><div><h1>League betting</h1><p>Series, player props, and season futures · Site points</p></div>
      {user&&wallet&&<div className="sportsbook-wallet"><strong>{points(wallet.balance)}</strong><span>Season points</span></div>}</header>
    <div className="sportsbook-toolbar"><label>Season<select value={season} onChange={e=>setSeason(e.target.value)}>
      {meta?.seasons.map(s=><option key={s.seasonId} value={s.seasonId}>{s.name}</option>)}</select></label>
      <button type="button" disabled={loading} onClick={()=>setRefresh(r=>r+1)}>Refresh</button></div>
    <div className="ui-tabs" aria-label="Betting sections">{[['markets','Markets'],['tickets','Your tickets'],['leaderboard','Leaderboard'],['legacy','Legacy history']].map(([key,label])=>
      <button type="button" className="ui-tab" key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {!season&&meta&&<p>No season is available yet.</p>}
    {tab==='markets'&&<div className="sportsbook-layout"><section>
      <div className="ui-tabs" aria-label="Market categories">{[['series','Scheduled games'],['preseason','Preseason']].map(([key,label])=>
        <button type="button" className="ui-tab" key={key} aria-pressed={marketView===key} onClick={()=>changeMarketView(key)}>{label}</button>)}</div>
      {marketView==='preseason'&&<div className="ui-tabs" aria-label="Preseason odds">{[['player','Player odds'],['team','Team odds'],['leaders','Player leaders']].map(([key,label])=>
        <button type="button" className="ui-tab" key={key} aria-pressed={preseasonGroup===key} onClick={()=>changePreseasonGroup(key)}>{label}</button>)}</div>}
      <div className="sportsbook-filters">{marketView==='series'&&<><label>Market type<select value={type} onChange={e=>{setType(e.target.value);setBefore(null);setPages([]);}}>{types.slice(0,4).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>Fixture<select value={event} onChange={e=>{setEvent(e.target.value);setBefore(null);setPages([]);}}><option value="">All fixtures</option>
          {events.map(e=><option key={e.eventId} value={e.eventId}>{e.team1} vs {e.team2} · {date(e.startAt)} NY</option>)}</select></label></>}
        <label>Search<input type="search" maxLength="100" placeholder="Player, team or market" value={search} onChange={e=>{setSearch(e.target.value);setBefore(null);setPages([]);}} /></label></div>
      {loading&&<p role="status">Loading markets…</p>}
      {!loading&&!(teamView?data.teamGroups?.length:playerView?data.players?.length:data.markets.length)&&<div className="sportsbook-empty"><h2>No markets available</h2><p>{marketView==='preseason'?'Preseason markets appear after setup is finalized and pricing is ready.':'Try another fixture or check back before kickoff.'}</p></div>}
      {playerView&&<><p className="sportsbook-notice">Rostered regular-season games only. At least 5 games and more than 50% participation required.</p>
        <div className="historical-player-list">{(data.players||[]).map(player=><PlayerOddsRow key={`${season}:${player.playerId}`} player={player} onChoose={choose} slip={slip} busy={busy||loading} />)}</div></>}
      {teamView&&<TeamOddsGroups groups={data.teamGroups||[]} onChoose={choose} slip={slip} busy={busy||loading} />}
      {!playerView&&!teamView&&<div className="sportsbook-markets">{data.markets.map(m=><article className="sportsbook-market" key={m.marketId}>
        <div className="sportsbook-market-meta"><span>{m.eventId?`BO${m.bestOf} · ${m.stage}`:m.type==='champion'?'Preseason · League title':m.type==='placement'?'Preseason · Bracket placement':'Preseason · Regular-season stats'}</span><span>{m.status==='open'?`Closes ${date(m.closeAt)} NY`:m.status}</span></div>
        <h2>{m.title}</h2>{m.playerId&&<Link to={`/player/${m.playerId}`}>Player profile</Link>}
        {m.notice&&<p className="sportsbook-notice">{m.notice}</p>}
        <div className="sportsbook-selections">{m.selections.map(s=><button type="button" key={s.selectionId} disabled={m.status!=='open'||s.available===false||busy||loading}
          aria-pressed={slip.some(l=>l.selectionId===s.selectionId)} onClick={()=>choose(m,s)}><span>{s.label}</span><strong>{s.odds.toFixed(2)}</strong></button>)}</div>
        {m.type==='player_prop'&&<small>{m.scope==='game'?'Player must appear in this game.':'Player must appear in every official game of the series.'} Otherwise refunded.</small>}
        {['season_player','player_leader'].includes(m.type)&&<small>Rostered regular-season games only. At least 5 games and more than 50% participation required.</small>}
      </article>)}</div>}
      {!teamView&&<div className="sportsbook-paging"><button type="button" disabled={!pages.length||loading} onClick={()=>{setBefore(pages.at(-1));setPages(p=>p.slice(0,-1));}}>Previous</button>
        <span>Page {pages.length+1}</span><button type="button" disabled={!data.nextBefore||loading} onClick={()=>{setPages(p=>[...p,before]);setBefore(data.nextBefore);}}>Next</button></div>}
    </section><aside className="sportsbook-slip"><h2>Bet slip</h2>
      {!slip.length&&<p>Choose an outcome to add it here.</p>}
      {slip.map(s=><div className="sportsbook-slip-selection" key={s.selectionId}><button type="button" aria-label={`Remove ${s.label}`} onClick={()=>setSlip(old=>old.filter(l=>l.selectionId!==s.selectionId))}>×</button>
        <strong>{s.title}</strong><span>{s.label} · {s.odds.toFixed(2)}</span></div>)}
      {slip.length>0&&<form onSubmit={place}><label>Stake (points)<input required type="number" min="0.01" max="1000" step="0.01" value={stake} onChange={e=>setStake(e.target.value)} /></label>
        <p>Combined odds <strong>{odds.toFixed(2)}</strong></p><p>Potential return <strong>{potential===null?'Choose a valid stake or fewer selections':`${points(potential)} points`}</strong></p>
        <small>1,000 points maximum per market across all tickets. One selection per fixture; one season future per ticket.</small>
        {reviewQuotes&&<button type="button" disabled={busy} onClick={updateQuotes}>Update quotes for review</button>}
        {user?<button type="submit" disabled={busy||reviewQuotes||potential===null}>{busy?'Submitting…':'Place bet'}</button>:<a href="/api/auth/steam">Sign in with Steam to bet</a>}
      </form>}
    </aside></div>}
    {tab==='tickets'&&(!user?<p>Sign in with Steam to see your tickets.</p>:<section className="sportsbook-tickets"><h2>Your season tickets</h2>
      {!tickets.tickets.length&&<p>No tickets in this season yet.</p>}{tickets.tickets.map(t=><article className="sportsbook-market" key={t.ticketId}>
        <h3>Ticket #{t.ticketId} · {t.status}</h3><p>{points(t.stake)} points staked · {date(t.placedAt)} NY{t.status!=='pending'&&` · ${points(t.payout)} returned`}</p>
        <ul>{t.legs.map((l,i)=><li key={i}>{l.title} — {l.selection} @ {l.odds.toFixed(2)} · {l.result}{l.tieDivisor>1&&` (${l.tieDivisor} tied winners)`}</li>)}</ul>
      </article>)}<div className="sportsbook-paging"><button type="button" disabled={!ticketPages.length} onClick={()=>{setTicketBefore(ticketPages.at(-1));setTicketPages(p=>p.slice(0,-1));}}>Previous</button><span>Page {ticketPages.length+1}</span>
        <button type="button" disabled={!tickets.nextBefore} onClick={()=>{setTicketPages(p=>[...p,ticketBefore]);setTicketBefore(tickets.nextBefore);}}>Next</button></div></section>)}
    {tab==='leaderboard'&&<section><h2>Season leaderboard</h2><table className="sportsbook-table"><thead><tr><th>Player</th><th>Net points</th><th>Balance</th></tr></thead><tbody>
      {leaderboard.map(p=><tr key={p.userId}><td><Link to={`/player/${p.userId}`}>{p.name}</Link></td><td>{points(p.net)}</td><td>{points(p.balance)}</td></tr>)}</tbody></table></section>}
    {tab==='legacy'&&(!user?<p>Sign in with Steam to see your older tickets.</p>:<section><h2>Legacy betting</h2><p>Older balances and tickets remain separate from season points.</p>
      {legacy&&<><p>Legacy balance: {points(legacy.balance)} points</p><table className="sportsbook-table"><thead><tr><th>Ticket</th><th>Status</th><th>Stake</th><th>Odds</th></tr></thead><tbody>
        {legacy.tickets.map(t=><tr key={t.ticketId}><td>#{t.ticketId}</td><td>{t.status}</td><td>{points(t.stake)}</td><td>{Number(t.odds).toFixed(2)}</td></tr>)}</tbody></table></>}
    </section>)}
  </div>;
}

export default function BettingPage(){
  const [params]=useSearchParams();const preview=params.get('previewLeague');
  return preview?<HistoricalBettingPreview key={preview} leagueId={preview} />:<SportsbookPage />;
}
