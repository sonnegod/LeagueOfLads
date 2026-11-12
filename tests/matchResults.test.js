import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {ensureMatchResultsSchema} from '../config/matchResultsSchema.js';
import {observeLeagueMatches,enqueueLeagueMatch,claimResultJob,processResultJob,runResultBatch,resultWorkerPollDelay,nightlyMatchCandidates} from '../config/matchResults.js';
import {acquireResultsWorker,releaseResultsWorker,nightlyOwnsResults,withNightlyResultsOwnership} from '../config/matchResultsOwnership.js';
import {importLeagueMatch,enrichLeagueMatch} from '../config/importLeagueMatch.js';
import {refreshSeriesLifecycle,seriesFormat,advanceCompletedPlayoffSeries,stageForLeagueMatch} from '../config/seriesLifecycle.js';
import {reserveOpenDotaRequest,fetchOpenDota} from '../config/openDotaClient.js';
import {groupLiveSeries} from '../config/liveSeries.js';
import {ScheduleStore} from '../betting/scheduleStore.js';
import {historicalSourceFingerprint} from '../betting/historicalPricing.js';
import express from 'express';
import {createAdminMatchRouter} from '../routes/adminMatchRoutes.js';
import {deleteMatchRecords} from '../config/matchMaintenance.js';

const start=new Date('2026-11-09T01:00:00Z');
function fixture() {
  const db=new Database(':memory:');
  db.exec(readFileSync(new URL('../scripts/db/ladsData.schema.sql',import.meta.url),'utf8'));
  db.exec('CREATE TABLE GroupResultOverrides(LeagueId INTEGER,GroupId INTEGER,TeamA INTEGER,TeamB INTEGER,WinsA INTEGER,WinsB INTEGER,BaseWinsA INTEGER,BaseWinsB INTEGER)');
  db.exec('CREATE TABLE LeagueTeamNames(LeagueId INTEGER,TeamId INTEGER,DisplayName TEXT,PRIMARY KEY(LeagueId,TeamId))');
  db.exec(`INSERT INTO LeagueInfo VALUES(100,'Current',1);
    INSERT INTO LeagueSeasons(SeasonId,LeagueName,Status,ExternalLeagueId,CreatedAt,UpdatedAt) VALUES(1,'Current','active',100,'2026-10-01','2026-10-01');
    INSERT INTO SeasonTeams(TeamSubmissionId,SeasonId,TeamName,ExternalTeamId,SubmittedAt,UpdatedAt) VALUES(11,1,'Signup A',1001,'2026-10-01','2026-10-01'),(12,1,'Signup B',1002,'2026-10-01','2026-10-01');
    INSERT INTO TeamInfo VALUES(1001,'Different Dota name A'),(1002,'Different Dota name B');`);
  db.exec("INSERT INTO GroupNames(LeagueId,GroupId,GroupName) VALUES(100,1,'Moon');INSERT INTO LeagueGroups(LeagueId,TeamId,GroupId) VALUES(100,1001,1),(100,1002,1)");
  for(let i=1;i<=10;i++)db.prepare('INSERT INTO HeroInfo VALUES(?,?)').run(i,'Hero '+i);
  const schedules=new ScheduleStore(db);ensureMatchResultsSchema(db);
  return {db,schedules,close:()=>db.close()};
}
function payload(id=1,{offset=0,swap=false,complete=false}={}) {
  return {match_id:id,leagueid:100,radiant_team_id:swap?1002:1001,dire_team_id:swap?1001:1002,
    start_time:start.getTime()/1000+offset,duration:1800,radiant_win:true,radiant_score:20,dire_score:10,
    ...(complete?{version:22,radiant_gold_adv:[0,100],radiant_xp_adv:[0,100],objectives:[],teamfights:[]}:{}),
    players:Array.from({length:10},(_,i)=>({account_id:i+1,hero_id:i+1,player_slot:i<5?i:128+i-5,
      kills:2,deaths:1,assists:3,last_hits:100,gold_per_min:500,xp_per_min:600,net_worth:10000,
      hero_damage:5000,hero_healing:0,tower_damage:100,
      ...(complete?{times:[0,60],gold_t:[0,100],xp_t:[0,100],lh_t:[0,2],purchase_log:[]}:{} )}))};
}
function queued(f,id=1,options={}) {
  const data=payload(id,options);enqueueLeagueMatch(f.db,id,100,{stage:'g',teamRad:data.radiant_team_id,teamDire:data.dire_team_id,startedAt:new Date(data.start_time*1000).toISOString(),now:start});
  return f.db.prepare('SELECT * FROM TrackedLeagueMatches WHERE MatchId=?').get(id);
}
test('healthy disappearance grace, return to live, disabled processing and restart-safe claims',()=>{
  const f=fixture();try {
    const m={MatchId:1,RadiantTeamId:1001,DireTeamId:1002,GameDuration:100};
    observeLeagueMatches(f.db,100,[m],start);
    observeLeagueMatches(f.db,100,[],new Date(+start+1000));
    observeLeagueMatches(f.db,100,[],new Date(+start+120000));
    assert.equal(f.db.prepare('SELECT ResultStatus FROM TrackedLeagueMatches').get().ResultStatus,'live');
    observeLeagueMatches(f.db,100,[],new Date(+start+122000));
    assert.equal(claimResultJob(f.db,'disabled',new Date(+start+122000)),null);
    f.db.exec('UPDATE MatchResultsSettings SET Enabled=1');
    assert.equal(claimResultJob(f.db,'one',new Date(+start+122000)).MatchId,1);
    assert.equal(claimResultJob(f.db,'two',new Date(+start+122000)),null);
    assert.equal(claimResultJob(f.db,'restarted',new Date(+start+243000)).MatchId,1);
    observeLeagueMatches(f.db,100,[m],new Date(+start+244000));
    assert.equal(claimResultJob(f.db,'three',new Date(+start+245000)),null);
  }finally{f.close();}
});
test('the worker stays idle without games, wakes for live activity, and returns to idle after work completes',async()=>{
  const f=fixture();try {
    let requests=0;
    const fetchImpl=async()=>{requests++;return {ok:true,json:async()=>payload(1,{complete:true})};};
    f.db.exec('UPDATE MatchResultsSettings SET Enabled=1');
    assert.equal(resultWorkerPollDelay(f.db,start),60000);
    assert.deepEqual(await runResultBatch(f.db,{now:()=>start,fetchImpl}),[]);
    assert.equal(requests,0,'An empty queue must not call OpenDota');
    const live={MatchId:1,RadiantTeamId:1001,DireTeamId:1002,GameDuration:100};
    observeLeagueMatches(f.db,100,[live],start);
    assert.equal(resultWorkerPollDelay(f.db,start),15000);
    observeLeagueMatches(f.db,100,[],new Date(+start+1000));
    const ended=new Date(+start+122000);
    observeLeagueMatches(f.db,100,[],ended);
    await runResultBatch(f.db,{now:()=>ended,fetchImpl});
    assert.equal(requests,1);
    assert.equal(resultWorkerPollDelay(f.db,ended),15000,'Derived updates must finish before idling');
    f.db.exec('UPDATE BettingRefreshState SET CompletedRevision=RequestedRevision;UPDATE MatchResultsState SET DerivedRevision=Revision');
    assert.equal(resultWorkerPollDelay(f.db,ended),60000);
    f.db.prepare("UPDATE TrackedLeagueMatches SET EnrichmentStatus='partial',NextAttemptAt=?").run(new Date(+ended+3600000).toISOString());
    assert.equal(resultWorkerPollDelay(f.db,ended),60000,'Replay backoff must not keep fast polling active');
    assert.equal(resultWorkerPollDelay(f.db,new Date(+ended+3600000)),15000);
    f.db.exec('UPDATE MatchResultsSettings SET Enabled=0');
    assert.equal(resultWorkerPollDelay(f.db,new Date(+ended+3600000)),60000);
    enqueueLeagueMatch(f.db,1,100,{force:true,now:ended});
    assert.equal(resultWorkerPollDelay(f.db,ended),15000,'An explicit admin retry also wakes processing');
  }finally{f.close();}
});

