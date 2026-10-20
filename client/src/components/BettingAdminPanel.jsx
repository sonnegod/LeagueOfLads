import { useEffect,useState } from 'react';
import '../css/BettingV2.css';

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
const issues={insufficient_temporal_samples:'More verified league history is needed to validate pricing.',baseline_validation_failed:'Pricing validation did not pass.',
  insufficient_historical_samples:'Stored history does not yet have enough eligible matches for retrospective validation.',
  historical_pricing_validation_failed:'Historical pricing did not pass validation. Check the validation report.',
  historical_source_changed:'Historical imports changed during pricing. Refresh Analytics and Betting again.',
  conflicting_roster_memberships:'Setup and Analytics are available; betting is held until each player belongs to one team in this season.',
  local_test_only:'Development test pricing is enabled; historical publication gates are bypassed only for this separate test Betting database.',
  league_source_not_ready:'Refresh the league sources before publishing new prices.',analytics_not_available:'Build Analytics for this season.',
  new_team_roster_prior_not_validated:'New-team pricing needs a validated roster model.',preseason_roster_prior_not_validated:'Preseason pricing needs a validated roster model.',
  champion_format_not_supported:'Champion futures are pending a supported group and bracket format.',roster_prior_missing:'A team needs complete signup or manual MMR inputs.'};

