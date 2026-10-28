import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import express from 'express';
import {createLiveMatchRouter} from '../routes/liveMatchRoutes.js';
import {readLiveMatchCurrentStates,readLiveMatchSnapshots} from '../config/liveMatchReads.js';
import {getLiveLeagueMatches,normalizeLiveMatch,pollLiveMatches,nextLivePollDelay} from '../pollLiveMatchData.js';

const response=payload=>async()=>({ok:true,status:200,text:async()=>JSON.stringify(payload)});

test('Steam request failures and malformed successful responses do not remove saved matches',async()=>{
  const calls=[];
  const database={getActiveLeague:()=>[{LeagueId:55}],pruneMissingLiveMatches:(...args)=>calls.push(args)};
  for(const fetchImpl of [response({result:{error:'temporarily unavailable'}}),response({result:{games:null}}),
    async()=>({ok:false,status:503,text:async()=>'Service unavailable'}),async()=>({ok:true,status:200,text:async()=>'<html>'})]) {
    await assert.rejects(pollLiveMatches({database,apiKey:'test',fetchImpl}));
  }
  assert.deepEqual(calls,[]);
});

test('valid empty responses preserve the normal missing-match grace period and league scope',async()=>{
  const calls=[];
  await pollLiveMatches({database:{getActiveLeague:()=>[{LeagueId:55}],pruneMissingLiveMatches:(...args)=>{calls.push(args);return 0;}},
    apiKey:'test',fetchImpl:response({result:{games:[]}}),notify:async()=>true});
  assert.deepEqual(calls,[[[],120,55]]);
});

test('Steam requests bypass caches, keep authentication server-side, and retain real game changes',async()=>{
  let requested;
  const games=await getLiveLeagueMatches(55,{apiKey:'test',fetchImpl:async(url,options)=>{
    requested={url:new URL(url),options};return (await response({result:{games:[{match_id:100}]}})());
  }});
  assert.equal(requested.url.searchParams.get('league_id'),'55');
  assert.equal(requested.options.cache,'no-store');
  assert.ok(requested.options.signal instanceof AbortSignal);
  assert.equal(games[0].match_id,100);
  const game={match_id:100,scoreboard:{duration:300,radiant:{score:3,players:[{account_id:1,hero_id:2,kills:3}]},dire:{score:2}}};
  const before=normalizeLiveMatch(game,55),after=normalizeLiveMatch({...game,scoreboard:{...game.scoreboard,duration:306}},55);
  assert.equal(before.Players[0].Kills,3);
  assert.notEqual(before.SnapshotHash,after.SnapshotHash);
});

test('Steam poll cadence counts request time without overlapping slow requests',()=>{
  assert.equal(nextLivePollDelay(1000,1000),5000);
  assert.equal(nextLivePollDelay(1000,2200),3800);
  assert.equal(nextLivePollDelay(1000,6500),100);
});

