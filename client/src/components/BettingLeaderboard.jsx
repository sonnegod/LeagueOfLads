import {useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {bettingRequest} from '../utils/bettingRequest';

const columns=[['name','Player'],['wagered','Currently wagered'],['net','Net points'],['balance','Balance']];
const points=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
const pageSize=20;

export default function BettingLeaderboard({seasonId,active,refreshKey}){
  const [filters,setFilters]=useState({search:'',sort:'net',direction:'desc',page:1});
  const [players,setPlayers]=useState(null),[error,setError]=useState(null),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
  const loadedKey=useRef(null),requestKey=`${seasonId}:${refreshKey}:${retry}`;
  useEffect(()=>{
    if(!active||!seasonId||loadedKey.current===requestKey)return;
    const controller=new AbortController();setLoading(true);setError(null);
    bettingRequest(`/api/betting/leaderboard?seasonId=${encodeURIComponent(seasonId)}`,{signal:controller.signal,cache:'no-store'})
      .then(data=>{if(!controller.signal.aborted){loadedKey.current=requestKey;setPlayers(data.players);}})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[active,seasonId,requestKey]);
  const matches=useMemo(()=>{
    const needle=filters.search.trim().toLocaleLowerCase();
    const rows=(players||[]).filter(player=>!needle||player.name.toLocaleLowerCase().includes(needle)||player.userId.includes(needle));
    const names=(a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base',numeric:true});
    return rows.sort((a,b)=>{
      const compared=filters.sort==='name'?names(a,b):a[filters.sort]-b[filters.sort];
      return compared*(filters.direction==='asc'?1:-1)||names(a,b)||a.userId.localeCompare(b.userId,'en',{numeric:true});
    });
  },[players,filters.search,filters.sort,filters.direction]);
  if(!active)return null;
  const total=matches.length,pageCount=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(filters.page,pageCount);
  const visiblePlayers=matches.slice((page-1)*pageSize,page*pageSize);
  function sortBy(key){setFilters(current=>({...current,sort:key,page:1,
    direction:current.sort===key?(current.direction==='asc'?'desc':'asc'):key==='name'?'asc':'desc'}));}
  return <section className="sportsbook-leaderboard"><h2>Season leaderboard</h2>
    <p className="sportsbook-notice">Currently wagered is tied up in unsettled tickets. Net points shows settled profit or loss.</p>
    <div className="sportsbook-leaderboard-controls"><label>Search players
      <input type="search" maxLength={100} placeholder="Player name or account ID" value={filters.search}
        onChange={event=>setFilters(current=>({...current,search:event.target.value,page:1}))}/></label>
      {players&&<p className="sportsbook-notice" role="status">{total?`${(page-1)*pageSize+1}–${Math.min(page*pageSize,total)} of ${total} ${total===1?'player':'players'}`:'0 players'}</p>}
    </div>
    {error&&<p className="sportsbook-error" role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
    <div className="sportsbook-leaderboard-table" role="region" aria-label="Season leaderboard" tabIndex={0}>
      <table className="sportsbook-table" aria-busy={loading||!players&&!error}><thead><tr>{columns.map(([key,label])=>{
        const selected=filters.sort===key;
        return <th key={key} scope="col" aria-sort={selected?(filters.direction==='asc'?'ascending':'descending'):'none'}>
          <button type="button" onClick={()=>sortBy(key)} title={`Sort by ${label.toLowerCase()}`}>
            {label}<span aria-hidden="true">{selected?(filters.direction==='asc'?'↑':'↓'):'↕'}</span>
          </button></th>;
      })}</tr></thead><tbody>
        {visiblePlayers.map(player=><tr key={player.userId}><td><Link to={`/player/${player.userId}`}>{player.name}</Link></td>
          <td>{points(player.wagered)}</td><td>{points(player.net)}</td><td>{points(player.balance)}</td></tr>)}
        {!players&&<tr><td colSpan={4}>{error?'Leaderboard unavailable.':'Loading leaderboard…'}</td></tr>}
        {players&&!visiblePlayers.length&&<tr><td colSpan={4}>{filters.search.trim()?'No players match your search.':'No betting accounts in this season yet.'}</td></tr>}
      </tbody></table>
    </div>
    <nav className="sportsbook-paging" aria-label="Leaderboard pages">
      <button type="button" disabled={!players||page<=1} onClick={()=>setFilters(current=>({...current,page:page-1}))}>Previous</button>
      <span>Page {page} of {pageCount}</span>
      <button type="button" disabled={!players||page>=pageCount} onClick={()=>setFilters(current=>({...current,page:page+1}))}>Next</button>
    </nav>
  </section>;
}
