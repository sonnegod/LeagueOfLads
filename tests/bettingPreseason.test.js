import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { preseasonFixture } from './helpers/bettingFixture.js';
import { runBetting, fixtureGuard, seasonGuard } from '../betting/engine.js';
import { lockDueMarkets } from '../betting/marketTiming.js';
import { createBettingRoutes } from '../routes/bettingRoutes.js';

const now=new Date('2026-10-13T12:00:00.000Z');
const refresh=f=>runBetting({...f,seasonId:2,now,simulations:100});
const market=f=>f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_team' LIMIT 1").get();
const wager=(f,m,key)=>f.book.accept('99',{seasonId:2,stake:100,requestKey:key,
  legs:[{selectionId:f.betting.prepare('SELECT SelectionId FROM BettingSelections WHERE MarketId=? LIMIT 1').get(m.MarketId).SelectionId,
    quoteVersion:m.QuoteVersion}]});
function removeSchedule(f) {f.league.exec('DELETE FROM ScheduledEvents WHERE SeasonId=2');}
async function analyticsBackup(f,scratch) {
  const path=join(scratch,'Analytics.db');await f.analytics.backup(path);
  f.book.eventGuard=(id,m)=>fixtureGuard(f.league,id,m,f.book.now());
  f.book.seasonGuard=(id,m)=>seasonGuard(f.league,path,id,m,f.book.now());
  return path;
}
function cleanup(f,scratch) {
  f.close();if(dirname(resolve(scratch))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');
  rmSync(scratch,{recursive:true,force:true});
}

test('finalized preseason without any fixtures opens every supported market type, survives locking, and accepts a public quote',async()=>{
  const f=preseasonFixture(),scratch=mkdtempSync(join(tmpdir(),'lads-unscheduled-preseason-'));let server;
  try {
    removeSchedule(f);
    f.analytics.exec('UPDATE PlayerGameFacts SET PlayerId=210 WHERE PlayerId=1; UPDATE PlayerGameFacts SET PlayerId=211 WHERE PlayerId=2;');
    const result=refresh(f);
    assert.ok(result.marketsOpened>100);assert.deepEqual(result.issues,[]);
    const types=f.betting.prepare('SELECT DISTINCT MarketType FROM BettingMarkets WHERE SeasonId=2').all().map(row=>row.MarketType);
    for(const type of ['season_player','season_team','player_leader','champion','placement'])assert.ok(types.includes(type),type);
    assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingMarkets WHERE EventId IS NOT NULL').get().n,0);
    assert.equal(lockDueMarkets(f.betting,now).changes,0);
    const analyticsPath=await analyticsBackup(f,scratch),app=express();app.use(express.json());
    app.use((req,res,next)=>{req.isAuthenticated=()=>req.headers['x-test-user']==='99';req.user={id:'76561197960265827'};next();});
    app.use('/betting',createBettingRoutes({...f,analyticsPath,refresh:()=>{}}).publicRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
    const base=`http://127.0.0.1:${server.address().port}/betting`;
    const dto=await(await fetch(`${base}/markets?seasonId=2&view=team`)).json();
    const offered=dto.teamGroups[0].teams[0].wins;
    assert.equal(offered.status,'open');assert.equal(offered.closeAt,null);assert.equal(offered.notice,null);
    const quotes=await(await fetch(`${base}/quotes?ids=${offered.selections[0].selectionId}`)).json();
    assert.equal(quotes.quotes[0].status,'open');
    const request={seasonId:2,stake:100,requestKey:'unscheduled_preseason_01',
      legs:[{selectionId:offered.selections[0].selectionId,quoteVersion:offered.quoteVersion}]};
    assert.equal((await fetch(`${base}/tickets`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)})).status,401);
    const placed=await fetch(`${base}/tickets`,{method:'POST',headers:{'Content-Type':'application/json','x-test-user':'99'},body:JSON.stringify(request)});
    assert.equal(placed.status,201);assert.equal(f.book.wallet(2,'99').balance,9900);
    assert.equal(refresh(f).marketsOpened,0);
    assert.equal(market(f).Status,'open');
  } finally {if(server)await new Promise(done=>server.close(done));cleanup(f,scratch);}
});

test('fixed preseason recovery without any fixtures clears an obsolete cutoff without rebuilding history or changing prices',()=>{
  const f=preseasonFixture();
  try {
    refresh(f);
    const prices=f.betting.prepare(`SELECT s.* FROM BettingSelections s JOIN BettingMarkets m USING(MarketId)
      WHERE m.SeasonId=2 AND m.EventId IS NULL ORDER BY s.SelectionId`).all();
    removeSchedule(f);
    f.betting.exec(`UPDATE BettingMarkets SET Status='locked',CloseAtUtc='2026-10-12T01:00:00.000Z',
      RulesJson=json_remove(RulesJson,'$.frozenPreseason') WHERE SeasonId=2 AND EventId IS NULL`);
    const result=runBetting({...f,seasonId:2,now,simulations:100,preservePreseason:true,
      historicalInputBuilder:()=>{throw Error('No history rebuild should run');}});
    assert.deepEqual(result.issues,[]);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE SeasonId=2 AND EventId IS NULL AND (Status!='open' OR CloseAtUtc!='')").get().n,0);
    assert.deepEqual(f.betting.prepare(`SELECT s.* FROM BettingSelections s JOIN BettingMarkets m USING(MarketId)
      WHERE m.SeasonId=2 AND m.EventId IS NULL ORDER BY s.SelectionId`).all(),prices);
    f.league.exec('UPDATE SeasonTeams SET GroupId=9 WHERE TeamSubmissionId=21');
    runBetting({...f,seasonId:2,now,simulations:100,preservePreseason:true});
    assert.equal(market(f).Status,'held');
  }finally{f.close();}
});

