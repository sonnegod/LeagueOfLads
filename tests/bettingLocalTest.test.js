import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {preseasonFixture} from './helpers/bettingFixture.js';
import {BettingStore} from '../betting/store.js';
import {localBettingTestMode,bettingDatabasePath} from '../betting/localTestPolicy.js';
import {prepareLocalTestSeason} from '../betting/prepareLocalTest.js';
import {buildLocalTestInputs} from '../betting/localTestInputs.js';
import {runBetting,seasonGuard,fixtureGuard} from '../betting/engine.js';
import {createBettingRoutes} from '../routes/bettingRoutes.js';
const now=new Date('2026-10-13T12:00:00Z');
const environment=()=>({ENVIRONMENT:'DEV',NODE_ENV:'development',BETTING_LOCAL_TEST_MODE:'true'});

test('local testing requires explicit development, isolated paths and a database that cannot be reopened as production',()=>{
  assert.equal(localBettingTestMode({ENVIRONMENT:'DEV'}),false);
  assert.equal(localBettingTestMode(environment()),true);
  for(const env of [{...environment(),ENVIRONMENT:'PROD'},{...environment(),NODE_ENV:'production'}])
    assert.throws(()=>localBettingTestMode(env),/cannot run in production/);
  const source=resolve('db/LadsData.db'),normal=resolve('db/Betting.db');
  assert.equal(bettingDatabasePath(source,environment()),resolve('db/Betting-local-test.db'));
  assert.throws(()=>bettingDatabasePath(source,{...environment(),BETTING_LOCAL_TEST_DB:normal}),/separate/);
  assert.throws(()=>bettingDatabasePath(source,{...environment(),BETTING_LOCAL_TEST_DB:source}),/separate/);
  const db=new Database(':memory:');
  try {
    new BettingStore(db,{env:environment()});
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='BettingLocalTestMetadata'").get());
    assert.throws(()=>new BettingStore(db,{env:{ENVIRONMENT:'PROD'}}),/cannot be used outside/);
  }finally{db.close();}
  const normalDb=new Database(':memory:');try {
    const book=new BettingStore(normalDb,{env:{}});
    book.publish({seasonId:1,type:'champion',stage:'playoff',title:'Normal market'},[{key:'a',label:'A',probability:.5},{key:'b',label:'B',probability:.5}],1,'2099-01-01T00:00:00Z');
    assert.throws(()=>new BettingStore(normalDb,{env:environment()}),/Refusing to convert/);
    assert.throws(()=>book.publish({seasonId:1,type:'champion',stage:'playoff',title:'Test',rules:{localTesting:true}},[],1,'2099-01-01T00:00:00Z'),/dedicated development/);
  }finally{normalDb.close();}
});

