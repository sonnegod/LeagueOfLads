import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {generatePlayoffBracket,playoffMatches,playoffLabels,playoffFormat,playoffHasResult,playoffResult,resolvePlayoffProgression,suggestPlayoffSeeding} from '../../../shared/playoffBracket.js';
import PlayoffBracketBoard from './PlayoffBracketBoard';

async function request(path,options={}) {
  const response=await fetch(path,{cache:'no-store',...options});const data=await response.json();
  if(!response.ok)throw Error(data.error||'Unable to load or save playoffs.');return data;
}
const sourceLabel=team=>team?`${team.GroupName||'Group'}${team.GroupRank?` · #${team.GroupRank}`:''}${team.TiebreakerName?` · ${team.TiebreakerName}${team.TiebreakerRank?` #${team.TiebreakerRank}`:''}`:''}`:'';

function MatchEditor({match,detail={},label,onApply,onClose}) {
  const [a,setA]=useState(String(detail.team1Score??match.team1Score??0)),[b,setB]=useState(String(detail.team2Score??match.team2Score??0));
  const [bestOf,setBestOf]=useState(String(detail.bestOf||playoffFormat(match)||'')),[error,setError]=useState('');
  const panel=useRef(null),linked=Boolean(detail.seriesId||match.seriesId);
  useEffect(()=>{panel.current?.querySelector('input:not([disabled]),select:not([disabled]),button')?.focus();},[]);
  function apply(event) {
    event.preventDefault();const changes={bestOf:Number(bestOf)};
    if(!linked)Object.assign(changes,{team1Score:Number(a),team2Score:Number(b),resultSource:'manual'});
    if(![3,5].includes(changes.bestOf))return setError('Choose the grand-final format.');
    const result=playoffResult({...match,...changes});if(!result.valid)return setError(`Enter a valid BO${changes.bestOf} score.`);
    const problem=onApply(match.id,changes);if(problem)setError(problem);
  }
  return <aside className="playoff-editor-panel" ref={panel} aria-label={`Edit ${label}`} onKeyDown={event=>{if(event.key==='Escape')onClose();}}>
    <div className="playoff-panel-heading"><h3>{label}</h3><button type="button" aria-label="Close match editor" onClick={onClose}>Close</button></div>
    <form onSubmit={apply}>
      <label>Series format{match.bracket==='grand'?<select value={bestOf} disabled={linked&&Boolean(detail.bestOf)} onChange={event=>setBestOf(event.target.value)}>
        <option value="">Choose format</option><option value="3">BO3</option><option value="5">BO5</option></select>:<strong>BO3 · First to 2 wins</strong>}</label>
      <div className="playoff-edit-scores">{[[1,a,setA],[2,b,setB]].map(([slot,value,setValue])=><label key={slot}><span title={match[`team${slot}Name`]||'Awaiting team'}>{match[`team${slot}Name`]||'Awaiting team'}</span>
        <input aria-label={`Team ${slot} score`} type="number" min="0" max={bestOf==='5'?3:2} step="1" required value={value} disabled={linked||!match.team1Id||!match.team2Id} onChange={event=>setValue(event.target.value)}/></label>)}</div>
      {linked?<p>Scores come from the recorded series. Correct its games in the match editor when needed.</p>:<p>A score lead stays in progress. Teams advance after 2 wins in BO3 or 3 wins in BO5.</p>}
      {detail.kickoff&&<p>Scheduled: {new Date(detail.kickoff).toLocaleString('en-US',{timeZone:'America/New_York'})} NY. Edit scheduling under League → Match.</p>}
      {detail.seriesId&&<Link to={`/series/${detail.seriesId}`}>View recorded series</Link>}
      {error&&<p role="alert" className="playoff-error">{error}</p>}
      <button type="submit" className="ui-button-primary" disabled={linked&&Boolean(detail.bestOf)}>Apply changes</button>
    </form>
  </aside>;
}

