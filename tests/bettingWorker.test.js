import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {engineFixture,preseasonFixture} from './helpers/bettingFixture.js';
import {BettingStore} from '../betting/store.js';
import {WORKER_BUSY_EXIT_CODE} from '../betting/workerLock.js';
import {updateMatchRecord} from '../config/matchRecordAdmin.js';
import {runBetting} from '../betting/engine.js';
import {randomUUID} from 'node:crypto';

// Real source rows for CLI rebuild/settlement tests. Existing engine fixtures
// otherwise contain only an already-published Analytics generation.
function seedSource(f) {
  f.league.exec(`ALTER TABLE LeagueSeasons ADD COLUMN SignupTitle TEXT;
    UPDATE LeagueSeasons SET SignupTitle='League signups';
    CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);
    CREATE TABLE MatchLeague(MatchId INTEGER PRIMARY KEY,LeagueId INTEGER,DatePlayed TEXT);
    CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER,Duration INTEGER,Rehost INTEGER,StartTimeUtc INTEGER);
    CREATE TABLE MatchTeamPlayer(MatchId INTEGER,PlayerId INTEGER,TeamId INTEGER);
    CREATE TABLE MatchPlayer(MatchId INTEGER,PlayerId INTEGER,HeroId INTEGER,Kills INTEGER,Deaths INTEGER,Assists INTEGER,
      Lasthits INTEGER,GPM INTEGER,XPM INTEGER,Networth INTEGER,HeroDamage INTEGER,TowerDamage INTEGER,Healing INTEGER);
    CREATE TABLE MatchSourceDetails(MatchId INTEGER PRIMARY KEY,StartedAtUtc TEXT,ObservedAtUtc TEXT);
    CREATE TABLE TeamRosterPlayers(TeamSubmissionId INTEGER,PlayerId INTEGER,Slot INTEGER);
    INSERT INTO TeamRosterPlayers SELECT * FROM SeasonTeamPlayers;
    CREATE TABLE TeamRosterPeriods(TeamSubmissionId INTEGER,EffectiveFrom TEXT,EffectiveTo TEXT,FromEstimated INTEGER);
    INSERT INTO TeamRosterPeriods VALUES(11,'2026-09-01T00:00:00Z',NULL,0),(12,'2026-09-01T00:00:00Z',NULL,0);
    CREATE TABLE GroupNames(LeagueId INTEGER,GroupId INTEGER,GroupName TEXT);
    INSERT INTO GroupNames VALUES(100,1,'Group A');
    CREATE TABLE LeagueGroups(LeagueId INTEGER,TeamId INTEGER,GroupId INTEGER);
    INSERT INTO LeagueGroups VALUES(100,1011111,1),(100,1022222,1);
    CREATE TABLE LeagueStandings(LeagueId INTEGER,TeamId INTEGER,Wins INTEGER,Losses INTEGER,PRIMARY KEY(LeagueId,TeamId));
    CREATE TABLE Neustadtl(LeagueId INTEGER,TeamId INTEGER,Score INTEGER,PRIMARY KEY(TeamId,LeagueId));
    CREATE TABLE LeagueStageBoundaries(LeagueId INTEGER PRIMARY KEY,GroupEndMatchId INTEGER,TieBreakerEndMatchId INTEGER);
    INSERT INTO LeagueStageBoundaries VALUES(100,1000,1000);
    CREATE TABLE GroupResultOverrides(LeagueId INTEGER,GroupId INTEGER,TeamA INTEGER,TeamB INTEGER,
      WinsA INTEGER,WinsB INTEGER,BaseWinsA INTEGER,BaseWinsB INTEGER);`);
  for(const p of f.analytics.prepare('SELECT PlayerId,PlayerName FROM PlayerFacts WHERE RunId=1').all())
    f.league.prepare('INSERT INTO PlayerInfo VALUES(?,?)').run(p.PlayerId,p.PlayerName);
  for(const g of f.analytics.prepare('SELECT * FROM MatchFacts WHERE RunId=1').all()) {
    f.league.prepare('INSERT INTO MatchLeague VALUES(?,100,?)').run(g.MatchId,g.StartedAtUtc);
    f.league.prepare('INSERT INTO MatchTeam VALUES(?,1011111,1022222,?,?,0,?)')
      .run(g.MatchId,g.WinnerTeamId,g.DurationSeconds,Date.parse(g.StartedAtUtc)/1000);
    f.league.prepare('INSERT INTO MatchSourceDetails VALUES(?,?,?)').run(g.MatchId,g.StartedAtUtc,g.SourceObservedAtUtc);
    for(const p of f.analytics.prepare('SELECT * FROM PlayerGameFacts WHERE RunId=1 AND MatchId=?').all(g.MatchId)) {
      f.league.prepare('INSERT INTO MatchTeamPlayer VALUES(?,?,?)').run(g.MatchId,p.PlayerId,p.TeamSubmissionId===11?1011111:1022222);
      f.league.prepare('INSERT INTO MatchPlayer VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(g.MatchId,p.PlayerId,p.HeroId,p.Kills,p.Deaths,p.Assists,p.LastHits,p.GPM,p.XPM,p.NetWorth,p.HeroDamage,p.TowerDamage,p.Healing);
    }
  }
}

const executeRaw=promisify(execFile);
const missingPublicPath=join(tmpdir(),`lads-worker-no-public-${randomUUID()}.db`);
// Worker fixtures explicitly exercise production gates, regardless of a
// developer's ignored .env enabling local test betting on their real checkout.
const execute=(command,args,options={})=>executeRaw(command,args,{...options,env:{...process.env,
  BETTING_LOCAL_TEST_MODE:'false',ANALYTICS_PUBLIC_DB:missingPublicPath,...options.env}});

test('locks recover exited owners immediately, protect live owners past lease expiry and retain legacy expiry behavior',async()=>{
  const f=engineFixture(),scratch=mkdtempSync(join(tmpdir(),'lads-worker-owner-'));let db;
  try {
    const path=join(scratch,'Betting.db');await f.betting.backup(path);
    const program=`import Database from 'better-sqlite3';import {BettingStore} from './betting/store.js';
      const db=new Database(process.argv[1]);const book=new BettingStore(db);console.log(book.acquireLock());db.close();`;
    const exited=await execute(process.execPath,['--input-type=module','-e',program,path],{windowsHide:true});
    const deadOwner=exited.stdout.trim();assert.ok(JSON.parse(deadOwner).pid>0);
    db=new Database(path);const book=new BettingStore(db);const recovered=book.acquireLock();
    assert.ok(recovered);assert.notEqual(recovered,deadOwner);
    db.prepare("UPDATE BettingWorkerLock SET LeaseUntilUtc='2000-01-01T00:00:00.000Z'").run();
    assert.equal(book.acquireLock(),null,'an active process retains its lock even for a long refresh');
    db.prepare('DELETE FROM BettingWorkerLock').run();
    db.prepare('INSERT INTO BettingWorkerLock VALUES(1,?,?)').run('legacy-owner',new Date(Date.now()+600000).toISOString());
    assert.equal(book.acquireLock(),null);
    db.prepare("UPDATE BettingWorkerLock SET LeaseUntilUtc='2000-01-01T00:00:00.000Z'").run();
    assert.ok(book.acquireLock());
  }finally{db?.close();f.close();if(dirname(resolve(scratch))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');rmSync(scratch,{recursive:true,force:true});}
});

test('a competing real worker defers before Analytics rebuild and later completes its pending revision',async()=>{
  const f=engineFixture(),scratch=mkdtempSync(join(tmpdir(),'lads-worker-contention-'));let league,analytics,betting;
  try {
    seedSource(f);
    const owner=f.book.acquireLock();assert.ok(owner);
    const paths={league:join(scratch,'LadsData.db'),analytics:join(scratch,'Analytics.db'),betting:join(scratch,'Betting.db')};
    await f.league.backup(paths.league);await f.analytics.backup(paths.analytics);await f.betting.backup(paths.betting);
    const args=['scripts/betting/run.js','--league-db',paths.league,'--analytics-db',paths.analytics,'--betting-db',paths.betting];
    await assert.rejects(execute(process.execPath,[...args,'--refresh-analytics'],{windowsHide:true}),error=>
      error.code===WORKER_BUSY_EXIT_CODE&&error.stdout.includes('refresh deferred')&&!error.stderr.includes('Betting job failed'));
    league=new Database(paths.league);analytics=new Database(paths.analytics);betting=new Database(paths.betting);
    const pending=league.prepare('SELECT * FROM BettingRefreshState').get();
    assert.ok(pending.RequestedRevision>pending.CompletedRevision);assert.equal(pending.ConsecutiveFailures,0);assert.equal(pending.LastErrorCode,null);
    assert.ok(pending.AnalyticsRequestedRevision>pending.CompletedRevision);
    assert.equal(analytics.prepare('SELECT COUNT(*) n FROM AnalyticsRuns').get().n,1);
    assert.equal(betting.prepare('SELECT Owner FROM BettingWorkerLock').get().Owner,owner);
    betting.prepare('DELETE FROM BettingWorkerLock WHERE Owner=?').run(owner);
    await execute(process.execPath,args,{windowsHide:true});
    const complete=league.prepare('SELECT * FROM BettingRefreshState').get();assert.equal(complete.RequestedRevision,complete.CompletedRevision);
    assert.ok(complete.CompletedRevision>=complete.AnalyticsRequestedRevision);
    assert.equal(analytics.prepare('SELECT COUNT(*) n FROM AnalyticsRuns').get().n,2);
    assert.equal(betting.prepare('SELECT COUNT(*) n FROM BettingWorkerLock').get().n,0);
  }finally{league?.close();analytics?.close();betting?.close();f.close();if(dirname(resolve(scratch))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');rmSync(scratch,{recursive:true,force:true});}
});

test('a corrected second-game identity rebuilds Analytics and settles the closed BO2 through the ordinary queued worker',async()=>{
  const f=engineFixture(),scratch=mkdtempSync(join(tmpdir(),'lads-worker-corrected-series-'));let league,analytics,betting;
  try {
    seedSource(f);f.league.exec('ALTER TABLE SeriesInfo ADD COLUMN DateCreated TEXT');
    const now=new Date(),opened=new Date(now.getTime()-86400000),kickoff=new Date(now.getTime()-3*3600000);
    const game2=new Date(kickoff.getTime()+3600000),observed=new Date(now.getTime()-600000).toISOString();
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(kickoff);
    f.analytics.prepare('UPDATE AnalyticsRuns SET AsOfUtc=?').run(opened.toISOString());
    f.analytics.prepare('UPDATE SourceSnapshots SET LastSuccessAtUtc=?').run(opened.toISOString());
    f.book.now=()=>opened;
    const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:kickoff.toISOString()},'admin',opened);
    runBetting({...f,now:opened,simulations:50});
    const selection=f.betting.prepare(`SELECT s.SelectionId,s.OfferedMicros,m.QuoteVersion FROM BettingSelections s
      JOIN BettingMarkets m USING(MarketId) WHERE m.EventId=? AND m.MarketType='series_winner' AND s.OutcomeKey='draw'`).get(event.EventId);
    assert.ok(selection);
    const ticket=f.book.accept('99',{seasonId:1,stake:100,requestKey:'corrected_series_draw',
      legs:[{selectionId:selection.SelectionId,quoteVersion:selection.QuoteVersion}]});
    for(const [id,start,seriesId] of [[1,kickoff,900],[2,game2,901]]) {
      const teamRad=id===1?1011111:9999999,winner=id===1?1011111:1022222;
      f.league.prepare('INSERT INTO SeriesInfo VALUES(?,?,?,?,?,?)').run(seriesId,teamRad,1022222,100,'g',day);
      f.league.prepare('INSERT INTO SeriesMatch VALUES(?,?)').run(seriesId,id);
      f.league.prepare('UPDATE MatchTeam SET TeamRad=?,WinnerId=?,StartTimeUtc=? WHERE MatchId=?')
        .run(teamRad,winner,start.getTime()/1000,id);
      f.league.prepare('UPDATE MatchTeamPlayer SET TeamId=? WHERE MatchId=? AND PlayerId<=5').run(teamRad,id);
      f.league.prepare('UPDATE MatchSourceDetails SET StartedAtUtc=?,ObservedAtUtc=? WHERE MatchId=?').run(start.toISOString(),observed,id);
      f.analytics.prepare('UPDATE MatchFacts SET SeriesId=?,StartedAtUtc=?,WinnerTeamId=? WHERE MatchId=?')
        .run(seriesId,start.toISOString(),winner,id);
    }
    runBetting({...f,now,simulations:50});
    assert.equal(f.schedules.get(event.EventId).SeriesId,900);
    assert.notEqual(f.schedules.get(event.EventId).Status,'completed');
    assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status,'pending');
    updateMatchRecord(f.league,{matchId:2,teamRad:1011111,teamDire:1022222,winnerId:1022222,
      originalTeamRad:9999999,originalTeamDire:1022222,leagueId:100});
    assert.deepEqual(f.league.prepare('SELECT MatchId FROM SeriesMatch WHERE SeriesId=900 ORDER BY MatchId').all(),[{MatchId:1},{MatchId:2}]);
    const queued=f.league.prepare('SELECT * FROM BettingRefreshState').get();assert.ok(queued.AnalyticsRequestedRevision>queued.CompletedRevision);
    // These are still the old facts. A normal CLI invocation must rebuild them.
    assert.equal(f.analytics.prepare('SELECT SeriesId FROM MatchFacts WHERE MatchId=2').get().SeriesId,901);
    const paths={league:join(scratch,'LadsData.db'),analytics:join(scratch,'Analytics.db'),betting:join(scratch,'Betting.db')};
    await f.league.backup(paths.league);await f.analytics.backup(paths.analytics);await f.betting.backup(paths.betting);
    const args=['scripts/betting/run.js','--league-db',paths.league,'--analytics-db',paths.analytics,'--betting-db',paths.betting];
    const result=JSON.parse((await execute(process.execPath,args,{windowsHide:true})).stdout);assert.ok(result.marketsSettled>0);
    league=new Database(paths.league);analytics=new Database(paths.analytics);betting=new Database(paths.betting);
    assert.equal(league.prepare('SELECT Status FROM ScheduledEvents WHERE EventId=?').get(event.EventId).Status,'completed');
    assert.equal(analytics.prepare('SELECT SeriesId FROM MatchFacts WHERE RunId=(SELECT PublishedRunId FROM AnalyticsState) AND MatchId=2').get().SeriesId,900);
    assert.equal(betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status,'won');
    assert.equal(betting.prepare('SELECT AcceptedMicros FROM BettingTicketLegs WHERE TicketId=?').get(ticket.ticketId).AcceptedMicros,selection.OfferedMicros);
    const ledgerCount=()=>betting.prepare('SELECT COUNT(*) n FROM BettingLedger').get().n;
    const afterSettlement=ledgerCount();await execute(process.execPath,args,{windowsHide:true});assert.equal(ledgerCount(),afterSettlement);
    assert.equal(analytics.prepare('SELECT COUNT(*) n FROM AnalyticsRuns').get().n,2,'routine repeats do not rebuild Analytics');
    // Winner-only corrections follow the same path and reconcile the old payout.
    updateMatchRecord(league,{matchId:2,teamRad:1011111,teamDire:1022222,winnerId:1011111,
      originalTeamRad:1011111,originalTeamDire:1022222,leagueId:100});
    await execute(process.execPath,args,{windowsHide:true});
    assert.equal(betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status,'lost');
    assert.equal(betting.prepare("SELECT BalanceCents FROM BettingWallets WHERE SeasonId=1 AND UserId='99'").get().BalanceCents,990000);
    const afterCorrection=ledgerCount();await execute(process.execPath,args,{windowsHide:true});assert.equal(ledgerCount(),afterCorrection);
  }finally{league?.close();analytics?.close();betting?.close();f.close();if(dirname(resolve(scratch))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');rmSync(scratch,{recursive:true,force:true});}
});

test('real worker migrates older refresh state, preserves a failed pending revision and recovers on the next successful run',async()=>{
  const f=engineFixture(),scratch=mkdtempSync(join(tmpdir(),'lads-worker-recovery-'));let league;
  try {
    f.league.exec(`DROP TABLE BettingRefreshState;DROP TABLE DiscordSchedulePollLocks;
      CREATE TABLE BettingRefreshState(Id INTEGER PRIMARY KEY,RequestedRevision INTEGER NOT NULL DEFAULT 0,CompletedRevision INTEGER NOT NULL DEFAULT 0,RequestedAtUtc TEXT);
      INSERT INTO BettingRefreshState VALUES(1,7,2,'2026-10-13T12:00:00Z');`);
    const paths={league:join(scratch,'LadsData.db'),analytics:join(scratch,'Analytics.db'),betting:join(scratch,'Betting.db')};
    await f.league.backup(paths.league);await f.analytics.backup(paths.analytics);await f.betting.backup(paths.betting);
    const args=['scripts/betting/run.js','--league-db',paths.league,'--betting-db',paths.betting,'--analytics-db',paths.analytics];
    await execute(process.execPath,[...args,'--init-only'],{windowsHide:true});
    league=new Database(paths.league);
    assert.equal(league.prepare('SELECT RequestedRevision FROM BettingRefreshState').get().RequestedRevision,7);
    assert.ok(league.pragma('table_info(BettingRefreshState)').some(c=>c.name==='LastErrorCode'));
    assert.equal(league.prepare('SELECT AnalyticsRequestedRevision FROM BettingRefreshState').get().AnalyticsRequestedRevision,0);
    assert.ok(league.prepare("SELECT 1 FROM sqlite_master WHERE name='DiscordSchedulePollLocks'").get());
    await assert.rejects(execute(process.execPath,[...args,'--analytics-db',join(scratch,'missing.db')],{windowsHide:true}),error=>error.code===1);
    const failed=league.prepare('SELECT * FROM BettingRefreshState').get();assert.equal(failed.RequestedRevision,8);assert.equal(failed.CompletedRevision,2);
    assert.equal(failed.LastErrorCode,'refresh_failed');assert.ok(failed.LastAttemptAtUtc);
    const afterFailure=new Database(paths.betting,{readonly:true});assert.equal(afterFailure.prepare('SELECT COUNT(*) n FROM BettingWorkerLock').get().n,0);afterFailure.close();
    const result=await execute(process.execPath,['--max-old-space-size=256',...args],{windowsHide:true});
    const output=JSON.parse(result.stdout);assert.ok(output.resources.peakRssBytes>0);assert.ok(output.resources.heapUsedBytes>0);
    const recovered=league.prepare('SELECT * FROM BettingRefreshState').get();assert.equal(recovered.RequestedRevision,recovered.CompletedRevision);
    assert.equal(recovered.LastErrorCode,null);assert.equal(recovered.ConsecutiveFailures,0);assert.ok(recovered.LastCompletedAtUtc);
    assert.equal(league.prepare('SELECT COUNT(*) AS n FROM SeasonTeams').get().n,2);
    assert.equal(f.league.prepare('SELECT RequestedRevision FROM BettingRefreshState').get().RequestedRevision,7);
  }finally{league?.close();f.close();if(dirname(resolve(scratch))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');rmSync(scratch,{recursive:true,force:true});}
});

test('worker publication under a bounded Node heap reports resource use without exposing private inputs',async t=>{
  const f=preseasonFixture([4,5]),scratch=mkdtempSync(join(tmpdir(),'lads-worker-memory-'));
  try {
    // Shift the fixture together so this exercises publication on any CI date.
    const shift=Date.now()-Date.parse('2026-10-13T12:00:00.000Z');
    const shifted=value=>value?new Date(Date.parse(value)+shift).toISOString():null;
    for(const [db,table,columns] of [[f.analytics,'AnalyticsRuns',['StartedAtUtc','AsOfUtc']],
      [f.analytics,'SourceSnapshots',['StartedAtUtc','LastSuccessAtUtc']],
      [f.analytics,'MatchFacts',['StartedAtUtc','RecordedDate','SourceObservedAtUtc']],
      [f.analytics,'RosterMembership',['EffectiveFromUtc','EffectiveToUtc']],
      [f.league,'ScheduledEvents',['ScheduledStartUtc','CreatedAtUtc','UpdatedAtUtc']],
      [f.league,'SeasonBettingSetup',['FinalizedAtUtc','UpdatedAtUtc']]]) {
      const available=columns.filter(name=>db.pragma(`table_info(${table})`).some(c=>c.name===name));
      for(const row of db.prepare(`SELECT rowid AS id,${available.join(',')} FROM ${table}`).all())
        db.prepare(`UPDATE ${table} SET ${available.map(name=>`${name}=?`).join(',')} WHERE rowid=?`).run(...available.map(name=>shifted(row[name])),row.id);
    }
    const paths={league:join(scratch,'LadsData.db'),analytics:join(scratch,'Analytics.db'),betting:join(scratch,'Betting.db')};
    await f.league.backup(paths.league);await f.analytics.backup(paths.analytics);await f.betting.backup(paths.betting);
    const {stdout}=await execute(process.execPath,['--max-old-space-size=256','scripts/betting/run.js','--league-db',paths.league,
      '--analytics-db',paths.analytics,'--betting-db',paths.betting],{windowsHide:true});
    const result=JSON.parse(stdout);assert.ok(result.marketsOpened>100);assert.ok(result.resources.peakRssBytes>0);assert.ok(result.resources.elapsedMs>=0);
    for(const privateField of ['SignupMMR','privatePlayerFeatures','InputJson','ForecastJson'])assert.equal(stdout.includes(privateField),false);
    t.diagnostic(JSON.stringify({peakRssMB:Math.round(result.resources.peakRssBytes/1048576),heapMB:Math.round(result.resources.heapUsedBytes/1048576),elapsedMs:result.resources.elapsedMs,
      markets:result.marketsOpened,note:'Isolated local 9-team/45-player fixture; not a full application or production-host budget.'}));
  }finally{f.close();if(dirname(resolve(scratch))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');rmSync(scratch,{recursive:true,force:true});}
});
