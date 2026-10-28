import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {engineFixture} from './helpers/bettingFixture.js';
import {createBettingRoutes} from '../routes/bettingRoutes.js';

test('leaderboard returns a complete season snapshot for local browsing and updated numbers on refresh',async()=>{
  const f=engineFixture(),names=new Map();let server;
  try{
    f.book.registerSeason({SeasonId:1,LeagueName:'Current',Status:'active'});
    const stamp='2026-10-28T12:00:00.000Z';
    for(let i=1;i<=45;i++){
      const userId=String(1000+i),wagered=i*137,net=i%2?-i*321:i*254;
      names.set(userId,i===45?'Needle beyond first page':i===1?'alpha':i===3?'ALPHA':i===2?'Zebra':i===10?'100% Player':`Player ${String(i).padStart(2,'0')}`);
      f.betting.prepare('INSERT INTO BettingWallets VALUES(1,?,?)').run(userId,1000000+net-wagered);
      const insert=f.betting.prepare(`INSERT INTO BettingTickets(SeasonId,UserId,StakeCents,RequestKey,Status,PayoutCents,PlacedAtUtc) VALUES(1,?,?,?,?,?,?)`);
      insert.run(userId,wagered,`pending_${i}`,'pending',0,stamp);
      insert.run(userId,20000,`settled_${i}`,'won',20000+net,stamp);
      const ledger=f.betting.prepare(`INSERT INTO BettingLedger(SeasonId,UserId,AmountCents,Kind,IdempotencyKey,CreatedAtUtc) VALUES(1,?,?,?,?,?)`);
      ledger.run(userId,-wagered,'stake',`pending_stake_${i}`,stamp);
      ledger.run(userId,-20000,'stake',`settled_stake_${i}`,stamp);
      ledger.run(userId,20000+net,'settlement',`settled_return_${i}`,stamp);
    }
    f.betting.exec("INSERT INTO BettingWallets VALUES(2,'8000',99999999)");names.set('8000','Other season only');
    const app=express();app.use('/betting',createBettingRoutes({...f,analyticsPath:'missing.db',playerName:id=>names.get(String(id))}).publicRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}/betting/leaderboard`;
    const snapshot=()=>['BettingWallets','BettingTickets','BettingLedger'].map(table=>f.betting.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before=snapshot();
    const get=async(season=1)=>{const response=await fetch(`${base}?seasonId=${season}`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();};
    const ids=data=>data.players.map(player=>Number(player.userId)-1000);
    const first=await get();assert.equal(first.total,45);assert.equal(first.players.length,45);
    const expected=[...Array.from({length:22},(_,i)=>44-i*2),...Array.from({length:23},(_,i)=>i*2+1)];
    assert.deepEqual(ids(first),expected);
    assert.equal(first.players.find(player=>player.userId==='1045').name,'Needle beyond first page');
    assert.deepEqual(first.players[0],{userId:'1044',name:'Player 44',wagered:60.28,net:111.76,balance:10051.48});
    assert.deepEqual((await get(2)).players,[{userId:'8000',name:'Other season only',wagered:0,net:0,balance:999999.99}]);
    assert.deepEqual(await get(3),{players:[],total:0});
    assert.deepEqual(snapshot(),before);
    const pending=f.betting.prepare("SELECT * FROM BettingTickets WHERE UserId='1045' AND Status='pending'").get();
    f.betting.transaction(()=>{
      f.betting.prepare("UPDATE BettingTickets SET Status='refunded',PayoutCents=StakeCents WHERE TicketId=?").run(pending.TicketId);
      f.book.credit(pending,pending.StakeCents,'leaderboard_snapshot_refund','settlement');
    })();
    const refreshed=(await get()).players.find(player=>player.userId==='1045');
    assert.deepEqual(refreshed,{userId:'1045',name:'Needle beyond first page',wagered:0,net:-144.45,balance:9855.55});
  }finally{if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});