test('nightly drains the active worker, takes permanent cleanup ownership, and leaves new live games eligible',async()=>{
  const f=fixture();try {
    f.db.exec('UPDATE MatchResultsSettings SET Enabled=1');
    const one={MatchId:1,RadiantTeamId:1001,DireTeamId:1002,GameDuration:100};
    const crossing={...one,MatchId:3};
    observeLeagueMatches(f.db,100,[one,crossing],start);
    observeLeagueMatches(f.db,100,[crossing],new Date(+start+1000));
    let at=new Date(+start+122000);
    observeLeagueMatches(f.db,100,[crossing],at);
    assert.equal(acquireResultsWorker(f.db,'daytime',at),true);
    const job=claimResultJob(f.db,'daytime',at);assert.equal(job.MatchId,1);
    let drained=false;
    await withNightlyResultsOwnership(f.db,async()=>{
      assert.equal(drained,true);assert.equal(nightlyOwnsResults(f.db,at),true);
      assert.equal(acquireResultsWorker(f.db,'other-worker',at),false);
      assert.equal(claimResultJob(f.db,'automatic',at),null);
      assert.equal(resultWorkerPollDelay(f.db,at),60000);
      assert.equal(f.db.prepare('SELECT WorkerEligible FROM TrackedLeagueMatches WHERE MatchId=1').get().WorkerEligible,0);
      assert.equal(f.db.prepare('SELECT WorkerEligible FROM TrackedLeagueMatches WHERE MatchId=3').get().WorkerEligible,1);
      const results=await runResultBatch(f.db,{automatic:false,now:()=>at,fetchImpl:async()=>({ok:true,json:async()=>payload(1,{complete:true})})});
      assert.equal(results.length,1);assert.equal(results[0].enrichment,'ready');
    },{owner:'nightly',now:()=>at,wait:async()=>{
      assert.equal(nightlyOwnsResults(f.db,at),true);
      assert.equal(claimResultJob(f.db,'second-job',at),null,'A nightly request stops further daytime claims');
      await processResultJob(f.db,job,{owner:'daytime',now:()=>at,fetchImpl:async()=>({ok:true,json:async()=>payload()})});
      releaseResultsWorker(f.db,'daytime');drained=true;at=new Date(+at+1000);
    }});
    assert.equal(nightlyOwnsResults(f.db,at),false);
    assert.equal(f.db.prepare('SELECT Revision=DerivedRevision AS done FROM MatchResultsState').get().done,1);
    assert.equal(f.db.prepare('SELECT WorkerEligible FROM TrackedLeagueMatches WHERE MatchId=1').get().WorkerEligible,0);
    const newLive={...one,MatchId:4};
    observeLeagueMatches(f.db,100,[crossing,newLive],at);
    observeLeagueMatches(f.db,100,[crossing],new Date(+at+1000));
    at=new Date(+at+122000);observeLeagueMatches(f.db,100,[crossing],at);
    assert.equal(claimResultJob(f.db,'next-game',at).MatchId,4);
  }finally{f.close();}
});