export default function PlayoffBracketEditor() {
  const [data,setData]=useState(null),[bracket,setBracket]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [saving,setSaving]=useState(false),[attempt,setAttempt]=useState(0),[selectedId,setSelectedId]=useState(null),[newResults,setNewResults]=useState(false);
  const editing=useRef(false),generation=useRef(0);
  const dirty=Boolean(bracket)&&JSON.stringify(bracket)!==JSON.stringify(data?.playoffBracket);
  useEffect(()=>{editing.current=dirty||Boolean(selectedId);},[dirty,selectedId]);
  useEffect(()=>{
    let disposed=false,controller;
    async function load(force=false) {
      controller?.abort();controller=new AbortController();
      const requestGeneration=++generation.current;
      try {
        const value=await request('/api/admin/playoffBracket',{signal:controller.signal});if(disposed||requestGeneration!==generation.current)return;
        if(!force&&editing.current){setNewResults(true);return;}
        let initial=value.playoffBracket;
        if(!initial&&value.result?.length) {
          initial=generatePlayoffBracket(value.result);
          initial.grandFinals.forEach(match=>{match.bestOf=value.grandFinalDefault||5;});
        }
        setData(value);setBracket(initial);setError('');setNewResults(false);setSelectedId(null);
      }catch(cause){if(!disposed&&cause.name!=='AbortError')setError(cause.message);}
    }
    function changed(){if(editing.current)setNewResults(true);else load();}
    load(true);window.addEventListener('league-results:changed',changed);
    return()=>{disposed=true;controller?.abort();window.removeEventListener('league-results:changed',changed);};
  },[attempt]);
  const teams=data?.result||[],matches=playoffMatches(bracket),labels=playoffLabels(bracket);
  const started=matches.some(match=>playoffHasResult(match)||data?.matchDetails?.[match.id]?.seriesId);
  const selected=matches.find(match=>match.id===selectedId);
  function apply(matchId,changes) {
    const next=structuredClone(bracket),match=playoffMatches(next).find(item=>item.id===matchId);Object.assign(match,changes);
    const resolved=resolvePlayoffProgression(next);if(resolved.errors.length)return resolved.errors[0];
    setBracket(resolved.bracket);setSelectedId(null);setError('');setMessage('');return null;
  }
  function assign(matchId,slot,value) {
    const next=structuredClone(bracket),match=playoffMatches(next).find(item=>item.id===matchId),old=match[`team${slot}Id`],id=Number(value)||null;
    const first=[...next.upperBracket[0].matches,...next.lowerBracket[0].matches];
    const put=(target,position,teamId)=>{const team=teams.find(item=>item.TeamId===teamId);target[`team${position}Id`]=teamId;
      target[`team${position}Name`]=team?.TeamName||null;target[`team${position}Seed`]=team?.Seed||null;};
    if(id)for(const target of first)for(const position of [1,2])if((target.id!==matchId||position!==slot)&&Number(target[`team${position}Id`])===id)put(target,position,old);
    put(match,slot,id);const resolved=resolvePlayoffProgression(next);
    if(resolved.errors.length)return setError(resolved.errors[0]);setBracket(resolved.bracket);setMessage('');
  }
  async function save() {
    generation.current++;setSaving(true);setError('');setMessage('');
    try {
      const value=await request('/api/admin/saveBracket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bracketData:bracket,revision:data.revision})});
      setData(value);setBracket(value.playoffBracket);setNewResults(false);setSelectedId(null);setMessage('Playoff bracket saved.');
    }catch(cause){setError(cause.message);}finally{setSaving(false);}
  }
  const slots=matches.filter(match=>match.round===1&&['upper','lower'].includes(match.bracket));
  const assigned=slots.reduce((sum,match)=>sum+Number(Boolean(match.team1Id))+Number(Boolean(match.team2Id)),0);
  const ready=Boolean(bracket)&&assigned===teams.length&&teams.length>0&&bracket.grandFinals.every(match=>[3,5].includes(playoffFormat(match)));
  return <div className="playoff-bracket-editor">
    <div className="playoff-editor-toolbar"><div><button type="button" className="ui-button-primary" disabled={saving||!dirty||!ready||Boolean(selected)} onClick={save}>{saving?'Saving…':data?.playoffBracket?'Save bracket':'Publish bracket'}</button>
      <button type="button" disabled={saving} onClick={()=>{setMessage('');setAttempt(n=>n+1);}}>Reload latest bracket</button></div>
      <small>{selected?'Apply or close the match editor before saving.':dirty?'Unsaved changes':'All changes saved'}</small></div>
    {error&&<p role="alert" className="playoff-error">{error}</p>}{message&&<p role="status" className="playoff-message">{message}</p>}
    {newResults&&<p role="status" className="playoff-notice">New results are available. Your edits are kept; reload the latest bracket before saving if it has changed.</p>}
    {!data&&!error&&<p role="status">Loading playoff teams…</p>}
    {data&&!bracket&&<p className="playoff-empty">Qualified teams will appear here after group and tiebreaker results are finalized.</p>}
    {bracket&&<>
      <details className="playoff-starting-teams" open={!data.playoffBracket}>
        <summary>Starting teams <span>{assigned} / {teams.length} assigned{started?' · Seeding locked':''}</span></summary>
        <div className="playoff-setup-content"><div className="playoff-panel-heading"><p>{started?'Seeding is fixed because playoff play has begun.':"Suggest matchups from the saved seed order, then select teams to swap starting slots."}</p>
          <button type="button" disabled={started||saving} onClick={()=>{setBracket(suggestPlayoffSeeding(bracket,teams));setMessage('Suggested matchups filled. Review them before publishing.');}}>Suggest matchups</button></div>
          <div className="playoff-pools">{[['upper','Upper bracket'],['lower','Lower bracket']].map(([pool,title])=><section key={pool} className={`playoff-pool ${pool}`}><h4>{title} · {teams.filter(team=>team.Bracket===pool).length} teams</h4>
            {slots.filter(match=>match.bracket===pool).flatMap(match=>[1,2].map(slot=>{
              const team=teams.find(item=>item.TeamId===Number(match[`team${slot}Id`]));
              return <label className="playoff-starting-slot" key={`${match.id}:${slot}`}><span>{labels.get(match.id)} · {slot}</span>
                <select aria-label={`${labels.get(match.id)} team ${slot}`} value={match[`team${slot}Id`]||''} disabled={started||saving} onChange={event=>assign(match.id,slot,event.target.value)}>
                  <option value="">Select team</option>{teams.filter(item=>item.Bracket===pool).map(item=><option key={item.TeamId} value={item.TeamId}>#{item.Seed} · {String(item.TeamName)}</option>)}</select>
                {team&&<small>{sourceLabel(team)}</small>}</label>;
            }))}</section>)}</div>
        </div>
      </details>
      <div className={`playoff-editor-layout${selected?' has-selection':''}`}>
        {selected&&<MatchEditor key={selected.id} match={selected} detail={data.matchDetails?.[selected.id]} label={labels.get(selected.id)} onApply={apply} onClose={()=>setSelectedId(null)}/>}
        <PlayoffBracketBoard bracket={bracket} matchDetails={data.matchDetails} onSelect={saving?undefined:setSelectedId} selectedId={selectedId}/>
      </div>
    </>}
  </div>;
}