test('local preparation is idempotent, preserves league stage and hides test fixtures from normal scheduling',()=>{
  const f=preseasonFixture();try {
    f.league.exec('DELETE FROM ScheduleEventRevisions;DELETE FROM ScheduledEvents');
    const first=prepareLocalTestSeason(f.schedules,2,now,environment()),second=prepareLocalTestSeason(f.schedules,2,now,environment());
    assert.equal(first.createdFixture,true);assert.equal(second.createdFixture,false);assert.equal(first.fixtureId,second.fixtureId);
    assert.equal(f.schedules.list(2).length,0);assert.equal(f.schedules.list(2,{includeLocalTests:true}).length,1);
    assert.equal(f.league.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId=2').get().Status,'signup_closed');
    assert.equal(fixtureGuard(f.league,first.fixtureId,{EventRevision:1},now,{}),'Local test fixtures are disabled');
    assert.equal(fixtureGuard(f.league,first.fixtureId,{EventRevision:1},now,environment()),null);
  }finally{f.close();}
});

test('local wagers retain auth, caps, quote, roster/setup and kickoff checks while ordinary source gates stay closed',async()=>{
  const f=preseasonFixture(),local=new Database(':memory:'),env=environment();
  const scratch=mkdtempSync(join(tmpdir(),'lads-local-betting-'));let server;
  try {
    const book=new BettingStore(local,{env,now:()=>now}),sourceBefore=f.betting.prepare('SELECT COUNT(*) n FROM BettingTickets').get().n;
    f.analytics.exec("UPDATE SourceSnapshots SET LatestStatus='error',LastSuccessAtUtc='2025-01-01T00:00:00Z';UPDATE RosterMembership SET FromEstimated=1,EffectiveFromUtc=NULL WHERE TeamSubmissionId>=21");
    const players=f.league.prepare('SELECT PlayerId FROM SeasonTeamPlayers WHERE TeamSubmissionId>=21').all();
    const history=players.flatMap(p=>Array.from({length:8},(_,i)=>({PlayerId:p.PlayerId,MatchId:i+1,LeagueId:100,Stage:'regular',Won:i%2,
      StartedAtUtc:`2026-10-0${i+1}T00:00:00Z`,SourceObservedAtUtc:'2026-10-12T00:00:00Z',DurationSeconds:2000,PatchKey:'7.40',LaneRole:1,
      Kills:10,Deaths:5,Assists:15,LastHits:200,GPM:500,XPM:600,HeroDamage:20000,TowerDamage:1000,Healing:100})));
    const builder=(inputs,at)=>buildLocalTestInputs(f.league,inputs,at,{env,readHistory:()=>({history,reports:[]})});
    const result=runBetting({...f,book,seasonId:2,now,simulations:100,localTestInputBuilder:builder});
    assert.ok(result.marketsOpened>100);assert.ok(result.issues.includes('local_test_only'));
    assert.equal(local.prepare('SELECT COUNT(*) n FROM BettingMarkets WHERE json_extract(RulesJson,\'$.localTesting\')!=1').get().n,0);
    const analyticsPath=join(scratch,'Analytics.db');await f.analytics.backup(analyticsPath);
    book.eventGuard=(id,m)=>fixtureGuard(f.league,id,m,now,env);
    book.seasonGuard=(sid,m)=>seasonGuard(f.league,analyticsPath,sid,m,now,null,env);
    const app=express();app.use(express.json());app.use((req,res,next)=>{req.isAuthenticated=()=>req.headers['x-test-user']==='99';req.user={id:'76561197960265827'};next();});
    app.use('/betting',createBettingRoutes({book,league:f.league,schedules:f.schedules,analyticsPath,refresh:()=>{}}).publicRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
    const base=`http://127.0.0.1:${server.address().port}/betting`,headers={'Content-Type':'application/json','x-test-user':'99'};
    const meta=await(await fetch(`${base}/meta`)).json();
    assert.equal(meta.localTesting,true);assert.equal(meta.stakeCap,null);
    assert.equal((await fetch(`${base}/wallet?seasonId=2`)).status,401);
    const dto=await(await fetch(`${base}/markets?seasonId=2&view=team`)).json(),market=dto.teamGroups[0].teams[0].wins;
    assert.equal(market.status,'open');
    const series=await(await fetch(`${base}/markets?seasonId=2&view=series`)).json();
    assert.ok(series.markets.some(m=>m.type==='player_prop'&&m.status==='open'));
    const row=local.prepare('SELECT * FROM BettingMarkets WHERE MarketId=?').get(market.marketId);
    const ordinary={...row,RulesJson:JSON.stringify({...JSON.parse(row.RulesJson),localTesting:false})};
    assert.match(seasonGuard(f.league,analyticsPath,2,ordinary,now,null,env),/source data needs refreshing/);
    const post=(key,stake=100,version=market.quoteVersion)=>fetch(`${base}/tickets`,{method:'POST',headers,body:JSON.stringify({seasonId:2,stake,requestKey:key,
      legs:[{selectionId:market.selections[0].selectionId,quoteVersion:version}]})});
    assert.equal((await post('local_valid_ticket')).status,201);assert.equal(book.wallet(2,'99').balance,9900);
    assert.equal((await post('local_bad_stake_01','0.001')).status,400);
    let current=local.prepare('SELECT QuoteVersion FROM BettingMarkets WHERE MarketId=?').get(row.MarketId).QuoteVersion;
    assert.equal((await post('local_large_ticket',2500,current)).status,201);assert.equal(book.wallet(2,'99').balance,7400);
    current=local.prepare('SELECT QuoteVersion FROM BettingMarkets WHERE MarketId=?').get(row.MarketId).QuoteVersion;
    assert.equal((await post('local_stale_quote',100,current-1)).status,409);
    local.prepare('UPDATE BettingWallets SET BalanceCents=0 WHERE SeasonId=2 AND UserId=?').run('99');
    const balance=await post('local_insufficient_balance',100,current);assert.equal(balance.status,409);assert.equal((await balance.json()).code,'INSUFFICIENT_BALANCE');
    local.prepare('UPDATE BettingWallets SET BalanceCents=990000 WHERE SeasonId=2 AND UserId=?').run('99');
    f.league.exec('UPDATE SeasonTeamPlayers SET Slot=9 WHERE TeamSubmissionId=21 AND Slot=0');
    assert.match(await(await post('local_changed_setup',100,current)).text(),/League setup changed/);
    f.league.exec('UPDATE SeasonTeamPlayers SET Slot=0 WHERE TeamSubmissionId=21 AND Slot=9');
    env.BETTING_LOCAL_TEST_MODE='false';assert.match(await(await post('local_disabled_ticket',100,current)).text(),/Local test markets are disabled/);
    env.BETTING_LOCAL_TEST_MODE='true';
    const event=f.schedules.list(2)[0];f.schedules.save(2,{eventId:event.EventId,revision:event.Revision,team1Key:event.Team1Key,team2Key:event.Team2Key,
      stage:'regular',bestOf:2,scheduledStartUtc:event.ScheduledStartUtc,status:'started'},'1',now);
    assert.equal((await post('local_after_kickoff',100,current)).status,409);assert.equal(book.wallet(2,'99').balance,9900);
    assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingTickets').get().n,sourceBefore);
  }finally {
    if(server)await new Promise(done=>server.close(done));local.close();f.close();
    if(dirname(resolve(scratch))!==resolve(tmpdir()))throw new Error('Unexpected test cleanup path');rmSync(scratch,{recursive:true,force:true});
  }
});
