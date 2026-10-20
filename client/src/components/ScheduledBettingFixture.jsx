import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {PlayerMarketPrices,statNames} from './PreseasonOdds';
import {bettingRequest} from '../utils/bettingRequest';

const date=value=>new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const teamName=team=>{
  const href=team.teamId?`/team/${team.teamId}`:team.teamKey?`/team/roster/${team.teamKey}`:null;
  return href?<Link to={href}>{team.name}</Link>:team.name;
};
const scoreOutcomes=bestOf=>bestOf===2?['2-0','1-1','0-2']:
  [...Array.from({length:Math.ceil(bestOf/2)},(_,i)=>`${Math.ceil(bestOf/2)}-${i}`),
    ...Array.from({length:Math.ceil(bestOf/2)},(_,i)=>`${i}-${Math.ceil(bestOf/2)}`)];

export function ScheduledBettingCard({fixture,...actions}) {
  const keys=scoreOutcomes(fixture.bestOf);
  const href=`/bet/matchup/${fixture.eventId}`;
  return <article className="sportsbook-market scheduled-fixture scheduled-fixture-card">
    <div className="sportsbook-market-meta"><span>{fixture.localTestFixture?'Test · ':''}BO{fixture.bestOf} · {fixture.stage}</span><span>{date(fixture.startAt)} NY</span></div>
    <h2 className="scheduled-team-heading"><span title={fixture.team1.name}>{teamName(fixture.team1)}</span><span className="scheduled-vs">vs</span><span title={fixture.team2.name}>{teamName(fixture.team2)}</span></h2>
    <ResultPrices market={fixture.exactScore} keys={keys} labels={keys.map(key=>key.replace('-','–'))} compact {...actions}/>
    <div className="scheduled-card-footer"><span>{fixture.exactScore?.status==='open'?'':fixture.exactScore?.status||'Odds pending'}</span><Link className="scheduled-card-link" to={href} aria-label={`View bets for ${fixture.team1.name} vs ${fixture.team2.name}`}>View bets →</Link></div>
  </article>;
}