function fixture() {
  const db=new Database(':memory:');
  const schema=readFileSync(new URL('../scripts/db/ladsData.schema.sql',import.meta.url),'utf8');
  for(const table of ['LiveMatchCurrentState','LiveMatchCurrentPlayer','LiveMatchCurrentDraft','LiveMatchSnapshots','LiveMatchSnapshotPlayer','LiveMatchSnapshotDraft']) {
    const sql=schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\);`));
    assert.ok(sql,table);db.exec(sql[0]);
  }
  db.exec(`CREATE INDEX idx_LiveMatchSnapshots_MatchId_SnapshotId ON LiveMatchSnapshots(MatchId,SnapshotId);
    INSERT INTO LiveMatchCurrentState(MatchId,LeagueId,SnapshotHash,LastUpdated) VALUES(100,55,'new','2026-10-28 12:00:06');
    INSERT INTO LiveMatchCurrentPlayer(MatchId,AccountId,Team,PlayerSlot,Kills) VALUES(100,1,0,0,5),(100,2,1,128,2);
    INSERT INTO LiveMatchCurrentDraft(MatchId,DraftJson,RadiantPicksJson) VALUES(100,'{}','[{"hero_id":2}]');
    INSERT INTO LiveMatchSnapshots(SnapshotId,MatchId,LeagueId,SnapshotHash,CreatedAt) VALUES
      (1,100,55,'old','2026-10-28 12:00:00'),(2,200,55,'other','2026-10-28 12:00:05'),(3,100,55,'new','2026-10-28 12:00:05');
    INSERT INTO LiveMatchSnapshotPlayer(SnapshotId,MatchId,AccountId,Team,Kills) VALUES(1,100,1,0,4),(2,200,9,1,8),(3,100,1,0,5);
    INSERT INTO LiveMatchSnapshotDraft(SnapshotId,MatchId,DraftJson,RadiantPicksJson) VALUES(1,100,'{}','[]'),(3,100,'{}','[{"hero_id":2}]');`);
  return db;
}

test('current state exposes source observation separately from last changed data, with the correct children',()=>{
  const db=fixture();try {
    const [match]=readLiveMatchCurrentStates(db);
    assert.equal(match.LatestSnapshotId,3);
    assert.equal(match.LastChangedAt,'2026-10-28 12:00:05');
    assert.equal(match.LastUpdated,'2026-10-28 12:00:06');
    assert.equal(match.SnapshotId,undefined,'current rows must keep live status in the app API');
    assert.deepEqual(match.Players.map(p=>p.AccountId),[1,2]);
    assert.equal(match.Draft.RadiantPicksJson,'[{"hero_id":2}]');
  }finally{db.close();}
});

test('snapshot deltas are ordered, scoped to one match, and read in three queries even for long games',()=>{
  const db=fixture();try {
    const insert=db.prepare(`INSERT INTO LiveMatchSnapshots(MatchId,LeagueId,SnapshotHash) VALUES(100,55,?)`);
    db.transaction(()=>{for(let i=0;i<1000;i++)insert.run(String(i));})();
    let queries=0;
    const counted={transaction:callback=>db.transaction(callback),prepare:sql=>{queries++;return db.prepare(sql);}};
    const rows=readLiveMatchSnapshots(counted,100,1);
    assert.equal(queries,3);
    assert.equal(rows.length,1001);
    assert.equal(rows[0].SnapshotId,3);
    assert.equal(rows[0].Players[0].Kills,5);
    assert.equal(rows[0].Draft.RadiantPicksJson,'[{"hero_id":2}]');
    assert.ok(rows.every(row=>row.MatchId===100));
    assert.deepEqual(readLiveMatchSnapshots(db,100,rows.at(-1).SnapshotId),[]);
    assert.deepEqual(readLiveMatchSnapshots(db,999),[]);
  }finally{db.close();}
});

test('live web and app APIs are uncached, preserve full history, and accept validated incremental cursors',async()=>{
  const db=fixture();const app=express();
  app.use(createLiveMatchRouter({getLiveMatchCount:()=>1,getLiveMatchCurrentStates:()=>readLiveMatchCurrentStates(db),
    getRecentLiveMatchSnapshots:()=>[],getAllRecentLiveMatchSnapshots:()=>[],
    getLiveMatchSnapshots:(id,after)=>readLiveMatchSnapshots(db,id,after)}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const path of ['/liveMatches','/liveMatches/count','/liveMatches/recent','/app/live-matches','/app/live-matches/count']) {
      const res=await fetch(base+path);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
    }
    const live=await(await fetch(base+'/liveMatches')).json();
    assert.equal(live.matches[0].LatestSnapshotId,3);
    assert.equal(live.matches[0].Players[0].kills,5);
    for(const prefix of ['/liveMatches','/app/live-matches']) {
      const full=await(await fetch(base+prefix+'/100/snapshots')).json();assert.equal(full.snapshots.length,2);
      const delta=await(await fetch(base+prefix+'/100/snapshots?afterSnapshotId=1')).json();assert.equal(delta.snapshots.length,1);
      for(const cursor of ['-1','abc','1.2','9007199254740992'])assert.equal((await fetch(base+prefix+'/100/snapshots?afterSnapshotId='+cursor)).status,400);
    }
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
});
