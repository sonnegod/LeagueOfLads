import { useEffect,useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {bettingRequest as request} from '../utils/bettingRequest';
import {useSeasonBetSlip} from '../context/seasonBetSlip';
import '../css/BettingV2.css';
import HistoricalBettingPreview from '../components/HistoricalBettingPreview';
import {PlayerOddsRow,TeamOddsGroups} from '../components/PreseasonOdds';
import {ScheduledBettingCard,ScheduledPlayerProps} from '../components/ScheduledBettingFixture';
import SeasonBetSlip from '../components/SeasonBetSlip';

const date=value=>new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const points=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});

function SportsbookPage() {
  const [params]=useSearchParams();
  const {user}=useAuth();const [meta,setMeta]=useState(null);
  const {season,setSeason,slip,busy,choose,revision}=useSeasonBetSlip();
  const [search,setSearch]=useState('');const [event,setEvent]=useState('');const [data,setData]=useState({markets:[]});
  const [marketView,setMarketView]=useState('series');const [preseasonGroup,setPreseasonGroup]=useState('player');
  const [events,setEvents]=useState([]);const [wallet,setWallet]=useState(null);const [tickets,setTickets]=useState({tickets:[]});
  const [leaderboard,setLeaderboard]=useState([]);const [legacy,setLegacy]=useState(null);const [tab,setTab]=useState(()=>['tickets','leaderboard','legacy'].includes(params.get('tab'))?params.get('tab'):'markets');
  const [before,setBefore]=useState(null);const [pages,setPages]=useState([]);const [ticketBefore,setTicketBefore]=useState(null);const [ticketPages,setTicketPages]=useState([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const selectedSeason=params.get('seasonId');
  useEffect(()=>{const controller=new AbortController();request('/api/betting/meta',{signal:controller.signal}).then(value=>{
    if(controller.signal.aborted)return;
    setMeta(value);setSeason(current=>String(value.seasons.find(s=>String(s.seasonId)===selectedSeason)?.seasonId||value.seasons.find(s=>String(s.seasonId)===current)?.seasonId||value.defaultSeasonId||''));
  }).catch(err=>{if(err.name!=='AbortError')setError(err.message);});return()=>controller.abort();},[setSeason,selectedSeason]);
  useEffect(()=>{setBefore(null);setPages([]);setEvent('');setTicketBefore(null);setTicketPages([]);},[season]);
  useEffect(()=>{
    if(!season)return;const controller=new AbortController();setLoading(true);setError('');
    const view=marketView==='preseason'?preseasonGroup:marketView;
    const params=new URLSearchParams({seasonId:season,limit:'20',view:view==='leaders'?'all':view});
    if(view==='leaders')params.set('type','player_leader');else if(view==='series')params.set('groupFixtures','1');
    if(search)params.set('search',search);if(['series','props'].includes(view)&&event)params.set('eventId',event);if(before)params.set('before',before);
    const ticketParams=new URLSearchParams({seasonId:season});if(ticketBefore)ticketParams.set('before',ticketBefore);
    Promise.all([request(`/api/betting/${view==='props'?'player-props':'markets'}?${params}`,{signal:controller.signal}),request(`/api/betting/events?seasonId=${season}`,{signal:controller.signal}),
      request(`/api/betting/leaderboard?seasonId=${season}`,{signal:controller.signal}),
      ...(user?[request(`/api/betting/wallet?seasonId=${season}`,{signal:controller.signal}),request(`/api/betting/tickets?${ticketParams}`,{signal:controller.signal})]:[])])
      .then(([markets,fixtures,leaders,balance,history])=>{if(controller.signal.aborted)return;setData(markets);setEvents(fixtures.events);setLeaderboard(leaders.players);setWallet(balance||null);setTickets(history||{tickets:[]});})
      .catch(err=>{if(err.name!=='AbortError')setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[season,marketView,preseasonGroup,search,event,before,ticketBefore,user,refresh,revision]);
  useEffect(()=>{if(tab!=='legacy'||!user)return;const controller=new AbortController();request('/api/betting/legacy',{signal:controller.signal}).then(setLegacy)
    .catch(err=>{if(err.name!=='AbortError')setError(err.message);});return()=>controller.abort();},[tab,user,refresh,revision]);
  const playerView=marketView==='preseason'&&preseasonGroup==='player';
  const teamView=marketView==='preseason'&&preseasonGroup==='team';
  function changeMarketView(value){setMarketView(value);setBefore(null);setPages([]);setData({markets:[]});}
  function changePreseasonGroup(value){setPreseasonGroup(value);setBefore(null);setPages([]);setData({markets:[]});}
  return <div className="ui-page sportsbook-page">
    <header className="sportsbook-heading"><div><h1>League betting</h1><p>Series, player props, and season futures · Site points</p></div>
      {user&&wallet&&<div className="sportsbook-wallet"><strong>{points(wallet.balance)}</strong><span>Season points</span></div>}</header>
    {meta?.localTesting&&<p className="sportsbook-test-banner" role="status"><strong>Local test betting</strong> · Development only. Test wallets and tickets are separate. Prices are available for testing and have not been approved for production.</p>}
    <div className="sportsbook-toolbar sportsbook-season-toolbar"><label><span>Season</span><select value={season} onChange={e=>setSeason(e.target.value)}>
      {meta?.seasons.map(s=><option key={s.seasonId} value={s.seasonId}>{s.name}</option>)}</select></label>
      <button type="button" disabled={loading} onClick={()=>setRefresh(r=>r+1)}>Refresh</button></div>
    <div className="ui-tabs" aria-label="Betting sections">{[['markets','Markets'],['tickets','Your tickets'],['leaderboard','Leaderboard'],['legacy','Legacy history']].map(([key,label])=>
      <button type="button" className="ui-tab" key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}
    {!season&&meta&&<p>No season is available yet.</p>}
    {tab==='markets'&&<div className="sportsbook-layout"><section>
      <div className="ui-tabs" aria-label="Market categories">{[['series','Matchups'],['props','Player props'],['preseason','Preseason']].map(([key,label])=>
        <button type="button" className="ui-tab" key={key} aria-pressed={marketView===key} onClick={()=>changeMarketView(key)}>{label}</button>)}</div>
      {marketView==='preseason'&&<div className="ui-tabs" aria-label="Preseason odds">{[['player','Player odds'],['team','Team odds'],['leaders','Player leaders']].map(([key,label])=>
        <button type="button" className="ui-tab" key={key} aria-pressed={preseasonGroup===key} onClick={()=>changePreseasonGroup(key)}>{label}</button>)}</div>}
      <div className="sportsbook-filters">{['series','props'].includes(marketView)&&<>
        <label>Fixture<select value={event} onChange={e=>{setEvent(e.target.value);setBefore(null);setPages([]);}}><option value="">All fixtures</option>
          {events.map(e=><option key={e.eventId} value={e.eventId}>{e.localTestFixture?'Test · ':''}{e.team1} vs {e.team2} · {date(e.startAt)} NY</option>)}</select></label></>}
        <label>Search<input type="search" maxLength="100" placeholder="Player, team or market" value={search} onChange={e=>{setSearch(e.target.value);setBefore(null);setPages([]);}} /></label></div>
      {loading&&<p role="status">Loading markets…</p>}
      {!loading&&!(teamView?data.teamGroups?.length:playerView||marketView==='props'?data.players?.length:marketView==='series'?data.fixtures?.length:data.markets?.length)&&<div className="sportsbook-empty"><h2>No markets available</h2><p>{marketView==='preseason'?'Preseason markets appear after setup is finalized and pricing is ready.':'Try another fixture or check back before kickoff.'}</p></div>}
      {playerView&&<><p className="sportsbook-notice">Rostered regular-season games only. At least 5 games and more than 50% participation required.</p>
        <div className="historical-player-list">{(data.players||[]).map(player=><PlayerOddsRow key={`${season}:${player.playerId}`} player={player} onChoose={choose} slip={slip} busy={busy||loading} canBet={Boolean(user)} />)}</div></>}
      {teamView&&<TeamOddsGroups groups={data.teamGroups||[]} onChoose={choose} slip={slip} busy={busy||loading} canBet={Boolean(user)} />}
      {marketView==='series'&&<div className="scheduled-fixtures">{(data.fixtures||[]).map(fixture=><ScheduledBettingCard key={`${season}:${fixture.eventId}`} fixture={fixture} onChoose={choose} slip={slip} busy={busy||loading} canBet={Boolean(user)}/>)}</div>}
      {marketView==='props'&&<div className="historical-player-list">{(data.players||[]).map(player=><ScheduledPlayerProps key={`${season}:${player.fixture.eventId}:${player.playerId}`} player={player} bestOf={player.fixture.bestOf} refreshKey={`${refresh}:${revision}`} onChoose={choose} slip={slip} busy={busy||loading} canBet={Boolean(user)}/>)}</div>}
      {marketView==='preseason'&&!playerView&&!teamView&&<div className="sportsbook-markets">{data.markets.map(m=><article className="sportsbook-market" key={m.marketId}>
        <div className="sportsbook-market-meta"><span>{m.eventId?`BO${m.bestOf} · ${m.stage}`:m.type==='champion'?'Preseason · League title':m.type==='placement'?'Preseason · Bracket placement':'Preseason · Regular-season stats'}</span><span>{m.status==='open'?(m.closeAt?`Closes ${date(m.closeAt)} NY`:'Closes when the season starts'):m.status}</span></div>
        <h2>{m.title}</h2>{m.playerId&&<Link to={`/player/${m.playerId}`}>Player profile</Link>}
        {m.notice&&<p className="sportsbook-notice">{m.notice}</p>}
        <div className="sportsbook-selections">{m.selections.map(s=><button type="button" key={s.selectionId} disabled={!user||m.status!=='open'||s.available===false||busy||loading}
          data-signin-required={!user||undefined} title={!user?'Sign in with Steam to add this to your bet slip':m.notice||undefined}
          aria-pressed={slip.some(l=>l.selectionId===s.selectionId)} onClick={()=>choose(m,s)}><span>{s.label}</span><strong>{s.odds.toFixed(2)}×</strong></button>)}</div>
        {m.type==='player_prop'&&<small>{m.scope==='game'?'Player must appear in this game.':'Player must appear in every official game of the series.'} Otherwise refunded.</small>}
        {['season_player','player_leader'].includes(m.type)&&<small>Rostered regular-season games only. At least 5 games and more than 50% participation required.</small>}
        {m.type==='season_team'&&<small>Regular-season game wins, not series wins. Tiebreakers and playoffs excluded. Shortened or canceled seasons and affected team forfeits refund unresolved bets.</small>}
      </article>)}</div>}
      {!teamView&&<div className="sportsbook-paging"><button type="button" disabled={!pages.length||loading} onClick={()=>{setBefore(pages.at(-1));setPages(p=>p.slice(0,-1));}}>Previous</button>
        <span>Page {pages.length+1}</span><button type="button" disabled={!data.nextBefore||loading} onClick={()=>{setPages(p=>[...p,before]);setBefore(data.nextBefore);}}>Next</button></div>}
    </section><SeasonBetSlip disabled={loading}/></div>}
    {tab==='tickets'&&(!user?<p>Sign in with Steam to see your tickets.</p>:<section className="sportsbook-tickets"><h2>Your season tickets</h2>
      {!tickets.tickets.length&&<p>No tickets in this season yet.</p>}{tickets.tickets.map(t=><article className="sportsbook-market" key={t.ticketId}>
        <h3>Ticket #{t.ticketId} · {t.status}</h3><p>{points(t.stake)} points staked · {date(t.placedAt)} NY{t.status!=='pending'&&` · ${points(t.payout)} returned`}</p>
        <ul>{t.legs.map((l,i)=><li key={i}>{l.title} — {l.selection} @ {l.odds.toFixed(2)}× · {l.result}{l.tieDivisor>1&&` (${l.tieDivisor} tied winners)`}</li>)}</ul>
      </article>)}<div className="sportsbook-paging"><button type="button" disabled={!ticketPages.length} onClick={()=>{setTicketBefore(ticketPages.at(-1));setTicketPages(p=>p.slice(0,-1));}}>Previous</button><span>Page {ticketPages.length+1}</span>
        <button type="button" disabled={!tickets.nextBefore} onClick={()=>{setTicketPages(p=>[...p,ticketBefore]);setTicketBefore(tickets.nextBefore);}}>Next</button></div></section>)}
    {tab==='leaderboard'&&<section><h2>Season leaderboard</h2><table className="sportsbook-table"><thead><tr><th>Player</th><th>Net points</th><th>Balance</th></tr></thead><tbody>
      {leaderboard.map(p=><tr key={p.userId}><td><Link to={`/player/${p.userId}`}>{p.name}</Link></td><td>{points(p.net)}</td><td>{points(p.balance)}</td></tr>)}</tbody></table></section>}
    {tab==='legacy'&&(!user?<p>Sign in with Steam to see your older tickets.</p>:<section><h2>Legacy betting</h2><p>Older balances and tickets remain separate from season points.</p>
      {legacy&&<><p>Legacy balance: {points(legacy.balance)} points</p><table className="sportsbook-table"><thead><tr><th>Ticket</th><th>Status</th><th>Stake</th><th>Odds</th></tr></thead><tbody>
        {legacy.tickets.map(t=><tr key={t.ticketId}><td>#{t.ticketId}</td><td>{t.status}</td><td>{points(t.stake)}</td><td>{Number(t.odds).toFixed(2)}×</td></tr>)}</tbody></table></>}
    </section>)}
  </div>;
}

export default function BettingPage(){
  const [params]=useSearchParams();const preview=params.get('previewLeague'),season=params.get('previewSeason');
  return season?<HistoricalBettingPreview key={`season:${season}`} seasonId={season} />:preview?<HistoricalBettingPreview key={preview} leagueId={preview} />:<SportsbookPage />;
}
