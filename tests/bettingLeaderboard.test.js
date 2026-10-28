import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {engineFixture} from './helpers/bettingFixture.js';
import {createBettingRoutes} from '../routes/bettingRoutes.js';

test('leaderboard searches the entire season and sorts before bounded pagination without changing accounts',async()=>{
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
    const base=`http://127.0.0.1:${server.address().port}/betting/leaderboard?seasonId=1`;
    const snapshot=()=>['BettingWallets','BettingTickets','BettingLedger'].map(table=>f.betting.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before=snapshot();
    const get=async query=>{const response=await fetch(`${base}&${query||''}`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();};
    const ids=data=>data.players.map(player=>Number(player.userId)-1000);
    const first=await get();assert.equal(first.total,45);assert.equal(first.page,1);assert.equal(first.pageSize,20);assert.equal(first.players.length,20);
    const second=await get('page=2'),third=await get('page=3');
    assert.equal(second.players.length,20);assert.equal(third.players.length,5);
    const expected=[...Array.from({length:22},(_,i)=>44-i*2),...Array.from({length:23},(_,i)=>i*2+1)];
    assert.deepEqual([...ids(first),...ids(second),...ids(third)],expected);
    assert.deepEqual(ids(await get('page=999')),ids(third));
    assert.deepEqual(ids(await get('search=needle')),[45],'A player outside the former top twenty remains searchable');
    assert.deepEqual(ids(await get('search=1045')),[45]);
    assert.deepEqual(ids(await get('search=%20AlPhA%20')),[1,3]);
    assert.deepEqual(ids(await get('search=100%25')),[10],'Search treats a percent sign literally');
    const empty=await get('search=Other%20season&page=9');assert.equal(empty.total,0);assert.equal(empty.page,1);assert.deepEqual(empty.players,[]);
    assert.deepEqual(ids(await get('sort=wagered&direction=asc')),Array.from({length:20},(_,i)=>i+1));
    assert.deepEqual(ids(await get('sort=wagered&direction=desc')),Array.from({length:20},(_,i)=>45-i));
    assert.equal(ids(await get('sort=balance&direction=desc'))[0],44);
    assert.equal(ids(await get('sort=balance&direction=asc'))[0],45);
    assert.equal(ids(await get('sort=net&direction=asc'))[0],45);
    assert.deepEqual(ids(await get('sort=name&direction=asc')).slice(0,3),[10,1,3]);
    assert.equal(ids(await get('sort=name&direction=desc'))[0],2);
    assert.equal((await get('limit=1000')).players.length,20);
    for(const query of ['page=0','page=-1','page=x','page=1&page=2','sort=unknown','sort=toString','direction=sideways',`search=${'a'.repeat(101)}`]){
      assert.equal((await fetch(`${base}&${query}`)).status,400,query);
    }
    assert.deepEqual(snapshot(),before);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});