export default function BettingAdminPanel({refreshKey}) {
  const [data,setData]=useState(null);const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const [selectedSeason,setSelectedSeason]=useState('');
  const [refresh,setRefresh]=useState(0);const [fixture,setFixture]=useState(blank);const [games,setGames]=useState('');const [completion,setCompletion]=useState('normal');
  const [groupGames,setGroupGames]=useState(true);
  const [complete,setComplete]=useState(false);const [role,setRole]=useState('');const [aliasTeam,setAliasTeam]=useState('');const [resolveEvent,setResolveEvent]=useState({});
  const [outcomeTeam,setOutcomeTeam]=useState('');const [outcome,setOutcome]=useState('upper');
  const [legacy,setLegacy]=useState([]);const [legacyMarket,setLegacyMarket]=useState('');const [legacyOptions,setLegacyOptions]=useState([]);const [legacySeries,setLegacySeries]=useState('');
  const [classification,setClassification]=useState({matchId:'',status:'official',replacementMatchId:'',stageOverride:'',reason:''});
  useEffect(()=>{const controller=new AbortController();fetch(`/api/site-management/betting/status${selectedSeason?`?seasonId=${selectedSeason}`:''}`,{signal:controller.signal}).then(async response=>{const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||'Unable to load betting administration');return payload;}).then(payload=>{
      setData(payload);setGroupGames(!payload.setup||!!payload.setup.gamesByTeam);setGames(String(payload.setup?.gamesPerTeam||''));setCompletion(payload.setup?.completion||'normal');setComplete(payload.setup?.regularSeasonComplete||false);
    }).catch(err=>{if(err.name!=='AbortError')setError(err.message);});return()=>controller.abort();},[refresh,refreshKey,selectedSeason]);
  useEffect(()=>{const controller=new AbortController();fetch('/api/site-management/betting/legacy',{signal:controller.signal}).then(r=>r.json()).then(d=>setLegacy(d.markets||[]))
    .catch(()=>{});return()=>controller.abort();},[refresh,refreshKey]);
  async function run(action,text){setBusy(true);setError('');setMessage('');try{await action();setMessage(text);setRefresh(r=>r+1);return true;}catch(err){setError(err.message);return false;}finally{setBusy(false);}}
  function edit(event){setFixture({eventId:event.EventId,revision:event.Revision,team1Key:String(event.Team1Key),team2Key:String(event.Team2Key),stage:event.Stage,
    bestOf:event.BestOf,localTime:localInput(event.ScheduledStartUtc),utcTime:'',status:event.Status==='replaced'?'needs_review':event.Status,seriesId:event.SeriesId||''});}
  const sid=data?.season?.seasonId;
  return <section className="betting-admin-panel"><div className="sportsbook-heading"><h2>Betting and schedules</h2><button type="button" onClick={()=>setRefresh(r=>r+1)}>Refresh view</button></div>
    {data?.localTesting&&<p className="sportsbook-test-banner" role="status"><strong>Local test betting enabled.</strong> Wallets and tickets use the separate development test database. Login, stake limits, quote checks, roster/setup verification and kickoff locking remain active.</p>}
    <p className="admin-help">Manage scheduled series and betting for the selected season. Discord normally creates fixtures automatically; use these cards to finish setup, resolve scheduling issues and confirm results.</p>
    <details className="admin-help"><summary>What do the refresh buttons do?</summary>
      <ul>
        <li><strong>Refresh view</strong> reloads this page’s status and fixture list.</li>
        <li><strong>Refresh Analytics and Betting</strong> rebuilds summaries and highlights from imported data, then updates eligible odds and settles verified results. Admin changes and scheduled jobs normally trigger this automatically; use it to retry a failed refresh or reprocess a correction.</li>
        <li><strong>Rebuild preseason preview</strong> regenerates the separate preview after roster, group or rule changes. The normal Betting refresh does not rebuild this preview.</li>
        <li>The refresh runs in the background. Check Refresh view for completion. Missing imports or insufficient history can still keep markets on hold.</li>
        <li>Accepted bets keep their original odds. Verified results, refunds and corrections can update ticket payouts and point balances.</li>
      </ul>
      <p>New match data and Discord posts arrive through their scheduled import jobs; this button uses data already imported.</p>
    </details>
    {data?.season&&data.season.status!=='ended'&&<div className="season-actions">
      <a href={`/betting?previewSeason=${data.season.seasonId}`} target="_blank" rel="noopener noreferrer">Open preseason odds preview</a>
      <button type="button" disabled={busy||data.season.status==='signup_open'||data.season.status==='draft'}
        onClick={()=>run(()=>request(`/api/site-management/betting/seasons/${data.season.seasonId}/preview`,{}),'Preseason preview rebuilt. Reload an already-open preview tab to see the new prices.')}>Rebuild preseason preview</button>
    </div>}
    {data?.season?.leagueId&&data.season.status==='ended'&&<a href={`/betting?previewLeague=${data.season.leagueId}`} target="_blank" rel="noopener noreferrer">Open historical betting preview</a>}
    {data?.seasons&&<label>Season <select disabled={busy} value={selectedSeason||data.season?.seasonId||''} onChange={e=>{setSelectedSeason(e.target.value);setData(null);setFixture(blank);setError('');setMessage('');}}>
      {data.seasons.map(s=><option key={s.seasonId} value={s.seasonId}>{s.name}</option>)}</select></label>}
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {data?.rosterConflicts?.length>0&&['signup_closed','active'].includes(data.season?.status)&&<p className="sportsbook-notice" role="status">Players on multiple teams: {data.rosterConflicts.join(', ')}.
      {' '}Use Admin → League → Roster Changes to mark a duplicated placeholder as Player TBD with an estimated MMR, or confirm the real player. Unresolved duplicate memberships still hold season betting.</p>}
    {data?.pendingRosterSlots>0&&<p className="sportsbook-notice">{data.pendingRosterSlots} Player TBD {data.pendingRosterSlots===1?'slot':'slots'}. Team odds use provisional rosters. Player-leader markets remain held until every slot is confirmed.</p>}
    {!data?<p>Loading betting administration…</p>:!sid?<p>Create a season to begin scheduling.</p>:<>
      {data.legacyIssues?.length>0&&<p role="alert">Legacy tickets needing source-data repair: {data.legacyIssues.map(t=>`#${t.LegacyTicketId}`).join(', ')}. Their original records and balances are preserved.</p>}
      <section className="betting-admin-widget"><h3>Betting setup · {data.season.name}</h3><p className="admin-help">Use Finalize setup once rosters, groups and qualification rules are ready. Preseason betting opens when setup and pricing are ready. A scheduled fixture is optional; markets close at the first known regular-season kickoff or when play begins.</p>
        {data.setup&&<p>Finalized {date(data.setup.finalizedAt)} NY · Revision {data.setup.revision}</p>}
        {data.refresh?.pending&&<p role="status">Updated markets are pending.
          {data.refresh.nextRetryAt?` Retrying ${date(data.refresh.nextRetryAt)} NY.`:data.refresh.error==='refresh_retry_exhausted'?' Automatic retries failed. Use Refresh Analytics and Betting to retry.':data.refresh.error?' The last refresh failed.':' A refresh is queued or running.'}</p>}
        {data.refresh?.lastCompletedAt&&<p className="sportsbook-notice">Last completed refresh: {date(data.refresh.lastCompletedAt)} NY</p>}
        <form className="betting-admin-form" onSubmit={e=>{e.preventDefault();run(()=>request(`/api/site-management/betting/seasons/${sid}/setup`,{gamesPerTeam:groupGames?'group_round_robin':Number(games)}),'Betting setup finalized. A refresh is queued.');}}>
          <label className="betting-admin-check"><input type="checkbox" checked={groupGames} onChange={e=>setGroupGames(e.target.checked)} />Use BO2 group round robin</label>
          {!groupGames&&<label>Regular-season games per team<input required type="number" min="5" max="100" value={games} onChange={e=>setGames(e.target.value)} /></label>}
          {groupGames&&<p className="admin-help">Each team plays every other team in its group twice. Counts follow group size; for example, a four-team group gives each team six games.</p>}
          <button disabled={busy||data.season.status==='ended'}>Finalize setup</button>
          <button type="button" disabled={busy} onClick={()=>run(()=>request('/api/site-management/betting/refresh',{}),'Analytics and Betting refresh queued. Refresh this view to see the result.')}>Refresh Analytics and Betting</button>
        </form>
        <div className="betting-admin-jobs">{data.jobs.map(j=><p key={j.JobId}>{date(j.StartedAtUtc)} NY · {j.Status} · {j.MarketsOpened} markets opened · {j.MarketsSettled} settlements
          {j.IssueCode&&<span> · {j.IssueCode.split(',').map(code=>issues[code]||'A market is awaiting verified inputs.').join(' ')}</span>}</p>)}</div>
      </section>
      <section className="betting-admin-widget"><h3>{fixture.eventId?`Edit fixture #${fixture.eventId}`:'Add a fixture'}</h3>
        <p className="admin-help">A fixture is one scheduled series between two teams. Add one if Discord did not capture it, or edit an existing fixture to correct its time or link the played result. Kickoff closes betting. Use BO2 for groups, BO3 for playoffs and BO5 for the final. Tiebreakers are tracked separately and have no betting markets.</p>
        <form className="betting-admin-form" onSubmit={e=>{e.preventDefault();const body={...fixture,team1Key:Number(fixture.team1Key),team2Key:Number(fixture.team2Key),bestOf:Number(fixture.bestOf),
          ...(fixture.utcTime?{scheduledStartUtc:fixture.utcTime,timezone:'UTC'}:{localTime:parserTime(fixture.localTime)}),...(fixture.seriesId?{seriesId:Number(fixture.seriesId)}:{})};if(fixture.utcTime)delete body.localTime;if(!fixture.seriesId)delete body.seriesId;
          if(fixture.eventId&&!fixture.seriesId)body.seriesId=null;
          run(()=>request(`/api/site-management/betting/seasons/${sid}/events`,body),'Fixture saved. Markets will refresh.').then(saved=>{if(saved)setFixture(blank);});}}>
          {['team1Key','team2Key'].map((key,i)=><label key={key}>Team {i+1}<select required value={fixture[key]} onChange={e=>setFixture(f=>({...f,[key]:e.target.value}))}><option value="">Select team</option>
            {data.teams.map(t=><option key={t.teamKey} value={t.teamKey}>{t.name}</option>)}</select></label>)}
          <label>Stage<select value={fixture.stage} onChange={e=>setFixture(f=>({...f,stage:e.target.value,bestOf:e.target.value==='regular'?2:3}))}><option value="regular">Groups</option><option value="tiebreaker">Tiebreakers</option><option value="playoff">Playoffs</option></select></label>
          <label>Format<select value={fixture.bestOf} onChange={e=>setFixture(f=>({...f,bestOf:Number(e.target.value)}))}>{(fixture.stage==='regular'?[2]:[3,5]).map(n=><option key={n} value={n}>BO{n}</option>)}</select></label>
          <label>Kickoff (New York time)<input required={!fixture.utcTime} type="datetime-local" value={fixture.localTime} onChange={e=>setFixture(f=>({...f,localTime:e.target.value}))} /></label>
          <label>Exact UTC kickoff (optional)<input placeholder="2026-11-01T06:00:00Z" value={fixture.utcTime} onChange={e=>setFixture(f=>({...f,utcTime:e.target.value}))} /><small>Use for an ambiguous daylight-saving time.</small></label>
          <label>Status<select value={fixture.status} onChange={e=>setFixture(f=>({...f,status:e.target.value}))}>{['scheduled','started','completed','needs_review','cancelled','forfeit'].map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}</select></label>
          <label>Actual series ID<input type="number" min="1" disabled={!fixture.eventId} value={fixture.seriesId} onChange={e=>setFixture(f=>({...f,seriesId:e.target.value}))} /><small>After the games load, enter the ID from their series page. Save a new fixture before linking it. Settlement waits for this link and complete verified results.</small></label>
          <button disabled={busy||data.season.status==='ended'&&!fixture.eventId}>Save fixture</button><button type="button" onClick={()=>setFixture(blank)}>Clear</button>
        </form><p className="admin-help">Reschedule by editing this fixture to preserve tickets. Changing teams, stage or format replaces it and refunds its bets. Cancellations and forfeits also refund affected series bets.</p>
        <div className="betting-admin-events"><table className="sportsbook-table"><thead><tr><th>Fixture</th><th>Teams</th><th>Kickoff (NY)</th><th>Stage / Format</th><th>Status</th><th>Series</th><th /></tr></thead><tbody>
          {data.events.map(e=><tr key={e.EventId}><td>#{e.EventId}{e.SourceMessageId?.startsWith('local-test:')&&<small> · Test fixture</small>}</td><td>{e.Team1Name} vs {e.Team2Name}</td><td>{date(e.ScheduledStartUtc)}</td><td>{e.Stage} / BO{e.BestOf}</td><td>{e.Status}</td>
            <td>{e.SeriesId?<a href={`/series/${e.SeriesId}`}>{e.SeriesId}</a>:'Unlinked'}</td><td><button type="button" disabled={['replaced','cancelled','forfeit'].includes(e.Status)} onClick={()=>edit(e)}>Edit</button></td></tr>)}</tbody></table></div>
      </section>
      <section className="betting-admin-widget"><h3>Discord team roles</h3><p className="admin-help">Optional override: the bot normally matches a mentioned role’s name to the season’s team name, ignoring capitalization. Link a role ID here when its name differs; this mapping takes priority over name matching.</p><form className="betting-admin-form" onSubmit={e=>{e.preventDefault();run(()=>request(`/api/site-management/betting/seasons/${sid}/aliases`,{roleId:role,teamKey:Number(aliasTeam)},'PUT'),'Discord role linked.');}}>
        <label>Discord role ID<input required inputMode="numeric" value={role} onChange={e=>setRole(e.target.value)} /></label><label>Team<select required value={aliasTeam} onChange={e=>setAliasTeam(e.target.value)}><option value="">Select team</option>{data.teams.map(t=><option key={t.teamKey} value={t.teamKey}>{t.name}</option>)}</select></label><button disabled={busy}>Link role</button>
      </form>{data.aliases.map(a=><p key={a.RoleId}>{a.RoleId} → {data.teams.find(t=>t.teamKey===a.TeamSubmissionId)?.name}</p>)}</section>
      {data.messages.length>0&&<section className="betting-admin-widget"><h3>Scheduling posts needing review</h3><p className="admin-help">These posts could not be interpreted confidently, or a tracked post changed or was deleted. Check the original post in Discord, correct or create the fixture above, then select it here and Resolve. Resolving links the post; it does not correct the fixture’s time or teams.</p>
        {data.messages.map(m=><form className="betting-admin-form" key={m.MessageId} onSubmit={e=>{e.preventDefault();run(()=>request(`/api/site-management/betting/messages/${m.MessageId}/resolve`,{eventId:Number(resolveEvent[m.MessageId])}),'Scheduling post linked.');}}>
          <p>Post {m.MessageId} · {m.IssueCode?.replaceAll('_',' ')}{m.Deleted?' · Deleted':''}</p><label>Fixture<select required value={resolveEvent[m.MessageId]||''} onChange={e=>setResolveEvent(old=>({...old,[m.MessageId]:e.target.value}))}><option value="">Select fixture</option>{data.events.filter(e=>!['cancelled','replaced','forfeit'].includes(e.Status)).map(e=><option key={e.EventId} value={e.EventId}>#{e.EventId} {e.Team1Name} vs {e.Team2Name}</option>)}</select></label><button disabled={busy}>Resolve</button>
        </form>)}</section>}
      {data.setup&&<section className="betting-admin-widget"><h3>Official season outcomes</h3><p className="admin-help">Once all regular-season results are imported and verified, mark Regular season complete so eligible season-player bets can settle. Record each team’s official upper/lower-bracket or eliminated placement here. The league champion is confirmed in League → Overview.</p>
        <p className="admin-help">Use Normal for a completed schedule. Shortened refunds unsettled season-total bets; Canceled refunds unresolved bets. These choices affect player balances, so use the league’s official decision.</p>
        <form className="betting-admin-form" onSubmit={e=>{e.preventDefault();run(()=>request(`/api/site-management/betting/seasons/${sid}/completion`,{completion,regularSeasonComplete:complete,
          outcomes:outcomeTeam?[{teamKey:Number(outcomeTeam),type:'placement',value:outcome}]:[]},'PUT'),'Official outcomes saved. Settlement refresh queued.');}}>
          <label>Season completion<select value={completion} onChange={e=>setCompletion(e.target.value)}><option value="normal">Normal</option><option value="shortened">Shortened</option><option value="canceled">Canceled</option></select></label>
          <label className="betting-admin-check"><input type="checkbox" checked={complete} onChange={e=>setComplete(e.target.checked)} />Regular season complete</label>
          <label>Official placement team<select value={outcomeTeam} onChange={e=>setOutcomeTeam(e.target.value)}><option value="">No placement update</option>{data.teams.map(t=><option key={t.teamKey} value={t.teamKey}>{t.name}</option>)}</select></label>
          <label>Placement<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="upper">Upper bracket</option><option value="lower">Lower bracket</option><option value="eliminated">Eliminated</option></select></label>
          <button disabled={busy}>Save official outcomes</button>
        </form></section>}
      <section className="betting-admin-widget"><h3>Official games and remakes</h3><p className="admin-help">Use this only when an imported match needs correction: Official counts normally, Superseded replaces the original with a replay, and Abandoned excludes an unfinished attempt. Enter the original match ID and, for a replay, its replacement match ID. Link the replay to the same series before settlement.</p>
        <form className="betting-admin-form" onSubmit={e=>{e.preventDefault();run(()=>request(`/api/site-management/betting/seasons/${sid}/matches/classify`,{
          ...classification,matchId:Number(classification.matchId),replacementMatchId:classification.replacementMatchId?Number(classification.replacementMatchId):null,
          stageOverride:classification.stageOverride||null}),'Match classification saved. Analytics and settlement will refresh.');}}>
          <label>Match ID<input required type="number" min="1" value={classification.matchId} onChange={e=>setClassification(c=>({...c,matchId:e.target.value}))} /></label>
          <label>Classification<select value={classification.status} onChange={e=>setClassification(c=>({...c,status:e.target.value}))}><option value="official">Official completed game</option><option value="superseded">Superseded by replay</option><option value="abandoned">Abandoned attempt</option></select></label>
          <label>Replay match ID<input type="number" min="1" required={classification.status==='superseded'} value={classification.replacementMatchId} onChange={e=>setClassification(c=>({...c,replacementMatchId:e.target.value}))} /></label>
          <label>Official stage override<select value={classification.stageOverride} onChange={e=>setClassification(c=>({...c,stageOverride:e.target.value}))}><option value="">Keep source stage</option><option value="regular">Groups</option><option value="tiebreaker">Tiebreakers</option><option value="playoff">Playoffs</option></select></label>
          <label>Reason<input required maxLength="500" value={classification.reason} onChange={e=>setClassification(c=>({...c,reason:e.target.value}))} /></label><button disabled={busy}>Classify match</button>
        </form></section>
      {legacy.length>0&&<section className="betting-admin-widget"><h3>Resolve legacy tickets</h3><p className="admin-help">For bets placed before the new season-based system. Choose the old market, its verified played series, and every winning outcome, then settle; use Refund legacy market if it must be voided. These payouts affect the older point account, separate from current-season points.</p>
        <form className="betting-admin-form" onSubmit={e=>{e.preventDefault();run(()=>request('/api/site-management/betting/legacy/settle',{marketId:Number(legacyMarket),winningOptionIds:legacyOptions,seriesId:Number(legacySeries)}),'Legacy result recorded.');}}>
          <label>Legacy market<select required value={legacyMarket} onChange={e=>{setLegacyMarket(e.target.value);setLegacyOptions([]);}}><option value="">Select market</option>
            {[...new Map(legacy.map(m=>[m.legacyMarketId,m])).values()].map(m=><option key={m.legacyMarketId} value={m.legacyMarketId}>{m.title}</option>)}</select></label>
          <label>Verified actual series ID<input required type="number" min="1" value={legacySeries} onChange={e=>setLegacySeries(e.target.value)} /></label>
          <div>{(legacy.find(m=>m.legacyMarketId===Number(legacyMarket))?.options||[]).map(m=><label className="betting-admin-check" key={m.optionId}>
            <input type="checkbox" checked={legacyOptions.includes(m.optionId)} onChange={e=>setLegacyOptions(old=>e.target.checked?[...old,m.optionId]:old.filter(id=>id!==m.optionId))} />{m.label}</label>)}</div>
          <button disabled={busy||!legacyOptions.length}>Settle legacy market</button>
          <button type="button" disabled={busy||!legacyMarket} onClick={()=>run(()=>request('/api/site-management/betting/legacy/settle',{marketId:Number(legacyMarket),winningOptionIds:[],voidAll:true}),'Legacy market refunded.')}>Refund legacy market</button>
        </form></section>}
    </>}
  </section>;
}
