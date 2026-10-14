import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {engineFixture,preseasonFixture} from './helpers/bettingFixture.js';

const execute=promisify(execFile);
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
    assert.ok(league.prepare("SELECT 1 FROM sqlite_master WHERE name='DiscordSchedulePollLocks'").get());
    await assert.rejects(execute(process.execPath,[...args,'--analytics-db',join(scratch,'missing.db')],{windowsHide:true}),error=>error.code===1);
    const failed=league.prepare('SELECT * FROM BettingRefreshState').get();assert.equal(failed.RequestedRevision,8);assert.equal(failed.CompletedRevision,2);
    assert.equal(failed.LastErrorCode,'refresh_failed');assert.ok(failed.LastAttemptAtUtc);
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