test('a failed nightly releases its pause but leaves old cleanup to nightly or an explicit admin retry',async()=>{
  const f=fixture();try {
    f.db.exec('UPDATE MatchResultsSettings SET Enabled=1');
    enqueueLeagueMatch(f.db,1,100,{force:true,now:start});
    await assert.rejects(withNightlyResultsOwnership(f.db,async()=>{throw new Error('Nightly source unavailable');},{now:()=>start}),/source unavailable/);
    assert.equal(nightlyOwnsResults(f.db,start),false);
    assert.equal(acquireResultsWorker(f.db,'resumed',start),true);releaseResultsWorker(f.db,'resumed');
    let requests=0;
    assert.deepEqual(await runResultBatch(f.db,{now:()=>start,fetchImpl:async()=>{requests++;throw new Error('Unexpected API call');}}),[]);
    assert.equal(requests,0);
    enqueueLeagueMatch(f.db,1,100,{force:true,now:start});
    assert.equal(claimResultJob(f.db,'admin-retry',start).MatchId,1);
  }finally{f.close();}
});

test('nightly can recover an expired worker and stale responses cannot overwrite its replacement claim',async()=>{
  const f=fixture();try {
    f.db.exec('UPDATE MatchResultsSettings SET Enabled=1');
    enqueueLeagueMatch(f.db,1,100,{force:true,now:start});
    assert.equal(acquireResultsWorker(f.db,'crashed-worker',start),true);
    const old=claimResultJob(f.db,'crashed-worker',start);
    const at=new Date(+start+181000);
    await withNightlyResultsOwnership(f.db,async()=>{
      await assert.rejects(withNightlyResultsOwnership(f.db,async()=>assert.fail('Concurrent nightly must not run'),{now:()=>at}),/Another nightly run/);
      const replacement=claimResultJob(f.db,'nightly-import',at,{automatic:false});
      assert.equal(replacement.MatchId,1);
      const fetchImpl=async()=>({ok:true,json:async()=>payload(1,{complete:true})});
      assert.deepEqual(await processResultJob(f.db,old,{owner:'crashed-worker',now:()=>at,fetchImpl}),{deferred:true});
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchTeam').get().n,0);
      const result=await processResultJob(f.db,replacement,{owner:'nightly-import',now:()=>at,fetchImpl});
      assert.equal(result.imported,true);
    },{now:()=>at});
  }finally{f.close();}
});

