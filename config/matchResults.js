import {randomUUID} from 'node:crypto';
import {ensureMatchResultsSchema,hasTable,resultsChanged} from './matchResultsSchema.js';
import {associateTrackedSeries,currentLeagueStage,stageForLeagueMatch} from './seriesLifecycle.js';
import {fetchOpenDota} from './openDotaClient.js';
import {importLeagueMatch,enrichLeagueMatch} from './importLeagueMatch.js';
import {withSqliteBusyRetry} from './warehouseConnection.js';
import {nightlyOwnsResults} from './matchResultsOwnership.js';

const iso=ms=>new Date(ms).toISOString();
export function observeLeagueMatches(db,leagueId,matches,now=new Date()) {
  ensureMatchResultsSchema(db);
  return db.transaction(()=>{
    const active=hasTable(db,'LeagueInfo')?db.prepare('SELECT Active FROM LeagueInfo WHERE LeagueId=?').get(leagueId)?.Active:false;
    if(!active)return;
    const seen=new Set(),stage=currentLeagueStage(db,leagueId);
    for(const m of matches) {
      if(!m.MatchId)continue;seen.add(m.MatchId);
      const previous=db.prepare('SELECT * FROM TrackedLeagueMatches WHERE MatchId=?').get(m.MatchId);
      db.prepare(`INSERT INTO TrackedLeagueMatches(MatchId,LeagueId,Stage,TeamRad,TeamDire,FirstSeenAt,LastSeenAt,StartedAt,WorkerEligible)
        VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(MatchId) DO UPDATE SET LastSeenAt=excluded.LastSeenAt,MissingSince=NULL,
        TeamRad=COALESCE(excluded.TeamRad,TeamRad),TeamDire=COALESCE(excluded.TeamDire,TeamDire),
        ResultStatus=CASE WHEN ResultStatus IN ('pending','live') THEN 'live' ELSE ResultStatus END`)
        .run(m.MatchId,leagueId,stage,m.RadiantTeamId,m.DireTeamId,now.toISOString(),now.toISOString(),iso(now.getTime()-Math.max(0,m.GameDuration||0)*1000));
      const tracked=db.prepare('SELECT * FROM TrackedLeagueMatches WHERE MatchId=?').get(m.MatchId);
      if(!tracked.SeriesId) {
        const result=associateTrackedSeries(db,tracked,now);
        if(result.issue)db.prepare('UPDATE TrackedLeagueMatches SET LastError=? WHERE MatchId=?').run(result.issue,m.MatchId);
      }
      if(!previous||previous.MissingSince)resultsChanged(db);
    }
    for(const row of db.prepare("SELECT * FROM TrackedLeagueMatches WHERE LeagueId=? AND ResultStatus='live'").all(leagueId)) {
      if(seen.has(row.MatchId))continue;
      const missing=row.MissingSince||now.toISOString();
      db.prepare('UPDATE TrackedLeagueMatches SET MissingSince=? WHERE MatchId=?').run(missing,row.MatchId);
      if(now.getTime()-Date.parse(missing)>=120000) {
        db.prepare("UPDATE TrackedLeagueMatches SET ResultStatus='pending',NextAttemptAt=? WHERE MatchId=?").run(now.toISOString(),row.MatchId);
        resultsChanged(db);
      }
    }
  }).immediate();
}
export function enqueueLeagueMatch(db,matchId,leagueId,{stage=stageForLeagueMatch(db,leagueId,matchId),teamRad=null,teamDire=null,startedAt=null,now=new Date(),force=false,nightly=false}={}) {
  ensureMatchResultsSchema(db);
  db.prepare(`INSERT INTO TrackedLeagueMatches(MatchId,LeagueId,Stage,TeamRad,TeamDire,FirstSeenAt,LastSeenAt,StartedAt,MissingSince,ResultStatus,NextAttemptAt)
    VALUES(?,?,?,?,?,?,?,?,?,'pending',?) ON CONFLICT(MatchId) DO UPDATE SET
      NextAttemptAt=CASE WHEN ? THEN excluded.NextAttemptAt ELSE NextAttemptAt END,
      ResultStatus=CASE WHEN ? AND ResultStatus!='imported' THEN 'pending' ELSE ResultStatus END,
      EnrichmentStatus=CASE WHEN ? THEN 'pending' ELSE EnrichmentStatus END,
      LastError=CASE WHEN ? THEN NULL ELSE LastError END`)
    .run(matchId,leagueId,stage,teamRad,teamDire,now.toISOString(),now.toISOString(),startedAt,now.toISOString(),now.toISOString(),Number(force||nightly),Number(force||nightly),Number(force||nightly),Number(force||nightly));
  if(nightly)db.prepare('UPDATE TrackedLeagueMatches SET WorkerEligible=0 WHERE MatchId=?').run(matchId);
  if(force)db.prepare('UPDATE TrackedLeagueMatches SET ManualRequested=1,WorkerEligible=1 WHERE MatchId=?').run(matchId);
}
export function nightlyMatchCandidates(db,leagueId) {
  return db.prepare(`SELECT m.MatchId,m.TeamRad,m.TeamDire,l.DatePlayed FROM MatchLeague l JOIN MatchTeam m USING(MatchId)
    WHERE l.LeagueId=? AND ((SELECT COUNT(DISTINCT p.PlayerId) FROM MatchPlayer p WHERE p.MatchId=m.MatchId)<10
      OR (m.RadiantScore=0 AND m.DireScore=0)
      OR (datetime(l.DatePlayed)>datetime('now','-7 days') AND NOT EXISTS(SELECT 1 FROM MatchIngestionState i WHERE i.MatchId=m.MatchId AND i.Status='ready')))
    AND NOT EXISTS(SELECT 1 FROM LiveMatchCurrentState c WHERE c.MatchId=m.MatchId) ORDER BY m.MatchId`).all(leagueId);
}
export function claimResultJob(db,owner,now=new Date(),{automatic=true}={}) {
  ensureMatchResultsSchema(db);
  return db.transaction(()=>{
    if(automatic&&nightlyOwnsResults(db,now))return null;
    const enabled=!automatic||db.prepare('SELECT Enabled FROM MatchResultsSettings WHERE Id=1').get().Enabled;
    const job=db.prepare(`SELECT t.* FROM TrackedLeagueMatches t JOIN LeagueInfo l ON l.LeagueId=t.LeagueId AND l.Active=1
      WHERE (t.ResultStatus='pending' OR (t.ResultStatus IN ('imported','remake') AND t.EnrichmentStatus IN ('pending','partial','error')))
      AND (?=1 OR t.ManualRequested=1)
      AND (?=0 OR t.WorkerEligible=1 OR t.ManualRequested=1)
      AND (t.NextAttemptAt IS NULL OR t.NextAttemptAt<=?) AND (t.LeaseUntil IS NULL OR t.LeaseUntil<=?)
      ORDER BY CASE WHEN t.ResultStatus='pending' THEN 0 ELSE 1 END,t.NextAttemptAt,t.MatchId LIMIT 1`).get(Number(Boolean(enabled)),Number(automatic),now.toISOString(),now.toISOString());
    if(!job)return null;
    db.prepare('UPDATE TrackedLeagueMatches SET LeaseOwner=?,LeaseUntil=?,LastAttemptAt=?,AttemptCount=AttemptCount+1,ManualRequested=0,WorkerEligible=CASE WHEN ? THEN WorkerEligible ELSE 0 END WHERE MatchId=?')
      .run(owner,iso(now.getTime()+120000),now.toISOString(),Number(automatic),job.MatchId);
    return {...job,AttemptCount:job.AttemptCount+1};
  }).immediate();
}
async function requestParse(db,job,{owner,now,fetchImpl}) {
  const reserved=db.prepare('UPDATE TrackedLeagueMatches SET ParseRequestedAt=? WHERE MatchId=? AND LeaseOwner=? AND ParseRequestedAt IS NULL')
    .run(now().toISOString(),job.MatchId,owner);
  if(!reserved.changes)return;
  try {
    const response=await fetchImpl(`https://api.opendota.com/api/request/${job.MatchId}`,{db,priority:'background',method:'POST'});
    if(!response.ok)throw new Error('Parse request deferred');
    const parsed=await response.json();db.prepare('UPDATE TrackedLeagueMatches SET ParseJobId=? WHERE MatchId=? AND LeaseOwner=?')
      .run(String(parsed.job?.jobId||parsed.jobId||''),job.MatchId,owner);
  }catch{db.prepare('UPDATE TrackedLeagueMatches SET ParseRequestedAt=NULL WHERE MatchId=? AND LeaseOwner=?').run(job.MatchId,owner);}
}
export async function processResultJob(db,job,{owner,now=()=>new Date(),fetchImpl=fetchOpenDota}={}) {
  try {
    const response=await fetchImpl(`https://api.opendota.com/api/matches/${job.MatchId}`,{db,priority:job.ResultStatus==='pending'?'results':'background'});
    if(!response.ok)throw Object.assign(new Error(`OpenDota returned ${response.status}`),{retryAt:response.status===429?Date.now()+60000:null});
    const data=await response.json();
    let current=db.prepare('SELECT * FROM TrackedLeagueMatches WHERE MatchId=?').get(job.MatchId);
    if(current.LeaseOwner!==owner||current.ResultStatus==='live')return {deferred:true};
    db.prepare('UPDATE TrackedLeagueMatches SET LeaseUntil=? WHERE MatchId=? AND LeaseOwner=?').run(iso(now().getTime()+120000),job.MatchId,owner);
    const result=await withSqliteBusyRetry(()=>importLeagueMatch(db,data,{...current,ManualRequested:job.ManualRequested},now()));
    if(result.remake){if(result.needsDraft)await requestParse(db,job,{owner,now,fetchImpl});return result;}
    current=db.prepare('SELECT * FROM TrackedLeagueMatches WHERE MatchId=?').get(job.MatchId);
    const enrichment=await withSqliteBusyRetry(()=>enrichLeagueMatch(db,data,current,now()));
    const complete=enrichment.status==='ready';
    if(!complete)await requestParse(db,job,{owner,now,fetchImpl});
    db.prepare('UPDATE TrackedLeagueMatches SET NextAttemptAt=?,LastError=? WHERE MatchId=?')
      .run(complete?null:iso(now().getTime()+Math.min(3600000,60000*2**Math.min(job.AttemptCount,6))),result.review||null,job.MatchId);
    resultsChanged(db);return {...result,enrichment:enrichment.status};
  }catch(error) {
    const current=db.prepare('SELECT ResultStatus FROM TrackedLeagueMatches WHERE MatchId=?').get(job.MatchId);
    if(current?.ResultStatus!=='live')db.prepare(`UPDATE TrackedLeagueMatches SET
      ResultStatus=CASE WHEN ? AND ResultStatus!='imported' THEN 'needs_review' ELSE ResultStatus END,
      EnrichmentStatus=CASE WHEN ResultStatus='imported' THEN CASE WHEN ? THEN 'needs_review' ELSE 'error' END ELSE EnrichmentStatus END,
      NextAttemptAt=?,LastError=? WHERE MatchId=? AND LeaseOwner=?`)
      .run(Number(Boolean(error.review||error.conflict)),Number(Boolean(error.review||error.conflict)),iso(error.retryAt||now().getTime()+Math.min(3600000,30000*2**Math.min(job.AttemptCount-1,7))),error.message,job.MatchId,owner);
    resultsChanged(db);return {error:error.message};
  }finally {
    db.prepare('UPDATE TrackedLeagueMatches SET LeaseOwner=NULL,LeaseUntil=NULL WHERE MatchId=? AND LeaseOwner=?').run(job.MatchId,owner);
  }
}
export async function runResultBatch(db,{limit=5,automatic=true,...options}={}) {
  const owner=randomUUID(),results=[];
  for(let i=0;i<limit;i++) {
    const job=claimResultJob(db,owner,options.now?.()||new Date(),{automatic});if(!job)break;
    results.push(await processResultJob(db,job,{...options,owner}));
  }
  return results;
}
export function resultWorkerPollDelay(db,now=new Date()) {
  ensureMatchResultsSchema(db);
  if(nightlyOwnsResults(db,now))return 60000;
  const enabled=db.prepare('SELECT Enabled FROM MatchResultsSettings WHERE Id=1').get().Enabled;
  const active=db.prepare(`SELECT 1 FROM TrackedLeagueMatches t JOIN LeagueInfo l ON l.LeagueId=t.LeagueId AND l.Active=1
    WHERE (?=1 OR t.ManualRequested=1) AND (t.WorkerEligible=1 OR t.ManualRequested=1) AND (
      (t.ResultStatus='live' AND ?=1) OR (
        (t.ResultStatus='pending' OR (t.ResultStatus IN ('imported','remake') AND t.EnrichmentStatus IN ('pending','partial','error')))
        AND (t.NextAttemptAt IS NULL OR t.NextAttemptAt<=?) AND (t.LeaseUntil IS NULL OR t.LeaseUntil<=?)
      )) LIMIT 1`).get(Number(Boolean(enabled)),Number(Boolean(enabled)),iso(now.getTime()+15000),iso(now.getTime()+15000));
  const derived=hasTable(db,'BettingRefreshState')&&db.prepare(`SELECT 1 FROM MatchResultsState m JOIN BettingRefreshState b ON b.Id=m.Id
    WHERE m.Id=1 AND m.Revision>m.DerivedRevision AND b.RequestedRevision>b.CompletedRevision`).get();
  return active||derived?15000:60000;
}
export function matchImportStatus(db,matchId) {
  if(!hasTable(db,'TrackedLeagueMatches'))return null;
  const row=db.prepare('SELECT ResultStatus,EnrichmentStatus,LastError,ImportedAt,SeriesId FROM TrackedLeagueMatches WHERE MatchId=?').get(matchId);
  if(!row)return null;
  const imported=row.ResultStatus==='imported';
  return {result:row.ResultStatus,parse:row.EnrichmentStatus,imported,seriesId:row.SeriesId,
    label:row.ResultStatus==='remake'?(row.EnrichmentStatus==='pending'?'Remake · Draft data still processing':'Remake · excluded from series score'):row.ResultStatus==='needs_review'?'Import delayed · Admin review needed':!imported?'Awaiting match results':row.EnrichmentStatus==='needs_review'?'Result confirmed · Parse requires admin review':!row.SeriesId&&row.LastError?'Result confirmed · Series pairing needs review':row.EnrichmentStatus==='ready'?null:'Parse incomplete · Detailed stats are still processing'};
}
export function trackedSeriesStatus(db,seriesId) {
  if(!hasTable(db,'SeriesLifecycle'))return null;
  const state=db.prepare('SELECT * FROM SeriesLifecycle WHERE SeriesId=?').get(seriesId);
  return state?{status:state.Status,bestOf:state.BestOf,team1Wins:state.Team1Wins,team2Wins:state.Team2Wins}:null;
}