test('adding or removing the first kickoff updates existing preseason quotes without changing accepted tickets or lines',async()=>{
  const f=preseasonFixture(),scratch=mkdtempSync(join(tmpdir(),'lads-preseason-kickoff-'));
  try {
    removeSchedule(f);refresh(f);await analyticsBackup(f,scratch);
    const original=market(f);wager(f,original,'before_schedule_01');
    const accepted=f.betting.prepare('SELECT * FROM BettingTicketLegs').all();
    const kickoff='2026-10-13T13:00:00.000Z';
    f.schedules.save(2,{team1Key:21,team2Key:22,stage:'regular',bestOf:2,scheduledStartUtc:kickoff},'1',now);
    refresh(f);const timed=market(f);
    assert.equal(timed.MarketId,original.MarketId);assert.equal(timed.Line,original.Line);assert.equal(timed.CloseAtUtc,kickoff);
    assert.ok(timed.QuoteVersion>original.QuoteVersion);
    assert.deepEqual(f.betting.prepare('SELECT * FROM BettingTicketLegs').all(),accepted);
    // Scheduled series still require a close time; missing or invalid times fail.
    const forecast=f.betting.prepare('SELECT ForecastId FROM BettingForecasts LIMIT 1').get().ForecastId;
    assert.throws(()=>f.book.publish({seasonId:2,eventId:1,type:'series_winner'},[],forecast,null),/valid close time/);
    assert.throws(()=>f.book.publish({seasonId:2,type:'champion'},[],forecast,'invalid'),/valid close time/);
    removeSchedule(f);refresh(f);const untimed=market(f);
    assert.equal(untimed.CloseAtUtc,'');assert.ok(untimed.QuoteVersion>timed.QuoteVersion);
    assert.equal(f.book.seasonGuard(2,untimed),null);assert.equal(lockDueMarkets(f.betting,now).changes,0);
    assert.deepEqual(f.betting.prepare('SELECT * FROM BettingTicketLegs').all(),accepted);
  } finally {cleanup(f,scratch);}
});

test('a known first kickoff still closes preseason synchronously and through the locking job',async()=>{
  const f=preseasonFixture(),scratch=mkdtempSync(join(tmpdir(),'lads-preseason-lock-'));
  try {
    const kickoff='2026-10-13T13:00:00.000Z';
    f.league.prepare('UPDATE ScheduledEvents SET ScheduledStartUtc=? WHERE SeasonId=2').run(kickoff);
    refresh(f);await analyticsBackup(f,scratch);const before=market(f);
    assert.equal(before.CloseAtUtc,kickoff);assert.equal(f.book.seasonGuard(2,before),null);
    f.book.now=()=>new Date(kickoff);
    assert.equal(f.book.seasonGuard(2,before),'Preseason betting is closed');
    assert.throws(()=>wager(f,before,'after_known_kickoff'),{code:'MARKET_CLOSED'});
    assert.ok(lockDueMarkets(f.betting,new Date(kickoff)).changes>0);
    assert.equal(market(f).Status,'locked');
  } finally {cleanup(f,scratch);}
});

test('without a schedule, live games and imported results close preseason before Analytics catches up',async()=>{
  for(const signal of ['live','unlinked_result','linked_result','started_fixture']) {
    const f=preseasonFixture(),scratch=mkdtempSync(join(tmpdir(),'lads-preseason-start-'));
    try {
      removeSchedule(f);refresh(f);await analyticsBackup(f,scratch);const before=market(f);
      assert.equal(f.book.seasonGuard(2,before),null);
      if(signal==='live')f.league.exec('CREATE TABLE LiveMatchCurrentState(LeagueId INTEGER);INSERT INTO LiveMatchCurrentState VALUES(200)');
      else if(signal==='unlinked_result')f.league.exec('CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER);INSERT INTO MatchLeague VALUES(9000,200)');
      else if(signal==='linked_result')f.league.exec("INSERT INTO SeriesInfo VALUES(900,2000021,2000022,200,'g');INSERT INTO SeriesMatch VALUES(900,9000)");
      else f.schedules.save(2,{team1Key:21,team2Key:22,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-13T13:00:00Z',status:'started'},'1',now);
      assert.equal(f.book.seasonGuard(2,before),'Preseason betting is closed',signal);
      assert.throws(()=>wager(f,before,`late_preseason_${signal}`),{code:'MARKET_HELD'});
      assert.equal(refresh(f).marketsOpened,0);
      assert.equal(market(f).Status,'locked',signal);
    } finally {cleanup(f,scratch);}
  }
});

test('cancelled, forfeited and replaced fixtures do not block preseason without a remaining kickoff',()=>{
  for(const status of ['cancelled','forfeit','replaced']) {
    const f=preseasonFixture();
    try {
      f.league.prepare('UPDATE ScheduledEvents SET Status=? WHERE SeasonId=2').run(status);
      assert.ok(refresh(f).marketsOpened>100,status);assert.equal(market(f).CloseAtUtc,'',status);
    } finally {f.close();}
  }
});
