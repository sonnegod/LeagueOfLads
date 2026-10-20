import {useEffect,useState} from 'react';

const place=(pool,index)=>index<pool.upper?'Upper bracket':index<pool.upper+pool.lower?'Lower bracket':'Eliminated';
const equal=(a,b)=>a&&b&&a.SeriesWins===b.SeriesWins&&a.Neustadtl===b.Neustadtl;

export default function TiebreakerResultsReview({leagueId,disabled,onChange}) {
  const [result,setResult]=useState(null),[attempt,setAttempt]=useState(0);
  const [orders,setOrders]=useState({}),[confirmed,setConfirmed]=useState({});
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/admin/tiebreakerResults?leagueId=${encodeURIComponent(leagueId)}`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load tiebreaker results');return data;})
      .then(data=>{if(!controller.signal.aborted){setOrders({});setConfirmed({});setResult({leagueId,attempt,data});}})
      .catch(error=>{if(!controller.signal.aborted)setResult({leagueId,attempt,error:error.message});});
    return()=>controller.abort();
  },[leagueId,attempt]);
  const data=result?.leagueId===leagueId&&result?.attempt===attempt?result.data:null;
  useEffect(()=>{
    if(!data){onChange(null);return;}
    const pools=data.pools||[];
    onChange({enabled:data.enabled,revision:data.revision,
      ready:!data.enabled||pools.every(pool=>!pool.problems.length&&(!pool.needsOrder||confirmed[pool.id])),
      poolOrders:Object.fromEntries(pools.filter(pool=>confirmed[pool.id]).map(pool=>[pool.id,orders[pool.id]||pool.teams.map(team=>team.TeamId)]))});
  },[data,orders,confirmed,onChange]);
  const refresh=<button type="button" disabled={disabled} onClick={()=>setAttempt(value=>value+1)}>Reload tiebreaker results</button>;
  if(!data)return <section className="tiebreaker-results-review">
    {result?.error?<p role="alert">{result.error}</p>:<p>Loading tiebreaker results...</p>}{refresh}
  </section>;
  if(!data.enabled)return null;
  function move(pool,teams,index,direction) {
    const next=[...teams.map(team=>team.TeamId)];[next[index],next[index+direction]]=[next[index+direction],next[index]];
    setOrders(current=>({...current,[pool.id]:next}));setConfirmed(current=>({...current,[pool.id]:false}));
  }
  return <section className="tiebreaker-results-review" aria-label="Review tiebreaker qualification">
    <h3>Review tiebreaker results</h3>
    <p>Starting playoffs saves each pool’s final order and puts its qualifiers into the upper or lower team selection pool. Series wins, then Neustadtl, determine the order.</p>
    {data.pools.map(pool=>{
      const teams=orders[pool.id]?.map(id=>pool.teams.find(team=>team.TeamId===id))||pool.teams;
      const complete=!pool.problems.length;
      return <section key={pool.id} className="tiebreaker-result-pool">
        <h4>{pool.name}</h4><p>BO{pool.bestOf} · {pool.completedPairs}/{pool.totalPairs} pairings completed</p>
        <ol>{teams.map((team,index)=><li key={team.TeamId}>
          <span>{team.TeamName} <small>{team.SeriesWins}–{team.SeriesLosses} series · Neustadtl {team.Neustadtl}</small></span>
          <strong>{place(pool,index)}</strong>
          {pool.needsOrder&&<span className="tiebreaker-order-buttons">
            <button type="button" aria-label={`Move ${team.TeamName} up`} disabled={disabled||!complete||!equal(team,teams[index-1])} onClick={()=>move(pool,teams,index,-1)}>↑</button>
            <button type="button" aria-label={`Move ${team.TeamName} down`} disabled={disabled||!complete||!equal(team,teams[index+1])} onClick={()=>move(pool,teams,index,1)}>↓</button>
          </span>}
        </li>)}</ol>
        {!!pool.problems.length&&<ul className="league-stage-error">{pool.problems.map(problem=><li key={problem}>{problem}</li>)}</ul>}
        {pool.needsOrder&&complete&&<label className="tiebreaker-confirm-order"><input type="checkbox" checked={!!confirmed[pool.id]} disabled={disabled}
          onChange={event=>setConfirmed(current=>({...current,[pool.id]:event.target.checked}))}/>
          Equal results cross a qualification cutoff. I confirm the official finishing order above.
        </label>}
      </section>;
    })}
    {refresh}
  </section>;
}
