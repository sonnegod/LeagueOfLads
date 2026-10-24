import {useEffect,useState} from 'react';
import './MatchSchedulingPanel.css';

const blank={eventId:null,revision:null,team1Key:'',team2Key:'',stage:'regular',bestOf:2,localTime:'',utcTime:'',status:'scheduled',seriesId:''};
async function request(url,body,method='POST'){const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data;}
const date=value=>new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'short',timeStyle:'short'});
function localInput(value) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function parserTime(value){const [day,time]=value.split('T');const [hour,minute]=time.split(':');const h=Number(hour);return `${day} ${h%12||12}:${minute} ${h>=12?'PM':'AM'} EST`;}

export default function MatchSchedulingPanel({seasonId,refreshKey}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[selectedSeason,setSelectedSeason]=useState('');
  const [fixture,setFixture]=useState(blank),[role,setRole]=useState(''),[aliasTeam,setAliasTeam]=useState(''),[resolveEvent,setResolveEvent]=useState({});
  const requestedSeason=selectedSeason||seasonId;
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/admin/matches/status'+(requestedSeason?'?seasonId='+requestedSeason:''),{signal:controller.signal})
      .then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to load match scheduling');return payload;})
      .then(payload=>{if(!controller.signal.aborted)setData(payload);})
      .catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return()=>controller.abort();
  },[refresh,refreshKey,requestedSeason]);
  async function run(action,text){setBusy(true);setError('');setMessage('');try{await action();setMessage(text);setRefresh(r=>r+1);return true;}catch(err){setError(err.message);return false;}finally{setBusy(false);}}
  function edit(event){setFixture({eventId:event.EventId,revision:event.Revision,team1Key:String(event.Team1Key),team2Key:String(event.Team2Key),stage:event.Stage,
    bestOf:event.BestOf,localTime:localInput(event.ScheduledStartUtc),utcTime:'',status:event.Status==='replaced'?'needs_review':event.Status,seriesId:event.SeriesId||''});}
  const sid=data?.season?.seasonId;
  return <section className="match-scheduling-panel">
    <div className="match-scheduling-heading"><h2>Match scheduling</h2><button type="button" disabled={busy} onClick={()=>{setError('');setRefresh(r=>r+1);}}>Refresh view</button></div>
    <p className="match-scheduling-help">Record upcoming series and kickoff times, and review Discord scheduling posts for the selected season.</p>
    {data?.localTesting&&<p className="match-scheduling-test-notice">Local test fixtures are included.</p>}
    {data?.seasons&&<label>Season <select disabled={busy} value={selectedSeason||data.season?.seasonId||''} onChange={e=>{
      setSelectedSeason(e.target.value);setData(null);setFixture(blank);setRole('');setAliasTeam('');setResolveEvent({});setError('');setMessage('');
    }}>{data.seasons.map(s=><option key={s.seasonId} value={s.seasonId}>{s.name}</option>)}</select></label>}
    {error&&<p role="alert" className="match-scheduling-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {!data?(!error&&<p>Loading match scheduling…</p>):!sid?<p>Create a season to begin scheduling.</p>:<>
      {data.messages.length>0&&<section className="ui-panel match-scheduling-card"><h3>Scheduling posts needing review</h3><p className="match-scheduling-help">Review the saved post below, correct or create the fixture in the card below, then select it here and Resolve. Resolving links the post; it does not correct the fixture’s time or teams.</p>
        {data.messages.map(m=><article className="match-review-post" key={m.MessageId}>
          <p className="match-scheduling-help">{date(m.AuthoredAtUtc)} NY · {m.IssueCode?.replaceAll('_',' ')}{m.Deleted?' · Deleted post':''}{m.EditedAtUtc?` · Edited ${date(m.EditedAtUtc)} NY`:''}</p>
          <blockquote className="match-review-text">{m.DisplayContent||m.Content||'No saved text is available for this post.'}</blockquote>
          <form className="match-scheduling-form match-review-actions" onSubmit={e=>{e.preventDefault();run(()=>request(`/api/admin/matches/messages/${m.MessageId}/resolve`,{eventId:Number(resolveEvent[m.MessageId])}),'Scheduling post linked.');}}>
            <label>Fixture<select required value={resolveEvent[m.MessageId]||''} onChange={e=>setResolveEvent(old=>({...old,[m.MessageId]:e.target.value}))}><option value="">Select fixture</option>{data.events.filter(e=>!['cancelled','replaced','forfeit'].includes(e.Status)).map(e=><option key={e.EventId} value={e.EventId}>#{e.EventId} {e.Team1Name} vs {e.Team2Name}</option>)}</select></label><button disabled={busy}>Resolve</button>
          </form>
        </article>)}</section>}
      <section className="ui-panel match-scheduling-card"><h3>{fixture.eventId?`Edit fixture #${fixture.eventId}`:'Add a fixture'}</h3>
        <p className="match-scheduling-help">A fixture records an upcoming series between two teams. Set its kickoff time, stage and format, and update it here when plans change. Groups use BO2; playoffs and tiebreakers use BO3 or BO5.</p>
        <form className="match-scheduling-form" onSubmit={e=>{e.preventDefault();const body={...fixture,team1Key:Number(fixture.team1Key),team2Key:Number(fixture.team2Key),bestOf:Number(fixture.bestOf),
          ...(fixture.utcTime?{scheduledStartUtc:fixture.utcTime,timezone:'UTC'}:{localTime:parserTime(fixture.localTime)}),...(fixture.seriesId?{seriesId:Number(fixture.seriesId)}:{})};if(fixture.utcTime)delete body.localTime;if(!fixture.seriesId)delete body.seriesId;
          if(fixture.eventId&&!fixture.seriesId)body.seriesId=null;
          run(()=>request(`/api/admin/matches/seasons/${sid}/events`,body),'Fixture saved.').then(saved=>{if(saved)setFixture(blank);});}}>
          {['team1Key','team2Key'].map((key,i)=><label key={key}>Team {i+1}<select required value={fixture[key]} onChange={e=>setFixture(f=>({...f,[key]:e.target.value}))}><option value="">Select team</option>
            {data.teams.map(t=><option key={t.teamKey} value={t.teamKey}>{t.name}</option>)}</select></label>)}
          <label>Stage<select value={fixture.stage} onChange={e=>setFixture(f=>({...f,stage:e.target.value,bestOf:e.target.value==='regular'?2:3}))}><option value="regular">Groups</option><option value="tiebreaker">Tiebreakers</option><option value="playoff">Playoffs</option></select></label>
          <label>Format<select value={fixture.bestOf} onChange={e=>setFixture(f=>({...f,bestOf:Number(e.target.value)}))}>{(fixture.stage==='regular'?[2]:[3,5]).map(n=><option key={n} value={n}>BO{n}</option>)}</select></label>
          <label>Kickoff (New York time)<input required={!fixture.utcTime} type="datetime-local" value={fixture.localTime} onChange={e=>setFixture(f=>({...f,localTime:e.target.value}))} /></label>
          <label>Exact UTC kickoff (optional)<input placeholder="2026-11-01T06:00:00Z" value={fixture.utcTime} onChange={e=>setFixture(f=>({...f,utcTime:e.target.value}))} /><small>Use for an ambiguous daylight-saving time.</small></label>
          <label>Status<select value={fixture.status} onChange={e=>setFixture(f=>({...f,status:e.target.value}))}>{['scheduled','started','completed','needs_review','cancelled','forfeit'].map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}</select></label>
          <label>Played series ID<input type="number" min="1" disabled={!fixture.eventId} value={fixture.seriesId} onChange={e=>setFixture(f=>({...f,seriesId:e.target.value}))} /><small>Imported results are normally linked automatically. If matching is ambiguous or the series was played on a different date, enter the ID from its series page.</small></label>
          <button disabled={busy||data.season.status==='ended'&&!fixture.eventId}>Save fixture</button><button type="button" onClick={()=>setFixture(blank)}>Clear</button>
        </form><p className="match-scheduling-help">Reschedule by editing the existing fixture. Changing teams, stage or format creates a replacement fixture.</p>
        <div className="match-scheduling-events"><table className="match-scheduling-table"><thead><tr><th>Fixture</th><th>Teams</th><th>Kickoff (NY)</th><th>Stage / Format</th><th>Status</th><th>Series</th><th /></tr></thead><tbody>
          {data.events.map(e=><tr key={e.EventId}><td>#{e.EventId}{e.SourceMessageId?.startsWith('local-test:')&&<small> · Test fixture</small>}</td><td>{e.Team1Name} vs {e.Team2Name}</td><td>{date(e.ScheduledStartUtc)}</td><td>{e.Stage} / BO{e.BestOf}</td><td>{e.Status}</td>
            <td>{e.SeriesId?<a href={`/series/${e.SeriesId}`}>{e.SeriesId}</a>:'Unlinked'}</td><td><button type="button" disabled={['replaced','cancelled','forfeit'].includes(e.Status)} onClick={()=>edit(e)}>Edit</button></td></tr>)}</tbody></table></div>
      </section>
      <section className="ui-panel match-scheduling-card"><h3>Discord team roles</h3><p className="match-scheduling-help">Optional override: the bot normally matches a mentioned role’s name to the season’s team name, ignoring capitalization. Link a role ID here when its name differs; this mapping takes priority over name matching.</p><form className="match-scheduling-form" onSubmit={e=>{e.preventDefault();run(()=>request(`/api/admin/matches/seasons/${sid}/aliases`,{roleId:role,teamKey:Number(aliasTeam)},'PUT'),'Discord role linked.');}}>
        <label>Discord role ID<input required inputMode="numeric" value={role} onChange={e=>setRole(e.target.value)} /></label><label>Team<select required value={aliasTeam} onChange={e=>setAliasTeam(e.target.value)}><option value="">Select team</option>{data.teams.map(t=><option key={t.teamKey} value={t.teamKey}>{t.name}</option>)}</select></label><button disabled={busy}>Link role</button>
      </form>{data.aliases.map(a=><p key={a.RoleId}>{a.RoleId} → {data.teams.find(t=>t.teamKey===a.TeamSubmissionId)?.name}</p>)}</section>
    </>}
  </section>;
}
