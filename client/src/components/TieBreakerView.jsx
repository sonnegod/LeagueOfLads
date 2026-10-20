import {useEffect,useId,useState} from 'react';
import TieBreakerTable from './TieBreakerTable';
import UpperBracketTable from './UpperBracketTable';
import LowerBracketTable from './LowerBracketTable';
import EliminatedBracketTable from './EliminatedBracketTable';
import './TieBreakerView.css';

function QualifierTables({upper=[],lower=[],eliminated=[]}) {
  return <div className="tiebreaker-brackets">
    <UpperBracketTable teams={upper}/><LowerBracketTable teams={lower}/><EliminatedBracketTable teams={eliminated}/>
  </div>;
}

export default function TiebreakerView({leagueId}) {
  const [result,setResult]=useState(null),[selected,setSelected]=useState(null);
  const tabId=useId();
  useEffect(()=>{
    const controller=new AbortController();let pending=false;
    async function load() {
      if(pending)return;pending=true;
      try {
        const response=await fetch(leagueId?`/api/tiebreakerInfo?leagueId=${encodeURIComponent(leagueId)}`:'/api/tiebreakerInfo',
          {signal:controller.signal,cache:'no-store'});
        const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load tiebreakers');
        if(!controller.signal.aborted)setResult({leagueId,data});
      }catch(error){if(!controller.signal.aborted)setResult(current=>({leagueId,data:current?.leagueId===leagueId?current.data:null,error:error.message}));}
      finally{pending=false;}
    }
    load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},15000);
    return()=>{controller.abort();clearInterval(timer);};
  },[leagueId]);
  if(!result||result.leagueId!==leagueId)return <p>Loading tiebreakers...</p>;
  const data=result.data,pools=data?.tiebreakerPools||[],pool=pools.find(pool=>pool.id===selected)||pools[0];
  const activeIndex=pools.indexOf(pool);
  const switchTab=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const index=event.key==='Home'?0:event.key==='End'?pools.length-1:
      (activeIndex+(event.key==='ArrowRight'?1:-1)+pools.length)%pools.length;
    setSelected(pools[index].id);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[index]?.focus();
  };
  return <div className="tiebreaker-view">
    {result.error&&<p role="alert">{result.error}</p>}
    {data&&(pool?<>
      <div className="ui-tabs tiebreaker-tabs" role="tablist" aria-label="Tiebreaker pools">
        {pools.map((item,index)=><button key={item.id} type="button" className="ui-tab" role="tab"
          id={`${tabId}-tab-${index}`} aria-controls={`${tabId}-panel-${index}`} aria-selected={item.id===pool.id}
          tabIndex={item.id===pool.id?0:-1} onKeyDown={switchTab} onClick={()=>setSelected(item.id)}>{item.name}</button>)}
      </div>
      <section role="tabpanel" id={`${tabId}-panel-${activeIndex}`} aria-labelledby={`${tabId}-tab-${activeIndex}`}>
        <h2>{pool.name}</h2>
        <p>BO{pool.bestOf} round robin · Top {pool.upper} to upper bracket · Next {pool.lower} to lower bracket · {pool.eliminated} eliminated</p>
        <p>{data.finalized?'Final results saved.':`${pool.completedPairs??0} of ${pool.totalPairs??pool.teams.length*(pool.teams.length-1)/2} pairings completed. Qualification is confirmed when tiebreakers end.`}</p>
        {!data.finalized&&pool.needsOrder&&!pool.problems?.length&&<p>Equal results remain at a qualification cutoff. The final order needs admin confirmation.</p>}
        <TieBreakerTable key={pool.id} teams={pool.teams} leagueId={leagueId} recordedMatches={pool.headToHead??null}/>
        {data.finalized&&<QualifierTables upper={pool.teams.filter(team=>team.Qualification==='upper')}
          lower={pool.teams.filter(team=>team.Qualification==='lower')} eliminated={pool.teams.filter(team=>team.Qualification==='eliminated')}/>}
      </section>
      <details className="tiebreaker-all-qualifiers"><summary>{data.finalized?'All final league qualifiers':'Direct qualifiers from groups'}</summary>
        <QualifierTables upper={data.upperBracketTeams} lower={data.lowerBracketTeams} eliminated={data.eliminatedTeams}/>
      </details>
    </>:<>
      <TieBreakerTable teams={data.tiebreakerTeams||[]} leagueId={leagueId}/>
      <QualifierTables upper={data.upperBracketTeams} lower={data.lowerBracketTeams} eliminated={data.eliminatedTeams}/>
    </>)}
  </div>;
}
