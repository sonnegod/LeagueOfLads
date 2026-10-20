import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {preseasonFixture} from './helpers/bettingFixture.js';
import {ScheduleStore} from '../betting/scheduleStore.js';
import {readRosterOrder} from '../config/rosterDisplayOrder.js';
import {createBettingRoutes} from '../routes/bettingRoutes.js';
import {mutationRefresh} from '../betting/runtime.js';
import {runBetting} from '../betting/engine.js';

const now=new Date('2026-10-13T12:00:00.000Z');
function fixture() {
  const f=preseasonFixture([4]);
  f.league.exec(`CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);
    INSERT INTO PlayerInfo SELECT DISTINCT PlayerId,'Player '||PlayerId FROM SeasonTeamPlayers;`);
  return f;
}

test('reordering is display-only, validates the saved roster and does not republish odds or invalidate setup',()=>{
  const f=fixture();try {
    let changed=0;const audit=[];
    const schedules=new ScheduleStore(f.league,{changed:()=>changed++,audit:(...args)=>audit.push(args)});
    const expectedRoster=schedules.rosterSlots(2).filter(p=>p.teamKey===21);
    const setup=schedules.setup(2),roster=f.league.prepare('SELECT * FROM SeasonTeamPlayers ORDER BY TeamSubmissionId,Slot').all();
    const history=f.league.prepare('SELECT * FROM TeamRosterMembershipHistory').all();
    runBetting({...f,seasonId:2,now,simulations:50});
    const quotes=f.betting.prepare('SELECT MarketId,QuoteVersion,Status FROM BettingMarkets ORDER BY MarketId').all();
    const save=body=>schedules.reorderRoster(2,{teamKey:21,order:[4,0,1,2,3],expectedRoster,...body},'99');
    save({});assert.deepEqual(readRosterOrder(f.league,21),[4,0,1,2,3]);assert.equal(changed,0);assert.equal(audit[0][0],'Roster Order Changed');
    assert.deepEqual(schedules.setup(2),setup);
    assert.deepEqual(f.league.prepare('SELECT * FROM SeasonTeamPlayers ORDER BY TeamSubmissionId,Slot').all(),roster);
    assert.deepEqual(f.league.prepare('SELECT * FROM TeamRosterMembershipHistory').all(),history);
    assert.equal(f.league.prepare('SELECT COUNT(*) n FROM SeasonRosterChanges').get().n,0);
    assert.equal(runBetting({...f,seasonId:2,now,simulations:50}).marketsOpened,0);
    assert.deepEqual(f.betting.prepare('SELECT MarketId,QuoteVersion,Status FROM BettingMarkets ORDER BY MarketId').all(),quotes);
    assert.throws(()=>save({order:[0,1,2,3,3]}),/all five/);
    assert.throws(()=>save({expectedRoster:expectedRoster.map((p,i)=>i? p:{...p,playerId:999})}),/roster changed/);
    assert.throws(()=>save({teamKey:11}),/current season/);
    f.league.prepare("UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=2").run();
    assert.throws(()=>save({}),/current season/);
    assert.deepEqual(readRosterOrder(f.league,21),[4,0,1,2,3]);
  }finally{f.close();}
});

test('roster administration reads and saves order including TBD positions without queuing a pricing refresh',async()=>{
  const f=fixture();let server;
  try {
    f.league.prepare('INSERT INTO SeasonPendingRosterSlots(TeamSubmissionId,Slot,EstimatedMMR,CreatedAtUtc,UpdatedAtUtc) VALUES(21,2,6500,?,?)')
      .run(now.toISOString(),now.toISOString());
    const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:'76561197960265827'};req.isAuthenticated=()=>true;next();});
    app.use('/rosters',createBettingRoutes({...f,analyticsPath:'unused'}).rosterRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}/rosters`;
    const get=async()=>{const response=await fetch(`${base}/status?seasonId=2`);assert.equal(response.status,200);return response.json();};
    const status=await get(),expectedRoster=status.rosterSlots.filter(p=>p.teamKey===21);
    assert.equal(expectedRoster.find(p=>p.slot===2).pending,true);
    assert.deepEqual(status.rosterOrders.find(t=>t.teamKey===21).order,[0,1,2,3,4]);
    const put=body=>fetch(`${base}/seasons/2/roster-order`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const saved=await put({teamKey:21,expectedRoster,order:[2,4,3,1,0]});assert.equal(saved.status,200);
    assert.deepEqual((await get()).rosterOrders.find(t=>t.teamKey===21).order,[2,4,3,1,0]);
    assert.equal((await put({teamKey:21,expectedRoster,order:[0,0,1,2,3]})).status,400);
    let continued=false;mutationRefresh({method:'PUT',path:'/rosters/seasons/2/roster-order'},
      {once:()=>{throw Error('Display order must not trigger pricing');}},()=>{continued=true;});assert.equal(continued,true);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});