export function ScheduledPlayerProps({player,bestOf,refreshKey,...actions}) {
  const [scope,setScope]=useState('series'),[open,setOpen]=useState(false),[loaded,setLoaded]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!open||player.markets)return;
    const controller=new AbortController();setLoading(true);setError('');setLoaded(null);
    bettingRequest(`/api/betting/fixtures/${player.fixture.eventId}?playerId=${player.playerId}`,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted)setLoaded(data.fixture.players.find(p=>p.playerId===player.playerId)||{markets:[]});
    }).catch(err=>{if(err.name!=='AbortError')setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[open,player.markets,player.playerId,player.fixture?.eventId,refreshKey,retry]);
  const markets=player.markets||loaded?.markets||[];
  const stats=new Map();
  for(const market of markets) {
    if(!stats.has(market.stat))stats.set(market.stat,{});
    stats.get(market.stat)[market.scope==='game'?`game:${market.gameNumber}`:market.scope]=market;
  }
  const notices=[...new Set(markets.map(m=>m.notice).filter(Boolean))];
  const bettingActions={...actions,busy:actions.busy||loading};
  return <details className="historical-player-odds" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary><strong>{player.name}</strong><span className="historical-player-team">{player.teamName}</span>
      {player.fixture&&<span className="scheduled-player-matchup">{player.fixture.team1} vs {player.fixture.team2} · {date(player.fixture.startAt)} NY</span>}
      <span className="historical-player-count" title="Distinct people with non-refunded bets across this player's props in this matchup">{player.bettorCount||0} bettors</span>
    </summary>
    {open&&<div className="historical-player-content scheduled-fixture">
      {loading&&<p role="status">Loading player props…</p>}
      {error&&<p role="alert" className="sportsbook-error">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
      {!loading&&!error&&!stats.size&&<p className="sportsbook-notice">No props are available for this player.</p>}
      {stats.size>0&&<>
      <label className="scheduled-prop-scope">Player props<select value={scope} onChange={e=>setScope(e.target.value)}>
        <option value="series">Whole series</option>{Array.from({length:bestOf},(_,i)=><option key={i+1} value={`game:${i+1}`}>Game {i+1}</option>)}
      </select></label>
      {notices.map(notice=><p key={notice} className="sportsbook-notice">{notice}</p>)}
      <div className="historical-betting-fixtures"><table className="sportsbook-table historical-player-stats">
        <colgroup><col style={{width:'20%'}} />{scope==='series'?<><col style={{width:'40%'}} /><col style={{width:'40%'}} /></>:<col style={{width:'80%'}} />}</colgroup>
        <thead><tr><th>Stat</th>{scope==='series'?<><th>Series total</th><th>Per-game average</th></>:<th>Game {scope.split(':')[1]}</th>}</tr></thead>
        <tbody>{[...stats].map(([stat,markets])=><tr key={stat}><th scope="row">{statNames[stat]||stat}</th>
          {scope==='series'?<><td><PlayerMarketPrices market={markets.total} {...bettingActions}/></td><td><PlayerMarketPrices market={markets.average} {...bettingActions}/></td></>:<td><PlayerMarketPrices market={markets[scope]} {...bettingActions}/></td>}
        </tr>)}</tbody>
      </table></div>
      <small>{scope==='series'?'Player must appear in every official game of the series.':'Player must appear in this game.'} Otherwise refunded.</small>
      </>}
      {player.fixture&&<Link className="scheduled-player-link" to={`/bet/matchup/${player.fixture.eventId}`}>View matchup bets →</Link>}
      <Link to={`/player/${player.playerId}`}>Player profile</Link>
    </div>}
  </details>;
}

function ResultPrices({market,keys,labels,compact=false,...actions}) {
  if(!market)return <p className="sportsbook-notice">Score odds are not available yet.</p>;
  return <><div className={`sportsbook-selections scheduled-score-options${compact?' scheduled-card-prices':''}`} style={keys.length===3||(compact&&keys.length>4)?undefined:{gridTemplateColumns:`repeat(${keys.length},minmax(0,1fr))`}}>
    {keys.map((key,i)=>{
      const selection=market.selections.find(s=>s.key===key);
      return <button key={key} type="button" disabled={actions.canBet===false||!selection||market.status!=='open'||selection.available===false||actions.busy}
        data-signin-required={actions.canBet===false||undefined}
        title={actions.canBet===false?'Sign in with Steam to add this to your bet slip':market.notice||undefined} aria-label={`${market.title}: ${selection?.label||labels[i]}`}
        aria-pressed={selection?actions.slip.some(s=>s.selectionId===selection.selectionId):false}
        onClick={()=>selection&&actions.onChoose(market,selection)}>
        <span>{labels[i]}</span><strong>{selection?`${selection.odds.toFixed(2)}×`:'—'}</strong>{selection&&<small>{selection.bettorCount||0} bettors</small>}
      </button>;
    })}
  </div>{market.notice&&<p className="sportsbook-notice">{market.notice}</p>}</>;
}

export default function ScheduledBettingFixture({fixture,...actions}) {
  const scoreKeys=scoreOutcomes(fixture.bestOf);
  return <article className="sportsbook-market scheduled-fixture">
    <div className="sportsbook-market-meta"><span>{fixture.localTestFixture?'Test fixture · ':''}BO{fixture.bestOf} · {fixture.stage}</span><span>{date(fixture.startAt)} NY</span></div>
    <h2 className="scheduled-team-heading"><span>{teamName(fixture.team1)}</span><span className="scheduled-vs">vs</span><span>{teamName(fixture.team2)}</span></h2>
    <ResultPrices market={fixture.exactScore} keys={scoreKeys} labels={scoreKeys.map(k=>k.replace('-','–'))} {...actions}/>
    {fixture.bestOf!==2&&fixture.winner&&<><h3>Series winner</h3><ResultPrices market={fixture.winner} keys={['team1','team2']} labels={[fixture.team1.name,fixture.team2.name]} {...actions}/></>}
    <section className="scheduled-props"><h3>Player props</h3>
      <div className="scheduled-props-content">{!fixture.players.length&&<p className="sportsbook-notice">No player props are available for this matchup.</p>}
        <div className="historical-player-list">{fixture.players.map(player=><ScheduledPlayerProps key={player.playerId} player={player} bestOf={fixture.bestOf} {...actions}/>)}</div>
      </div>
    </section>
  </article>;
}
