import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {engineFixture} from './helpers/bettingFixture.js';
import {runBetting} from '../betting/engine.js';
import {ODDS_SCALE} from '../betting/pricing.js';
import {readUpcomingSweepOdds} from '../betting/upcomingOdds.js';
import {createUpcomingGamesRouter} from '../routes/upcomingGamesRoutes.js';

const now=new Date('2026-10-13T12:00:00.000Z');
async function scenario(operation) {
  const f=engineFixture(),directory=mkdtempSync(join(tmpdir(),'lads-ticker-odds-'));
  try {
    const events=[2,3,5].map((bestOf,index)=>f.schedules.save(1,{team1Key:11,team2Key:12,stage:bestOf===2?'regular':'playoff',bestOf,
      scheduledStartUtc:`2026-10-${17+index}T01:00:00.000Z`},null,now));
    runBetting({...f,now,simulations:50});
    const analyticsPath=join(directory,'Analytics.db');await f.analytics.backup(analyticsPath);
    const options={book:f.book,league:f.league,analyticsPath},games=events.map(event=>({eventId:event.EventId}));
    await operation({...f,events,games,options,read:()=>readUpcomingSweepOdds(options,games,now)});
  }finally{f.close();rmSync(directory,{recursive:true,force:true});}
}

test('ticker sweep odds match current offered exact-score prices, preserve team order and use BO5 sweep scores',async()=>{
  await scenario(async f=>{
    const prices=f.read();assert.equal(prices.size,3);
    for(const event of f.events) {
      const market=f.betting.prepare("SELECT MarketId FROM BettingMarkets WHERE EventId=? AND MarketType='exact_score' ORDER BY MarketId DESC LIMIT 1").get(event.EventId);
      const wins=event.BestOf===5?3:2;
      const offered=key=>f.betting.prepare('SELECT OfferedMicros FROM BettingSelections WHERE MarketId=? AND OutcomeKey=?').get(market.MarketId,key).OfferedMicros/ODDS_SCALE;
      assert.deepEqual(prices.get(event.EventId),{team1:{score:`${wins}-0`,odds:offered(`${wins}-0`)},team2:{score:`0-${wins}`,odds:offered(`0-${wins}`)}});
    }
    const market=f.betting.prepare("SELECT MarketId FROM BettingMarkets WHERE EventId=? AND MarketType='exact_score'").get(f.events[0].EventId);
    f.betting.prepare("UPDATE BettingSelections SET OfferedMicros=? WHERE MarketId=? AND OutcomeKey='2-0'").run(4120000,market.MarketId);
    assert.equal(f.read().get(f.events[0].EventId).team1.odds,4120000/ODDS_SCALE);
    f.betting.prepare("UPDATE BettingSelections SET IsActive=0 WHERE MarketId=? AND OutcomeKey='0-2'").run(market.MarketId);
    assert.equal(f.read().has(f.events[0].EventId),false,'Incomplete selection sets are unavailable');
  });
});

test('ticker withholds closed, held, stale-schedule and refresh-pending odds without republishing prices',async()=>{
  await scenario(async f=>{
    const market=f.betting.prepare("SELECT * FROM BettingMarkets WHERE EventId=? AND MarketType='exact_score'").get(f.events[0].EventId);
    const quotes=f.betting.prepare('SELECT * FROM BettingSelections ORDER BY SelectionId').all();
    for(const status of ['held','locked','void','settled']) {
      f.betting.prepare('UPDATE BettingMarkets SET Status=? WHERE MarketId=?').run(status,market.MarketId);
      assert.equal(f.read().has(f.events[0].EventId),false,status);
    }
    f.betting.prepare("UPDATE BettingMarkets SET Status='open',CloseAtUtc=? WHERE MarketId=?").run(now.toISOString(),market.MarketId);
    assert.equal(f.read().has(f.events[0].EventId),false,'Expired market');
    f.betting.prepare('UPDATE BettingMarkets SET CloseAtUtc=? WHERE MarketId=?').run(market.CloseAtUtc,market.MarketId);
    f.league.prepare('UPDATE ScheduledEvents SET Revision=Revision+1 WHERE EventId=?').run(f.events[0].EventId);
    assert.equal(f.read().has(f.events[0].EventId),false,'Outdated schedule revision');
    f.league.prepare('UPDATE ScheduledEvents SET Revision=Revision-1 WHERE EventId=?').run(f.events[0].EventId);
    f.league.exec('UPDATE BettingRefreshState SET RequestedRevision=CompletedRevision+1 WHERE Id=1');assert.equal(f.read().size,0);
    f.league.exec('UPDATE BettingRefreshState SET RequestedRevision=CompletedRevision WHERE Id=1');
    assert.equal(readUpcomingSweepOdds({...f.options,analyticsPath:'missing-ticker-analytics.db'},f.games,now).size,0);
    assert.deepEqual(f.betting.prepare('SELECT * FROM BettingSelections ORDER BY SelectionId').all(),quotes,'Reads do not publish or move prices');
  });
});

test('anonymous upcoming API adds only public sweep prices and keeps the schedule visible when prices are unavailable',async()=>{
  await scenario(async f=>{
    let failPrices=false;
    const app=express();app.use(createUpcomingGamesRouter({league:f.league,now:()=>now,env:{},readOdds:(games,time)=>{
      if(failPrices)throw Object.assign(Error('Synthetic quote failure'),{code:'TEST_QUOTES_UNAVAILABLE'});
      return readUpcomingSweepOdds(f.options,games,time);
    }}));
    const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
    try {
      const read=async()=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/upcoming-games`);assert.equal(response.status,200);return response.json();};
      const data=await read();assert.equal(data.games.length,3);
      assert.deepEqual(data.games[0].sweepOdds,f.read().get(f.events[0].EventId));
      for(const game of data.games)assert.deepEqual(Object.keys(game).sort(),['eventId','startAt','sweepOdds','team1','team2']);
      failPrices=true;const fallback=await read();assert.equal(fallback.games.length,3);assert.ok(fallback.games.every(game=>!Object.hasOwn(game,'sweepOdds')));
      assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingWallets').get().n,0);
    }finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
  });
});