test('two imported games share a stable series, survive side swaps and link by IDs despite different names',()=>{
  const f=fixture();try {
    const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:start.toISOString()},null,new Date(+start-3600000));
    const one=queued(f);importLeagueMatch(f.db,payload(),one,start);
    const seriesId=f.db.prepare('SELECT SeriesId FROM TrackedLeagueMatches WHERE MatchId=1').get().SeriesId;
    assert.equal(f.schedules.get(event.EventId).SeriesId,seriesId);
    assert.equal(refreshSeriesLifecycle(f.db,seriesId).Status,'in_progress');
    assert.deepEqual(f.db.prepare('SELECT TeamId,Wins,Losses FROM LeagueStandings ORDER BY TeamId').all(),[{TeamId:1001,Wins:1,Losses:0},{TeamId:1002,Wins:0,Losses:1}]);
    const two=queued(f,2,{offset:3600,swap:true});importLeagueMatch(f.db,payload(2,{offset:3600,swap:true}),two,new Date(+start+6000000));
    const state=refreshSeriesLifecycle(f.db,seriesId);assert.equal(state.Status,'completed');
    assert.deepEqual([state.Team1Wins,state.Team2Wins],[1,1]);
    assert.ok(f.db.prepare('SELECT Wins,Losses FROM LeagueStandings').all().every(team=>team.Wins===1&&team.Losses===1));
    assert.ok(f.db.prepare('SELECT Score FROM Neustadtl').all().every(team=>team.Score===1));
    const revision=f.db.prepare('SELECT RequestedRevision FROM BettingRefreshState').get().RequestedRevision;
    importLeagueMatch(f.db,payload(),f.db.prepare('SELECT * FROM TrackedLeagueMatches WHERE MatchId=1').get(),start);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchPlayer').get().n,20);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM SeriesMatch').get().n,2);
    assert.equal(f.db.prepare('SELECT RequestedRevision FROM BettingRefreshState').get().RequestedRevision,revision);
  }finally{f.close();}
});
test('basic result is usable before replay parsing, and later enrichment preserves the result',()=>{
  const f=fixture();try {
    const job=queued(f);importLeagueMatch(f.db,payload(),job,start);
    assert.equal(enrichLeagueMatch(f.db,payload(),job,start).status,'partial');
    const fingerprint=historicalSourceFingerprint(f.db),pending=f.db.prepare('SELECT RequestedRevision FROM BettingRefreshState').get().RequestedRevision;
    importLeagueMatch(f.db,payload(),f.db.prepare('SELECT * FROM TrackedLeagueMatches WHERE MatchId=1').get(),new Date(+start+60000));
    assert.equal(enrichLeagueMatch(f.db,payload(),job,new Date(+start+60000)).unchanged,true);
    assert.equal(historicalSourceFingerprint(f.db),fingerprint,'Unchanged enrichment must not invalidate saved odds');
    assert.equal(f.db.prepare('SELECT RequestedRevision FROM BettingRefreshState').get().RequestedRevision,pending);
    assert.equal(enrichLeagueMatch(f.db,payload(1,{complete:true}),job,start).status,'ready');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchPlayer').get().n,10);
    assert.equal(f.db.prepare('SELECT WinnerId FROM MatchTeam').get().WinnerId,1001);
    assert.equal(f.db.prepare('SELECT EnrichmentStatus FROM TrackedLeagueMatches').get().EnrichmentStatus,'ready');
  }finally{f.close();}
});
test('worker retries missing results and incomplete replay data without duplicate parse submissions',async()=>{
  const f=fixture();try {
    queued(f);let at=start,requests=0,parses=0;
    const fetchImpl=async(url)=>({ok:true,json:async()=>{
      if(url.includes('/request/')){parses++;return {job:{jobId:'parse1'}};}
      return ++requests===1?{match_id:1,leagueid:100}:payload();
    }});
    await runResultBatch(f.db,{automatic:false,now:()=>at,fetchImpl});
    assert.equal(f.db.prepare('SELECT ResultStatus FROM TrackedLeagueMatches').get().ResultStatus,'pending');
    at=new Date(+at+60000);await runResultBatch(f.db,{automatic:false,now:()=>at,fetchImpl});
    assert.equal(f.db.prepare('SELECT ResultStatus FROM TrackedLeagueMatches').get().ResultStatus,'imported');
    at=new Date(+at+3600000);await runResultBatch(f.db,{automatic:false,now:()=>at,fetchImpl});
    assert.equal(parses,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchPlayer').get().n,10);
  }finally{f.close();}
});
test('manual team corrections and mismatched identities are preserved',()=>{
  const f=fixture();try {
    const job=queued(f);assert.throws(()=>importLeagueMatch(f.db,{...payload(),leagueid:999},job),/identity/);
    importLeagueMatch(f.db,payload(),job,start);
    f.db.exec('UPDATE MatchTeam SET TeamRad=9999 WHERE MatchId=1');
    assert.throws(()=>importLeagueMatch(f.db,payload(),job,start),/preserve the admin correction/);
    assert.equal(f.db.prepare('SELECT TeamRad FROM MatchTeam').get().TeamRad,9999);
  }finally{f.close();}
});
test('shared request budget counts requests before sending and reserves headroom for results',()=>{
  const db=new Database(':memory:');try {
    let now=+start;
    for(let i=0;i<22;i++){assert.equal(reserveOpenDotaRequest(db,{now}).allowed,true);now+=2000;}
    assert.match(reserveOpenDotaRequest(db,{now}).reason,/reserved/);
    assert.equal(reserveOpenDotaRequest(db,{now,priority:'results'}).allowed,true);
    assert.equal(reserveOpenDotaRequest(db,{now:now+1,priority:'results'}).allowed,undefined);
    assert.equal(db.prepare('SELECT Requests FROM OpenDotaUsage WHERE Window=?').get('month:2026-11').Requests,23);
  }finally{db.close();}
});
test('live grouping retains completed snapshots with a current game and excludes remake numbering',()=>{
  const base={TrackedSeriesId:4,SeriesTeam1:1001,SeriesTeam2:1002,SeriesTeam1Wins:1,SeriesTeam2Wins:0};
  const groups=groupLiveSeries([{...base,MatchId:3,MatchStartedAt:'2026-11-09T02:00:00Z'}],
    [{...base,MatchId:1,MatchStartedAt:'2026-11-09T01:00:00Z',ImportStatus:{result:'remake'}},
     {...base,MatchId:2,MatchStartedAt:'2026-11-09T01:10:00Z',ImportStatus:{result:'imported'}}]);
  assert.equal(groups.length,1);assert.equal(groups[0].live,true);
  assert.deepEqual(groups[0].games.map(g=>g.gameNumber),[null,1,2]);assert.deepEqual(groups[0].score,[1,0]);
});
test('BO3 brackets do not advance on game one, and grand finals require a separately configured format',()=>{
  const f=fixture();try {
    const bracket={upperBracket:[{matches:[{id:'ub',team1Id:1001,team2Id:1002,team1Name:'A',team2Name:'B',winnerTo:'final'}]}],lowerBracket:[],grandFinals:[{id:'final',team2Id:1002}]};
    f.db.prepare('INSERT INTO PlayoffBracket VALUES(100,?)').run(JSON.stringify(bracket));
    for(let id=1;id<=2;id++) {
      const job=queued(f,id,{offset:(id-1)*3600});f.db.prepare("UPDATE TrackedLeagueMatches SET Stage='p' WHERE MatchId=?").run(id);job.Stage='p';
      importLeagueMatch(f.db,payload(id,{offset:(id-1)*3600}),job,new Date(+start+id*3600000));
      const saved=JSON.parse(f.db.prepare('SELECT PlayoffStructure FROM PlayoffBracket').get().PlayoffStructure);
      assert.equal(Boolean(saved.upperBracket[0].matches[0].seriesId),id===2);
      assert.equal(saved.grandFinals[0].seriesId,undefined,'An upper-bracket result cannot be reused for a grand final between the same teams');
    }
    const finals={...bracket,upperBracket:[{matches:[{...bracket.upperBracket[0].matches[0],seriesId:1}]}],grandFinals:[{id:'final',team1Id:1001,team2Id:1002}]};
    f.db.prepare('UPDATE PlayoffBracket SET PlayoffStructure=?').run(JSON.stringify(finals));
    assert.equal(seriesFormat(f.db,100,'p',[1001,1002]).bestOf,null);
    f.db.exec('UPDATE MatchResultsSettings SET GrandFinalBestOf=5');
    assert.equal(seriesFormat(f.db,100,'p',[1001,1002]).bestOf,5);
    assert.equal(seriesFormat(f.db,100,'p',[1001,1002],{BestOf:3}).bestOf,3,'Explicit fixture wins over defaults');
    advanceCompletedPlayoffSeries(f.db,100);
  }finally{f.close();}
});
test('a replacement fixture format takes precedence without using the replaced fixture rules',()=>{
  const f=fixture();try {
    const input={team1Key:11,team2Key:12,stage:'tiebreaker',bestOf:1,scheduledStartUtc:start.toISOString()};
    const event=f.schedules.save(1,input);
    importLeagueMatch(f.db,payload(),queued(f),start);
    const seriesId=f.schedules.get(event.EventId).SeriesId;
    assert.equal(refreshSeriesLifecycle(f.db,seriesId).Status,'completed');
    const current=f.schedules.get(event.EventId);
    const replacement=f.schedules.save(1,{...input,eventId:current.EventId,revision:current.Revision,bestOf:3});
    assert.equal(f.schedules.get(event.EventId).Status,'replaced');
    assert.equal(replacement.SeriesId,seriesId);
    const state=refreshSeriesLifecycle(f.db,seriesId);
    assert.equal(state.EventId,replacement.EventId);assert.equal(state.BestOf,3);assert.equal(state.Status,'in_progress');
  }finally{f.close();}
});

test('stage boundaries and tiebreaker pool formats are read without assuming grand-final stages',()=>{
  const f=fixture();try {
    f.db.exec('INSERT INTO LeagueStageBoundaries VALUES(100,10,20)');
    assert.deepEqual([5,15,25].map(id=>stageForLeagueMatch(f.db,100,id)),['g','t','p']);
    f.db.exec('DELETE FROM LeagueStageBoundaries');
    assert.equal(stageForLeagueMatch(f.db,100,25),'g');
    f.db.prepare('INSERT INTO LeagueQualificationStages(LeagueId,SnapshotJson,StartedAtUtc) VALUES(100,?,?)')
      .run(JSON.stringify({pools:[{id:'upper',bestOf:1,teams:[{TeamId:1001},{TeamId:1002}]}]}),start.toISOString());
    assert.equal(seriesFormat(f.db,100,'t',[1001,1002]).bestOf,1);
    assert.equal(seriesFormat(f.db,100,'t',[1001,9999]).bestOf,null);
  }finally{f.close();}
});
test('a failed core transaction leaves no partial match, and manual retry works with automation disabled',async()=>{
  const f=fixture();try {
    const job=queued(f);const broken=payload();broken.players[0].gold_per_min=null;
    assert.throws(()=>importLeagueMatch(f.db,broken,job),/scoreboard/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchTeam').get().n,0);
    assert.equal(claimResultJob(f.db,'disabled',start),null);
    enqueueLeagueMatch(f.db,1,100,{force:true,now:start});
    assert.equal(claimResultJob(f.db,'manual',start).MatchId,1);
    assert.equal(claimResultJob(f.db,'other',start),null);
    assert.equal(f.db.prepare('SELECT ManualRequested FROM TrackedLeagueMatches').get().ManualRequested,0);
  }finally{f.close();}
});
test('rate-limit cooldowns are persisted and later calls do not bypass the shared throttle',async()=>{
  const db=new Database(':memory:');try {
    const headers=new Headers({'retry-after':'300'});
    const response=await fetchOpenDota('https://api.opendota.com/api/matches/1',{db,fetchImpl:async()=>({status:429,headers}),priority:'results'});
    assert.equal(response.status,429);
    const permit=reserveOpenDotaRequest(db,{priority:'results'});
    assert.match(permit.reason,/rate limit/);assert.ok(permit.retryAt>Date.now()+290000);
    let requests=0;
    await assert.rejects(()=>fetchOpenDota('https://api.opendota.com/api/matches/2',{db,fetchImpl:async()=>{requests++;}}),{code:'OPENDOTA_DEFERRED'});
    assert.equal(requests,0);
  }finally{db.close();}
});
test('unscheduled games spanning midnight retain their in-progress series and snapshots are never deleted by import',()=>{
  const f=fixture();try {
    const first=queued(f);first.StartedAt='2026-11-09T04:30:00Z';
    const data={...payload(),start_time:Date.parse(first.StartedAt)/1000};importLeagueMatch(f.db,data,first,start);
    const id=f.db.prepare('SELECT SeriesId FROM TrackedLeagueMatches WHERE MatchId=1').get().SeriesId;
    const second=queued(f,2);second.StartedAt='2026-11-09T05:30:00Z';
    f.db.prepare('INSERT INTO LiveMatchSnapshots(MatchId,LeagueId,SnapshotHash) VALUES(2,100,?)').run('saved-live-snapshot');
    importLeagueMatch(f.db,{...payload(2),start_time:Date.parse(second.StartedAt)/1000},second,start);
    assert.equal(f.db.prepare('SELECT SeriesId FROM TrackedLeagueMatches WHERE MatchId=2').get().SeriesId,id);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM LiveMatchSnapshots').get().n,1);
  }finally{f.close();}
});
test('BO1 fixture migration preserves IDs, revision history, triggers and the autoincrement sequence',()=>{
  const f=fixture();try {
    const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:start.toISOString()});
    const before=f.db.prepare('SELECT * FROM ScheduledEvents').all(),revisions=f.db.prepare('SELECT * FROM ScheduleEventRevisions').all();
    const sql=f.db.prepare("SELECT sql FROM sqlite_master WHERE name='ScheduledEvents'").get().sql;
    f.db.exec(sql.replace('ScheduledEvents','ScheduledEvents_old').replace('IN (1,2,3,5)','IN (2,3,5)'));
    f.db.exec('INSERT INTO ScheduledEvents_old SELECT * FROM ScheduledEvents;DROP TABLE ScheduledEvents;ALTER TABLE ScheduledEvents_old RENAME TO ScheduledEvents;');
    f.db.exec("UPDATE sqlite_sequence SET seq=99 WHERE name='ScheduledEvents';CREATE TABLE FixtureTouch(EventId INTEGER);CREATE TRIGGER KeepFixtureTrigger AFTER UPDATE ON ScheduledEvents BEGIN INSERT INTO FixtureTouch VALUES(NEW.EventId);END;");
    const migrated=new ScheduleStore(f.db);
    assert.deepEqual(f.db.prepare('SELECT * FROM ScheduledEvents').all(),before);
    assert.deepEqual(f.db.prepare('SELECT * FROM ScheduleEventRevisions').all(),revisions);
    const one=migrated.save(1,{team1Key:11,team2Key:12,stage:'tiebreaker',bestOf:1,scheduledStartUtc:start.toISOString()});
    assert.equal(one.EventId,100);assert.equal(one.BestOf,1);
    f.db.prepare('UPDATE ScheduledEvents SET Revision=Revision+1 WHERE EventId=?').run(event.EventId);
    assert.equal(f.db.prepare('SELECT EventId FROM FixtureTouch').get().EventId,event.EventId);
    new ScheduleStore(f.db);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ScheduledEvents').get().n,2);
  }finally{f.close();}
});
test('admin import settings require authorization, reject stale edits, and queue manual work without opening automation',async()=>{
  const f=fixture();let server;
  try {
    const app=express();app.use(express.json());
    app.use((req,res,next)=>{const user=req.get('x-test-user');req.isAuthenticated=()=>Boolean(user);req.user=user?{id:String(76561197960265728n+BigInt(user))}:null;
      return user==='99'?next():res.sendStatus(user?403:401);});
    app.use('/api/admin/matches',createAdminMatchRouter({league:f.db,schedules:f.schedules}));
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const request=(path,method='GET',body,user='99')=>fetch(`http://127.0.0.1:${server.address().port}/api/admin/matches/imports${path}`,{
      method,headers:{'Content-Type':'application/json',...(user?{'x-test-user':user}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal((await request('','GET',null,null)).status,401);assert.equal((await request('','GET',null,'1')).status,403);
    const initial=await(await request('')).json();assert.equal(initial.settings.Enabled,0);assert.equal(initial.settings.GrandFinalBestOf,null);
    const settings={enabled:false,playoffBestOf:3,grandFinalBestOf:5,revision:initial.settings.Revision};
    assert.equal((await request('/settings','PUT',settings)).status,200);
    assert.equal((await request('/settings','PUT',settings)).status,409);
    assert.equal((await request('','POST',{seasonId:1,matchId:100})).status,200);
    assert.equal(f.db.prepare('SELECT ManualRequested FROM TrackedLeagueMatches WHERE MatchId=100').get().ManualRequested,1);
    assert.equal(f.db.prepare('SELECT Enabled FROM MatchResultsSettings').get().Enabled,0);
    assert.equal((await request('','POST',{seasonId:999,matchId:100})).status,400);
  }finally{server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});
test('deleted imported matches stay deleted until an admin explicitly requests reimport',async()=>{
  const f=fixture();try {
    const job=queued(f);importLeagueMatch(f.db,payload(),job,start);
    deleteMatchRecords(f.db,1);
    const tracked=f.db.prepare('SELECT * FROM TrackedLeagueMatches WHERE MatchId=1').get();
    assert.throws(()=>importLeagueMatch(f.db,payload(),tracked,start),/explicit admin reimport/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchTeam').get().n,0);
    enqueueLeagueMatch(f.db,1,100,{force:true,now:start});
    const results=await runResultBatch(f.db,{now:()=>start,fetchImpl:async()=>({ok:true,json:async()=>payload(1,{complete:true})})});
    assert.equal(results.length,1);assert.equal(results[0].imported,true);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchTeam').get().n,1);
    assert.equal(f.db.prepare('SELECT WinnerId FROM MatchTeam').get().WinnerId,1001);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchPlayer').get().n,10);
  }finally{f.close();}
});

test('deleting a played game immediately reduces its team record and reopens the incomplete series',()=>{
  const f=fixture();try {
    importLeagueMatch(f.db,payload(),queued(f),start);
    importLeagueMatch(f.db,payload(2,{offset:3600}),queued(f,2,{offset:3600}),start);
    const readSeries=()=>f.db.prepare('SELECT Status,Team1Wins,Team2Wins FROM SeriesLifecycle LIMIT 1').get();
    assert.deepEqual(readSeries(),{Status:'completed',Team1Wins:2,Team2Wins:0});
    assert.equal(f.db.prepare('SELECT Wins FROM LeagueStandings WHERE TeamId=1001').get().Wins,2);
    deleteMatchRecords(f.db,1);
    assert.deepEqual(readSeries(),{Status:'in_progress',Team1Wins:1,Team2Wins:0});
    assert.equal(f.db.prepare('SELECT Wins FROM LeagueStandings WHERE TeamId=1001').get().Wins,1);
    assert.equal(f.db.prepare('SELECT Losses FROM LeagueStandings WHERE TeamId=1002').get().Losses,1);
    assert.equal(f.db.prepare('SELECT MatchId FROM SeriesMatch').get().MatchId,2);
  }finally{f.close();}
});

test('remakes do not count as games, and a delayed Captains Mode draft is retrieved without duplicate parse requests',async()=>{
  const f=fixture();try {
    queued(f);let at=start,attempt=0,parses=0;
    const fetchImpl=async url=>({ok:true,json:async()=>{
      if(url.includes('/request/')){parses++;return {job:{jobId:'remake_parse'}};}
      const data={...payload(),duration:0,game_mode:2,radiant_score:0,dire_score:0};
      return ++attempt===1?data:{...data,version:22,picks_bans:Array.from({length:10},(_,i)=>({is_pick:true,hero_id:i+1,team:i<5?0:1,order:i}))};
    }});
    await runResultBatch(f.db,{automatic:false,now:()=>at,fetchImpl});
    assert.equal(f.db.prepare('SELECT ResultStatus FROM TrackedLeagueMatches').get().ResultStatus,'remake');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchTeam').get().n,0);
    at=new Date(+at+3600000);await runResultBatch(f.db,{automatic:false,now:()=>at,fetchImpl});
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM RemakeDraftSources').get().n,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM SeriesMatch').get().n,0);
    assert.equal(parses,1);assert.equal(f.db.prepare('SELECT EnrichmentStatus FROM TrackedLeagueMatches').get().EnrichmentStatus,'not_applicable');
  }finally{f.close();}
});

test('long draft-only remakes are excluded regardless of lobby duration and retain their held draft',()=>{
  const f=fixture();try {
    const data={...payload(),duration:2841,game_mode:2,radiant_score:0,dire_score:0,version:22,
      picks_bans:Array.from({length:10},(_,i)=>({is_pick:true,hero_id:i+1,team:i<5?0:1,order:i}))};
    const result=importLeagueMatch(f.db,data,queued(f));
    assert.equal(result.remake,true);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchTeam').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchPlayer').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM SeriesMatch').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM RemakeDraftSources').get().n,1);
  }finally{f.close();}
});

test('nightly cleanup revisits ready zero-score imports and removes their results while retaining drafts and live observations',async()=>{
  const f=fixture();try {
    const data={...payload(1,{complete:true}),duration:2841,game_mode:2,radiant_score:0,dire_score:0,
      players:payload(1,{complete:true}).players.map(p=>({...p,kills:0,deaths:0,assists:0})),
      picks_bans:Array.from({length:10},(_,i)=>({is_pick:true,hero_id:i+1,team:i<5?0:1,order:i}))};
    // Reproduce the old import: a long 0–0 lobby with ten zero-kill players
    // already has a complete warehouse record and a credited series result.
    const job=queued(f);
    importLeagueMatch(f.db,{...data,radiant_score:1},job);
    enrichLeagueMatch(f.db,data,job);
    f.db.exec("UPDATE MatchLeague SET DatePlayed='2020-01-01';INSERT INTO LiveMatchSnapshots(MatchId,LeagueId,SnapshotHash) VALUES(1,100,'original')");
    assert.equal(f.db.prepare('SELECT Status FROM MatchIngestionState WHERE MatchId=1').get().Status,'ready');
    assert.equal(f.db.prepare('SELECT Wins FROM LeagueStandings WHERE TeamId=1001').get().Wins,1);
    f.db.exec("INSERT INTO LiveMatchCurrentState(MatchId,LeagueId,SnapshotHash) VALUES(1,100,'live')");
    assert.deepEqual(nightlyMatchCandidates(f.db,100),[],'Nightly must not clean a game still being observed live');
    f.db.exec('DELETE FROM LiveMatchCurrentState');
    const [candidate]=nightlyMatchCandidates(f.db,100);assert.equal(candidate.MatchId,1);
    const revision=f.db.prepare('SELECT RequestedRevision FROM BettingRefreshState').get().RequestedRevision;
    enqueueLeagueMatch(f.db,1,100,{nightly:true});
    const results=await runResultBatch(f.db,{automatic:false,fetchImpl:async()=>({ok:true,json:async()=>data})});
    assert.equal(results[0].remake,true);
    for(const table of ['MatchTeam','MatchPlayer','MatchTeamPlayer','MatchLeague','SeriesMatch','PickInfo',
      'MatchIngestionState','MatchSourceResponses','MatchPlayerTimeline','MatchTeamTimeline']) {
      assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE MatchId=1`).get().n,0,table);
    }
    assert.equal(f.db.prepare('SELECT ResultStatus FROM TrackedLeagueMatches WHERE MatchId=1').get().ResultStatus,'remake');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM RemakeDraftSources').get().n,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM LiveMatchSnapshots').get().n,1);
    assert.equal(f.db.prepare('SELECT Wins FROM LeagueStandings WHERE TeamId=1001').get().Wins,0);
    assert.equal(f.db.prepare('SELECT Team1Wins+Team2Wins n FROM SeriesLifecycle LIMIT 1').get().n,0);
    assert.ok(f.db.prepare('SELECT RequestedRevision FROM BettingRefreshState').get().RequestedRevision>revision);
    assert.deepEqual(nightlyMatchCandidates(f.db,100),[]);
  }finally{f.close();}
});

test('zero scores alone mark a remake even for an existing import with different saved statistics',()=>{
  for(const details of [{},{version:undefined,players:undefined}]) {
    const f=fixture();try {
      const job=queued(f),data=payload(1,{complete:true});
      importLeagueMatch(f.db,data,job);enrichLeagueMatch(f.db,data,job);
      const result=importLeagueMatch(f.db,{...data,...details,radiant_score:0,dire_score:0},job);
      assert.equal(result.remake,true);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchPlayer').get().n,0);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchTeam').get().n,0);
      assert.equal(f.db.prepare('SELECT ResultStatus FROM TrackedLeagueMatches WHERE MatchId=1').get().ResultStatus,'remake');
    }finally{f.close();}
  }
});

test('a game with a nonzero score on either side remains a played game',()=>{
  for(const [radiant_score,dire_score] of [[1,0],[0,1]]) {
    const f=fixture();try {
      const data={...payload(1,{complete:true}),radiant_score,dire_score};
      const result=importLeagueMatch(f.db,data,queued(f));enrichLeagueMatch(f.db,data,queued(f));
      assert.equal(result.imported,true);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchPlayer').get().n,10);
      assert.deepEqual(nightlyMatchCandidates(f.db,100),[]);
    }finally{f.close();}
  }
});
