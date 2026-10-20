import {useCallback,useEffect,useRef,useState} from 'react';
import {classifyStandings,normalizeLeagueRules,normalizeQualificationPlan} from '../../../config/leagueRules.js';
import './GroupQualificationEditor.css';

const choices=[['upper','Upper bracket'],['lower','Lower bracket'],['eliminated','Eliminated']];
const rowKind=destination=>destination.startsWith('tie:')?'tiebreaker':destination;
function draftRules(saved,groups) {
  const rules=normalizeLeagueRules(saved||{}),plan=rules.QualificationPlan;
  if(plan) {
    // One position template is shared by all groups, including uneven groups.
    const rows=Array.from({length:Math.max(0,...groups.map(group=>group.teams.length))},(_,rank)=>
      plan.groups.find(group=>group.rows[rank])?.rows[rank]||'eliminated');
    return {version:1,groups:groups.map((group,index)=>({group:index+1,rows:rows.slice(0,group.teams.length)})),tiebreakers:plan.tiebreakers};
  }
  const rows=groups.map((group,index)=>({group:index+1,rows:classifyStandings(group.teams,rules)
    .map(team=>team.Qualification==='tiebreaker'?'tie:existing':team.Qualification)}));
  const existing=rows.reduce((sum,group)=>sum+group.rows.filter(row=>row==='tie:existing').length,0);
  return {version:1,groups:rows,tiebreakers:existing?[{id:'existing',name:'Existing tiebreaker',bestOf:1,upper:0,lower:0,eliminated:0}]:[]};
}

