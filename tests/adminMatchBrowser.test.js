import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {createAdminMatchBrowserRouter,readMatchRecords} from '../routes/adminMatchBrowserRoutes.js';
import {matchRecordDay} from '../shared/matchRecordDay.js';

test('match browser scopes seasons, retains series and flags ungrouped IDs without requiring player data',async()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE LeagueInfo(LeagueId INTEGER PRIMARY KEY,LeagueName TEXT);
    CREATE TABLE MatchLeague(MatchId INTEGER PRIMARY KEY,LeagueId INTEGER,DatePlayed TEXT);
    CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER,RadiantScore INTEGER,DireScore INTEGER);
    CREATE TABLE SeriesMatch(SeriesId INTEGER,MatchId INTEGER);
    CREATE TABLE TeamInfo(TeamId INTEGER PRIMARY KEY,TeamName TEXT);
    CREATE TABLE LeagueTeamNames(LeagueId INTEGER,TeamId INTEGER,DisplayName TEXT);
    CREATE TABLE LeagueGroups(LeagueId INTEGER,TeamId INTEGER,GroupId INTEGER);
    CREATE TABLE GroupNames(LeagueId INTEGER,GroupId INTEGER);
    CREATE TABLE MatchTeamPlayer(MatchId INTEGER,TeamId INTEGER,PlayerId INTEGER);
    INSERT INTO LeagueInfo VALUES(1,'Current'),(2,'Past'),(3,'Empty');
    INSERT INTO TeamInfo VALUES(10,'Original name'),(20,'Opponent');
    INSERT INTO LeagueTeamNames VALUES(1,10,'Official name'),(2,10,'Past name');
    INSERT INTO MatchLeague VALUES(100,1,'2026-11-17'),(101,1,'2026-11-17'),(102,1,'2026-11-18'),(200,2,'2026-11-17');
    INSERT INTO MatchTeam VALUES(100,10,20,10,30,20),(101,20,10,20,25,15),(102,99,10,10,NULL,NULL),(200,10,20,20,10,20);
    INSERT INTO SeriesMatch VALUES(50,100),(50,101),(60,200);
    INSERT INTO GroupNames VALUES(1,1),(2,1);
    INSERT INTO LeagueGroups VALUES(1,10,1),(1,20,99),(2,20,1);`);
  let active={LeagueId:1};
  const app=express();
  app.use('/records',(req,res,next)=>req.headers['x-test-admin']==='yes'?next():res.sendStatus(403),
    createAdminMatchBrowserRouter({league:db,activeLeague:()=>active}));
  const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  const get=(suffix='',admin=true)=>fetch(`http://127.0.0.1:${server.address().port}/records${suffix}`,{headers:admin?{'x-test-admin':'yes'}:{}});
  try {
    assert.equal((await get('',false)).status,403);
    const response=await get();assert.match(response.headers.get('cache-control'),/no-store/);
    const data=await response.json();assert.deepEqual(data.matches.map(m=>m.matchId),[102,101,100]);
    assert.equal(data.matches[0].seriesId,null);
    assert.deepEqual(data.matches[0].team1,{id:99,name:'Team 99',sourceName:null,needsReview:true});
    assert.equal(data.matches[1].seriesId,50);assert.equal(data.matches[2].seriesId,50);
    assert.equal(data.matches[1].team1.needsReview,true,'Dangling group IDs need review');
    assert.equal(data.matches[1].team2.needsReview,false);
    assert.equal(data.matches[1].team2.name,'Official name');
    assert.equal(data.matches[1].team2.sourceName,'Original name');
    assert.equal(data.matches[2].radiantScore,30);
    const past=await(await get('?leagueId=2')).json();assert.deepEqual(past.matches.map(m=>m.matchId),[200]);
    assert.equal(past.matches[0].team1.name,'Past name');
    assert.deepEqual((await(await get('?leagueId=3')).json()).matches,[]);
    for(const suffix of ['?leagueId=0','?leagueId=abc','?leagueId=1&leagueId=2'])assert.equal((await get(suffix)).status,400);
    assert.equal((await get('?leagueId=999')).status,404);
    active=null;assert.deepEqual(await(await get()).json(),{league:null,matches:[]});
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));db.close();}
});

