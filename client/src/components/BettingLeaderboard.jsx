import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {bettingRequest} from '../utils/bettingRequest';

const columns=[['name','Player'],['wagered','Currently wagered'],['net','Net points'],['balance','Balance']];
const points=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});

export default function BettingLeaderboard({seasonId,active,refreshKey}){
  const [filters,setFilters]=useState({search:'',sort:'net',direction:'desc',page:1});
  const [result,setResult]=useState(null),[error,setError]=useState(null),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
  const query=new URLSearchParams({seasonId:String(seasonId),...filters,search:filters.search.trim()}).toString();
  useEffect(()=>{
    if(!active||!seasonId)return;
    const controller=new AbortController();let timer,inFlight=false;
    const load=async(background=false)=>{
      if(inFlight||controller.signal.aborted)return;
      clearTimeout(timer);inFlight=true;
      if(!background){setLoading(true);setError(null);}
      try{
        const data=await bettingRequest(`/api/betting/leaderboard?${query}`,{signal:controller.signal,cache:'no-store'});
        if(!controller.signal.aborted){setResult({query,data});setError(null);}
      }catch(cause){if(!controller.signal.aborted)setError({query,message:cause.message});}
      finally{
        inFlight=false;
        if(!controller.signal.aborted){setLoading(false);timer=setTimeout(()=>{if(document.visibilityState!=='hidden')load(true);},30000);}
      }
    };
    // A short debounce avoids a request for every keystroke in player search.
    timer=setTimeout(()=>load(),200);
    const visible=()=>{if(document.visibilityState==='visible')load(true);};
    document.addEventListener('visibilitychange',visible);
    return()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  },[active,seasonId,query,refreshKey,retry]);
  if(!active)return null;
  const data=result?.query===query?result.data:null,currentError=error?.query===query?error.message:null;
  const pageCount=data?Math.max(1,Math.ceil(data.total/data.pageSize)):1;
  function sortBy(key){setFilters(current=>({...current,sort:key,page:1,
    direction:current.sort===key?(current.direction==='asc'?'desc':'asc'):key==='name'?'asc':'desc'}));}
  return <section className="sportsbook-leaderboard"><h2>Season leaderboard</h2>
    <p className="sportsbook-notice">Currently wagered is tied up in unsettled tickets. Net points shows settled profit or loss.</p>
    <div className="sportsbook-leaderboard-controls"><label>Search players
      <input type="search" maxLength={100} placeholder="Player name or account ID" value={filters.search}
        onChange={event=>setFilters(current=>({...current,search:event.target.value,page:1}))}/></label>
      {data&&<p className="sportsbook-notice" role="status">{data.total?`${(data.page-1)*data.pageSize+1}–${Math.min(data.page*data.pageSize,data.total)} of ${data.total} ${data.total===1?'player':'players'}`:'0 players'}</p>}
    </div>
    {currentError&&<p className="sportsbook-error" role="alert">{currentError} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
    <div className="sportsbook-leaderboard-table" role="region" aria-label="Season leaderboard" tabIndex={0}>
      <table className="sportsbook-table" aria-busy={loading||!data&&!currentError}><thead><tr>{columns.map(([key,label])=>{
        const selected=filters.sort===key;
        return <th key={key} scope="col" aria-sort={selected?(filters.direction==='asc'?'ascending':'descending'):'none'}>
          <button type="button" onClick={()=>sortBy(key)} title={`Sort by ${label.toLowerCase()}`}>
            {label}<span aria-hidden="true">{selected?(filters.direction==='asc'?'↑':'↓'):'↕'}</span>
          </button></th>;
      })}</tr></thead><tbody>
        {data?.players.map(player=><tr key={player.userId}><td><Link to={`/player/${player.userId}`}>{player.name}</Link></td>
          <td>{points(player.wagered)}</td><td>{points(player.net)}</td><td>{points(player.balance)}</td></tr>)}
        {!data&&<tr><td colSpan={4}>{currentError?'Leaderboard unavailable.':'Loading leaderboard…'}</td></tr>}
        {data&&!data.players.length&&<tr><td colSpan={4}>{filters.search.trim()?'No players match your search.':'No betting accounts in this season yet.'}</td></tr>}
      </tbody></table>
    </div>
    <nav className="sportsbook-paging" aria-label="Leaderboard pages">
      <button type="button" disabled={loading||!data||data.page<=1} onClick={()=>setFilters(current=>({...current,page:data.page-1}))}>Previous</button>
      <span>Page {data?.page||1} of {pageCount}</span>
      <button type="button" disabled={loading||!data||data.page>=pageCount} onClick={()=>setFilters(current=>({...current,page:data.page+1}))}>Next</button>
    </nav>
  </section>;
}