export default function GroupQualificationEditor({leagueId,groups,onSaved}) {
  const [plan,setPlan]=useState(null),[revision,setRevision]=useState(null),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  const groupsRef=useRef(groups);groupsRef.current=groups;
  const load=useCallback(async(signal)=>{
    try {
      const response=await fetch('/api/admin/leagueRules',{signal,cache:'no-store'}),data=await response.json();
      if(!response.ok)throw Error(data.error||'Could not load rules');
      if(data.league?.LeagueId!==leagueId)throw Error('The active league changed. Reload group setup.');
      if(!signal?.aborted){setPlan(draftRules(data.rules,groupsRef.current));setRevision(data.revision);setError('');}
    }catch(error){if(!signal?.aborted)setError(error.message);}
  },[leagueId]);
  useEffect(()=>{const controller=new AbortController();setPlan(null);setRevision(null);load(controller.signal);return()=>controller.abort();},[load]);
  const participants=id=>plan?.groups.reduce((sum,group)=>sum+group.rows.filter(row=>row===`tie:${id}`).length,0)||0;
  let problem='';
  if(plan)try{normalizeQualificationPlan(plan,groups.map(group=>group.teams.length));}catch(error){problem=error.message;}
  const direct=Object.fromEntries(choices.map(([key])=>[key,plan?.groups.reduce((sum,group)=>sum+group.rows.filter(row=>row===key).length,0)||0]));
  const fromPools=Object.fromEntries(choices.map(([key])=>[key,plan?.tiebreakers.reduce((sum,pool)=>sum+(Number(pool[key])||0),0)||0]));
  const sharedRows=Array.from({length:Math.max(0,...(plan?.groups.map(group=>group.rows.length)||[]))},(_,rank)=>
    plan.groups.find(group=>group.rows[rank])?.rows[rank]);
  const tiebreakerTeams=plan?.groups.reduce((sum,group)=>sum+group.rows.filter(row=>row.startsWith('tie:')).length,0)||0;
  function assign(rank,destination) {
    setPlan(current=>({...current,groups:current.groups.map(group=>
      ({...group,rows:group.rows.map((row,i)=>i===rank?destination:row)}))}));setMessage('');
  }
  function updatePool(id,patch) {
    setPlan(current=>({...current,tiebreakers:current.tiebreakers.map(pool=>pool.id===id?{...pool,...patch}:pool)}));setMessage('');
  }
  async function save() {
    setBusy(true);setError('');setMessage('');
    try {
      const response=await fetch('/api/admin/leagueRules',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({leagueId,revision,QualificationPlan:plan})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Could not save rules');
      setPlan(draftRules(data.rules,groups));setRevision(data.revision);
      setMessage(data.bettingSetupUpdated?'Rules saved. Betting prices are refreshing.':'Rules saved. Finalize betting setup to apply these rules to odds.');
      onSaved?.();
    }catch(error){setError(error.message);}finally{setBusy(false);}
  }
  return <section className="group-rule-editor" aria-label="Group qualification rules">
    <h3>Group qualification rules</h3>
    <p>Set each finishing position once for all groups. Positions sent to the same named tiebreaker form one pool across groups.</p>
    {error&&<p className="league-setup-error" role="alert">{error} <button type="button" disabled={busy} onClick={()=>load()}>Retry</button></p>}
    {!plan?<p role="status">Loading rules…</p>:<>
      <div className="group-rule-layout">
        <section className="group-rule-positions">
        <h4>Finishing positions · all groups</h4>
        <div className="group-rule-legend" aria-label="Position colors">
          {[...choices.slice(0,2),['tiebreaker','Tiebreaker'],choices[2]].map(([key,label])=><span key={key} className={`group-rule-badge group-rule-row-${key}`}>{label}</span>)}
        </div>
        <div className="group-rule-table"><table><thead><tr><th>Position</th><th>Destination</th></tr></thead><tbody>
          {sharedRows.map((destination,rank)=><tr key={rank} className={`group-rule-row-${rowKind(destination)}`}>
            <th scope="row">#{rank+1}</th><td><select aria-label={`Position ${rank+1} destination for all groups`}
              disabled={busy} value={destination} onChange={event=>assign(rank,event.target.value)}>
              {choices.map(([key,label])=><option key={key} value={key}>{label}</option>)}
              {plan.tiebreakers.map(pool=><option key={pool.id} value={`tie:${pool.id}`}>{pool.name||'Unnamed tiebreaker'}</option>)}
            </select></td></tr>)}
        </tbody></table></div>
        <small>Applies to {groups.length} {groups.length===1?'group':'groups'} · {groups.reduce((sum,group)=>sum+group.teams.length,0)} teams total.
          {new Set(groups.map(group=>group.teams.length)).size>1&&' Smaller groups only use the positions they have.'}</small>
        </section>
        <aside className="group-rule-summary" aria-label="Qualification summary" aria-live="polite">
          <h4>{problem?'Draft qualification totals':'After tiebreakers'}</h4>
          <p>Total teams across all groups, including the results of each tiebreaker.</p>
          <dl>{choices.map(([key,label])=><div key={key} className={`group-rule-summary-item group-rule-row-${key}`}>
            <dt>{label}</dt><dd><strong>{direct[key]+fromPools[key]}</strong><small>{direct[key]} direct + {fromPools[key]} from tiebreakers</small></dd>
          </div>)}</dl>
          <div className="group-rule-summary-pools group-rule-row-tiebreaker"><strong>{tiebreakerTeams} teams enter tiebreakers</strong>
            <small>Combined across groups in {plan.tiebreakers.length} {plan.tiebreakers.length===1?'pool':'pools'}.</small></div>
          {plan.tiebreakers.map(pool=><p key={pool.id}><strong>{pool.name||'Unnamed tiebreaker'}:</strong> {participants(pool.id)} teams compete for {Number(pool.upper)||0} upper bracket and {Number(pool.lower)||0} lower bracket places; {Number(pool.eliminated)||0} eliminated.</p>)}
          {problem&&<p className="league-setup-hint">Finish assigning positions and pool outcomes to confirm these totals.</p>}
        </aside>
      </div>
      <div className="group-rule-pools-heading"><h4>Tiebreaker pools</h4><button type="button" disabled={busy} onClick={()=>{
        const id=crypto.randomUUID();setPlan(current=>({...current,tiebreakers:[...current.tiebreakers,
          {id,name:`Tiebreaker ${current.tiebreakers.length+1}`,bestOf:1,upper:0,lower:0,eliminated:0}]}));
      }}>Add tiebreaker</button></div>
      {!plan.tiebreakers.length&&<p>Add a pool to make it available for any finishing position.</p>}
      <div className="group-rule-pools">{plan.tiebreakers.map(pool=><section key={pool.id}>
        <div className="group-rule-pool-fields"><label>Pool name<input maxLength={60} value={pool.name} disabled={busy} onChange={event=>updatePool(pool.id,{name:event.target.value})}/></label>
          <label>Format<select value={pool.bestOf} disabled={busy} onChange={event=>updatePool(pool.id,{bestOf:Number(event.target.value)})}>
            <option value={1}>BO1 round robin</option><option value={3}>BO3 round robin</option></select></label>
          {choices.map(([key,label])=><label key={key}>{label}<input type="number" min={0} max={participants(pool.id)} step={1} value={pool[key]}
            disabled={busy} onChange={event=>updatePool(pool.id,{[key]:event.target.value})}/></label>)}
        </div>
        <p><strong>{participants(pool.id)} teams enter.</strong> Top {pool.upper||0} → upper bracket; next {pool.lower||0} → lower bracket; remaining {pool.eliminated||0} → eliminated.</p>
        <small>{plan.groups.flatMap((group,index)=>group.rows.flatMap((row,rank)=>row===`tie:${pool.id}`?[`${groups[index]?.GroupName||`Group ${group.group}`} #${rank+1}`]:[])).join(' · ')||'No positions assigned yet'}</small>
        <button type="button" disabled={busy||participants(pool.id)>0} title={participants(pool.id)?'Assign these positions elsewhere before removing the pool':undefined}
          onClick={()=>setPlan(current=>({...current,tiebreakers:current.tiebreakers.filter(p=>p.id!==pool.id)}))}>Remove pool</button>
      </section>)}</div>
      {problem&&<p className="league-setup-hint" role="status">{problem}</p>}
      <div className="league-setup-actions"><button type="button" className="ui-button-primary" disabled={busy||!!problem} onClick={save}>{busy?'Saving…':'Save rules'}</button>
        <button type="button" disabled={busy} onClick={()=>{setMessage('');load();}}>Reload saved rules</button></div>
      {message&&<p className="league-setup-message" role="status">{message}</p>}
    </>}
  </section>;
}
