import {useEffect,useState} from 'react';
import HeroDisplay from './HeroDisplay';

const date=value=>new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'short',timeStyle:'short'});

export default function HeldMatchDrafts({seasonId,refreshKey}){
  const [result,setResult]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [selected,setSelected]=useState({}),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
  const [importId,setImportId]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setError('');setResult(null);setSelected({});
    fetch(`/api/admin/matches/held-drafts?seasonId=${seasonId}`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load held drafts');return data;})
      .then(data=>{if(!controller.signal.aborted)setResult(data);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});
    return ()=>controller.abort();
  },[seasonId,refreshKey,attempt]);
  async function importDraft(event){
    event.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/admin/matches/held-drafts/import',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({seasonId:Number(seasonId),sourceMatchId:Number(importId)})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Could not import draft');
      setImportId('');setMessage(data.held?`Draft #${data.sourceMatchId} is held for review.`:`Draft #${data.sourceMatchId} automatically linked to match #${data.matchId}.`);
      setAttempt(value=>value+1);
    }catch(cause){setError(cause.message);}finally{setBusy(false);}
  }
  async function act(sourceId,method){
    if(busy)return;
    if(method==='DELETE'&&!window.confirm(`Delete held draft #${sourceId}? It will not be matched or reimported automatically.`))return;
    setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch(`/api/admin/matches/held-drafts/${sourceId}${method==='POST'?'/link':''}`,{
        method,headers:{'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({matchId:Number(selected[sourceId])})}:{})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Could not update held draft');
      setResult(current=>current?{...current,drafts:current.drafts.filter(draft=>draft.sourceMatchId!==sourceId)}:current);
      setMessage(method==='POST'?`Draft #${sourceId} linked to match #${data.matchId}.`:`Held draft #${sourceId} deleted.`);
    }catch(cause){setError(cause.message);}finally{setBusy(false);}
  }
  return <section className="ui-panel match-scheduling-card held-match-drafts">
    <div className="match-scheduling-heading"><h3>Held drafts{result?` (${result.drafts.length})`:''}</h3>
      <button type="button" disabled={busy} onClick={()=>setAttempt(value=>value+1)}>Refresh drafts</button></div>
    <p className="match-scheduling-help">Draft-only remakes are excluded from results. Matching teams and picked heroes link automatically when there is one clear match within two hours; other drafts stay here for review.</p>
    <form className="held-match-draft-actions" onSubmit={importDraft}>
      <label>Import an older draft-only match<input type="text" inputMode="numeric" pattern="[0-9]+" required value={importId} disabled={busy}
        placeholder="Draft match ID" onChange={event=>setImportId(event.target.value)}/></label>
      <button type="submit" disabled={busy||!importId.trim()}>{busy?'Working…':'Import draft'}</button>
    </form>
    {error&&<p className="match-scheduling-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!result&&!error&&<p>Loading held drafts…</p>}
    {result?.drafts.length===0&&<p className="match-scheduling-help">No held drafts for this season.</p>}
    {result?.drafts.map(draft=><article className="held-match-draft" key={draft.sourceMatchId}>
      <header><strong>{draft.teamRadName} vs {draft.teamDireName}</strong>
        <a href={`https://www.dotabuff.com/matches/${draft.sourceMatchId}`} target="_blank" rel="noopener noreferrer">Draft #{draft.sourceMatchId}</a></header>
      <p className="match-scheduling-help">{date(draft.startedAt)} NY · {draft.draft.filter(row=>!row.is_pick).length} bans</p>
      <div className="held-match-draft-picks">{[0,1].map(team=><div key={team}><span>{team===0?draft.teamRadName:draft.teamDireName}</span>
        <div>{draft.draft.filter(row=>row.is_pick&&row.team===team).map(row=><HeroDisplay key={row.hero_id} heroId={row.hero_id} showName={false} link={false} iconSize={28}/>)}</div></div>)}</div>
      <div className="held-match-draft-actions">
        <label>Played game without draft data<select disabled={busy} value={selected[draft.sourceMatchId]||''}
          onChange={event=>setSelected(current=>({...current,[draft.sourceMatchId]:event.target.value}))}>
          <option value="">Choose a game</option>{draft.candidates.map(game=><option key={game.matchId} value={game.matchId}>#{game.matchId} · {date(game.startedAt)} NY</option>)}
        </select></label>
        <button type="button" disabled={busy||!selected[draft.sourceMatchId]} onClick={()=>act(draft.sourceMatchId,'POST')}>Link draft</button>
        <button type="button" disabled={busy} onClick={()=>act(draft.sourceMatchId,'DELETE')}>Delete draft</button>
      </div>
      {!draft.candidates.length&&<p className="match-scheduling-help">No compatible imported game is missing draft data. The teams and picked heroes must match.</p>}
    </article>)}
  </section>;
}