test('same-day suggestions require a shared team ID, then rank roster evidence within the New York playing day',()=>{
  const db=new Database(':memory:');
  try {
    db.exec(`CREATE TABLE MatchLeague(MatchId INTEGER PRIMARY KEY,LeagueId INTEGER,DatePlayed TEXT);
      CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER,RadiantScore INTEGER,DireScore INTEGER);
      CREATE TABLE SeriesMatch(SeriesId INTEGER,MatchId INTEGER);
      CREATE TABLE TeamInfo(TeamId INTEGER PRIMARY KEY,TeamName TEXT);
      CREATE TABLE LeagueTeamNames(LeagueId INTEGER,TeamId INTEGER,DisplayName TEXT);
      CREATE TABLE LeagueGroups(LeagueId INTEGER,TeamId INTEGER,GroupId INTEGER);
      CREATE TABLE GroupNames(LeagueId INTEGER,GroupId INTEGER);
      CREATE TABLE MatchTeamPlayer(MatchId INTEGER,TeamId INTEGER,PlayerId INTEGER);
      INSERT INTO GroupNames VALUES(1,1),(2,1);
      INSERT INTO LeagueGroups VALUES(1,10,1),(1,20,1),(1,30,1),(1,40,1);
      INSERT INTO TeamInfo VALUES(10,'Known opponent'),(20,'Actual team'),(30,'Other team'),(40,'Different opponent'),(99,'Random team');
      INSERT INTO MatchLeague VALUES
        (100,1,'2026-11-18T00:15:00Z'),(101,1,'2026-11-17T23:00:00Z'),(102,1,'2026-11-17T21:00:00Z'),
        (103,1,'2026-11-18T06:00:00Z'),(104,1,'2026-11-18T00:00:00Z'),(105,1,'2026-11-17T23:30:00Z'),
        (106,1,'2026-11-18T00:30:00Z'),(200,2,'2026-11-18T00:00:00Z'),(300,1,'2026-11-18T00:45:00Z');
      INSERT INTO MatchTeam VALUES(100,10,99,10,30,20),(101,20,10,20,35,22),(102,10,30,10,20,10),
        (103,10,20,10,20,10),(104,10,99,10,30,20),(105,40,20,20,10,20),(106,10,30,10,30,20),
        (200,10,20,10,30,20),(300,98,97,98,40,30);
      INSERT INTO SeriesMatch VALUES(50,100),(50,104),(60,101),(70,102),(80,103),(90,105),(100,106);`);
    const insert=db.prepare('INSERT INTO MatchTeamPlayer VALUES(?,?,?)');
    for(const [matchId,teamId,ids] of [
      [100,99,[1,2,3,4,5]],[100,10,[6,7,8,9,10]],
      [101,20,[1,2,3,4,5]],[101,10,[6,7,8,9,10]],
      [102,30,[21,22,23,24,25]],[106,30,[1,2,21,22,23]],
      [105,20,[1,2,3,4,5]],[105,40,[11,12,13,14,15]],
      [103,20,[1,2,3,4,5]],[200,20,[1,2,3,4,5]],
      [300,98,[1,2,3,4,5]],[300,97,[6,7,8,9,10]],
    ])for(const id of ids)insert.run(matchId,teamId,id);
    insert.run(100,99,1); // Duplicate membership must not inflate evidence.
    const records=readMatchRecords(db,1),source=records.find(record=>record.matchId===100);
    assert.equal(source.relatedMatches[0].matchId,101,'Roster match ranks above nearer shared-opponent-only games');
    assert.deepEqual(source.relatedMatches[0],{matchId:101,sharedTeamIds:[10],rosterMatches:[{fromTeamId:99,toTeamId:20,playerCount:5}]});
    assert.deepEqual(source.relatedMatches.map(match=>match.matchId),[101,106,102]);
    assert.deepEqual(source.relatedMatches[1].rosterMatches,[],'Two matching players are insufficient roster evidence');
    for(const excluded of [100,103,104,105,200])assert.ok(!source.relatedMatches.some(match=>match.matchId===excluded));
    const bothUnknown=records.find(record=>record.matchId===300);
    assert.deepEqual(bothUnknown.relatedMatches,[],'Even complete roster overlap cannot suggest a series without a matching team ID');
    assert.equal(records.find(record=>record.matchId===103).relatedMatches,undefined,'Grouped games do not need suggestions');
    assert.equal(matchRecordDay('2026-11-18T00:15:00Z'),'2026-11-17');
    assert.equal(matchRecordDay('2026-11-17 23:00:00'),'2026-11-17');
    assert.equal(matchRecordDay('2026-11-17'),'2026-11-17');
    assert.equal(matchRecordDay('invalid'),'');
  }finally{db.close();}
});
