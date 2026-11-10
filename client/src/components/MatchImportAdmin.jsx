import {useEffect,useState} from 'react';

async function request(path,method='GET',body) {
  const response=await fetch('/api/admin/matches/imports'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to update match imports');return data;
}
const when=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'short',timeStyle:'short'}):'—';
function Settings({settings,busy,run}) {
  const [enabled,setEnabled]=useState(Boolean(settings.Enabled)),[playoff,setPlayoff]=useState(settings.PlayoffBestOf),[final,setFinal]=useState(settings.GrandFinalBestOf||'');
  return <form className="match-scheduling-form" onSubmit={event=>{event.preventDefault();run('/settings','PUT',{enabled,playoffBestOf:Number(playoff),grandFinalBestOf:final?Number(final):null,revision:settings.Revision});}}>
    <label>Automatic result imports<select value={enabled?'on':'off'} onChange={event=>setEnabled(event.target.value==='on')}><option value="off">Off · nightly recovery only</option><option value="on">On · retrieve finished live games</option></select></label>
    <label>Playoff default<select value={playoff} onChange={event=>setPlayoff(event.target.value)}>{[3,5].map(n=><option key={n} value={n}>BO{n}</option>)}</select></label>
    <label>Grand final default<select value={final} onChange={event=>setFinal(event.target.value)}><option value="">Require an explicit format</option>{[3,5].map(n=><option key={n} value={n}>BO{n}</option>)}</select></label>
    <button disabled={busy}>Save import settings</button>
  </form>;
}
export default function MatchImportAdmin({seasonId,refreshKey}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
  const [matchId,setMatchId]=useState(''),[formats,setFormats]=useState({});
  useEffect(()=>{
    let disposed=false;
    const load=()=>request('').then(value=>{if(!disposed)setData(value);}).catch(cause=>{if(!disposed)setError(cause.message);});
    load();const timer=setInterval(()=>{if(!document.hidden)load();},15000);
    window.addEventListener('league-results:changed',load);
    return()=>{disposed=true;clearInterval(timer);window.removeEventListener('league-results:changed',load);};
  },[attempt,refreshKey]);
  async function run(path,method,body) {
    setBusy(true);setError('');setMessage('');
    try{await request(path,method,body);setAttempt(n=>n+1);setMessage('Match import update saved.');}
    catch(cause){setError(cause.message);}finally{setBusy(false);}
  }
  const jobs=data?.jobs||[];
  return <section className="ui-panel match-scheduling-card"><h3>Automatic match results</h3>
    <p className="match-scheduling-help">Finished live games are retrieved in the background. Results update standings and series; replay details can finish later. Groups use BO2, tiebreakers use their pool rules, and fixture formats take priority. Defaults apply to new series.</p>
    {error&&<p role="alert" className="match-scheduling-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {data?<><Settings key={data.settings.Revision} settings={data.settings} busy={busy} run={run}/>
      <p className="match-scheduling-help">Worker last checked: {when(data.worker.LastTickAt)} NY · OpenDota: {data.budget.monthRequests.toLocaleString()} / {data.budget.monthlyLimit.toLocaleString()} requests this month · {data.budget.minuteLimit}/minute shared budget.</p>
      {data.worker.LastError&&<p role="status" className="match-scheduling-error">{data.worker.LastError}</p>}
      {data.budget.PauseUntil>Date.now()&&<p role="status">OpenDota requests paused until {when(data.budget.PauseUntil)} NY: {data.budget.Reason}</p>}
      <form className="held-match-draft-actions" onSubmit={event=>{event.preventDefault();run('','POST',{seasonId:Number(seasonId),matchId:Number(matchId)});}}>
        <label>Import or recheck a match<input inputMode="numeric" pattern="[0-9]+" required value={matchId} placeholder="Match ID" onChange={event=>setMatchId(event.target.value)}/></label><button disabled={busy}>Queue import</button>
      </form>
      {!jobs.length?<p className="match-scheduling-help">No match imports awaiting results, replay details or review.</p>:<div className="match-scheduling-events"><table className="match-scheduling-table"><thead><tr><th>Match</th><th>Result / Parse</th><th>Next retry (NY)</th><th>Details</th><th/></tr></thead><tbody>
        {jobs.map(job=><tr key={job.MatchId}><td>{job.ResultStatus==='imported'?<a href={`/match/${job.MatchId}`}>{job.MatchId}</a>:job.MatchId}{job.SeriesId&&<small> · Series {job.SeriesId}</small>}</td>
          <td>{job.ResultStatus.replaceAll('_',' ')} / {job.EnrichmentStatus}</td><td>{when(job.NextAttemptAt)}</td><td>{job.LastError|| (job.SeriesStatus==='needs_format'?'Confirm the series format.':'Waiting for OpenDota data.')}
          {job.SeriesId&&['needs_format','needs_review'].includes(job.SeriesStatus)&&<form className="held-match-draft-actions" onSubmit={event=>{event.preventDefault();run(`/series/${job.SeriesId}/format`,'PUT',{bestOf:Number(formats[job.SeriesId])});}}>
            <label>Series format<select required value={formats[job.SeriesId]||''} onChange={event=>setFormats(old=>({...old,[job.SeriesId]:event.target.value}))}><option value="">Choose format</option>{(job.Stage==='g'?[2]:job.Stage==='t'?[1,3]:[3,5]).map(n=><option key={n} value={n}>BO{n}</option>)}</select></label><button disabled={busy}>Set format</button>
          </form>}</td><td><button type="button" disabled={busy||job.ResultStatus==='live'} onClick={()=>run(`/${job.MatchId}/retry`,'POST',{})}>Retry</button></td></tr>)}
      </tbody></table></div>}
    </>:<p>Loading match imports…</p>}
  </section>;
}
