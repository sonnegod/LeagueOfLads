import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {buildLeagueOverview} from '../config/leagueOverview.js';
import {createLeagueOverviewRouter} from '../routes/leagueOverviewRoutes.js';

function inputs() {
  const entries=Array.from({length:7},(_,index)=>{const id=index+1;return {EntryId:id,TeamSubmissionId:id+100,TeamId:id+200,TeamName:`Team ${id}`,GroupId:id<=3?1:2};});
  const groups=[{GroupId:1,GroupName:'Moon'},{GroupId:2,GroupName:'Sun'}];
  const event=(id,a,b,status,date,seriesId=null)=>({EventId:id,Team1Key:a+100,Team2Key:b+100,Stage:'regular',Status:status,ScheduledStartUtc:date,SeriesId:seriesId});
  return {season:{SeasonId:1,LeagueName:'Current',Status:'active',ExternalLeagueId:100},entries,groups,stage:'groups',
    roster:entries.map(team=>({TeamSubmissionId:team.TeamSubmissionId,PlayerId:team.EntryId})).concat([{TeamSubmissionId:101,PlayerId:1},{TeamSubmissionId:999,PlayerId:99}]),
    series:[{SeriesId:10,Team1:202,Team2:201,Stage:'g',Status:'completed'},
      {SeriesId:11,Team1:201,Team2:202,Stage:'g',Status:'completed'},
      {SeriesId:12,Team1:204,Team2:205,Stage:'g',Status:'closed'},
      {SeriesId:13,Team1:201,Team2:203,Stage:'g',Status:'in_progress'},
      {SeriesId:14,Team1:202,Team2:203,Stage:'p',Status:'completed'},
      {SeriesId:15,Team1:201,Team2:204,Stage:'g',Status:'completed'},
      {SeriesId:16,Team1:204,Team2:206,Stage:'g',Status:'needs_review'}],
    events:[event(1,1,2,'scheduled','2026-11-20T23:00:00Z',10),event(2,2,3,'scheduled','2026-11-21T01:00:00Z'),
      event(3,2,3,'cancelled','2026-11-21T00:00:00Z'),event(4,2,3,'replaced','2026-11-21T00:00:00Z'),
      event(5,2,3,'needs_review','2026-11-21T00:00:00Z'),event(6,1,3,'started','2026-11-17T23:00:00Z',13),
      event(7,2,3,'scheduled','2026-11-17T23:00:00Z'),event(8,6,7,'forfeit','2026-11-17T23:00:00Z')]};
}

test('remaining series use current group membership, deduplicate opponents, and sort each team by remaining count',()=>{
  const data=buildLeagueOverview(inputs(),new Date('2026-11-18T12:00:00Z'));
  assert.deepEqual(data.snapshot,{teams:7,groups:2,players:7,completedSeries:4,closedSeries:1,inProgressSeries:2,scheduledSeries:1});
  assert.equal(data.remaining.totalSeries,6);
  const [moon,sun]=data.remaining.groups;
  assert.equal(moon.remainingSeries,2);
  assert.deepEqual(moon.teams.map(team=>[team.name,team.remainingSeries]),[['Team 3',2],['Team 1',1],['Team 2',1]],'Playoff games, in-progress series and scheduled fixtures do not consume a remaining regular-season pairing');
  assert.equal(sun.remainingSeries,4);
  assert.deepEqual(sun.teams.map(team=>team.remainingSeries),[2,2,2,2],'Closed series and forfeits count as played');
  assert.equal(data.remaining.groups.flatMap(group=>group.teams).reduce((total,team)=>total+team.remainingSeries,0),12,'A series is counted once overall and once for each participant');
  assert.equal(data.window,undefined,'The scheduling-window payload is removed');
});

test('unequal groups, empty groups and unlinked IDs need no schedule generation or opponent lists',()=>{
  const input=inputs();
  input.entries=[];input.groups=[];input.series=[];input.events=[];
  let id=0;
  for(const [index,size] of [9,9,10].entries()) {
    input.groups.push({GroupId:index+1,GroupName:`Group ${index+1}`});
    for(let n=0;n<size;n++){id++;input.entries.push({EntryId:id,TeamSubmissionId:id+100,TeamId:null,GroupId:index+1,TeamName:id});}
  }
  let data=buildLeagueOverview(input);
  assert.equal(data.remaining.totalSeries,117);
  assert.deepEqual(data.remaining.groups.map(group=>group.remainingSeries),[36,36,45]);
  assert.ok(data.remaining.groups[0].teams.every(team=>team.remainingSeries===8));
  assert.ok(data.remaining.groups[2].teams.every(team=>team.remainingSeries===9));
  assert.ok(data.remaining.groups.flatMap(group=>group.teams).every(team=>typeof team.name==='string'&&!('opponents' in team)));
  input.events=[{Team1Key:101,Team2Key:102,Stage:'regular',Status:'forfeit'}];
  data=buildLeagueOverview(input);assert.equal(data.remaining.totalSeries,116,'Forfeits work through signup IDs when Dota IDs are unlinked');
  input.groups.push({GroupId:4,GroupName:'Empty'});
  data=buildLeagueOverview(input);assert.deepEqual(data.remaining.groups[3].teams,[]);assert.equal(data.remaining.groups[3].remainingSeries,0);
  input.groups=[];assert.deepEqual(buildLeagueOverview(input).remaining,{totalSeries:0,groups:[]});
});

test('H2H overrides control remaining counts, including partial scores, later imports, resets and group scoping',()=>{
  const input=inputs();
  input.matches=[{TeamRad:201,TeamDire:202,WinnerId:201},{TeamRad:202,TeamDire:201,WinnerId:202},{TeamRad:201,TeamDire:203,WinnerId:201}];
  const score={GroupId:1,TeamA:201,TeamB:203,WinsA:1,WinsB:1,BaseWinsA:1,BaseWinsB:0};
  input.overrides=[score];
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,5,'Manual 1–1 completes the pending series without a saved series result');
  score.WinsA=2;score.WinsB=0;assert.equal(buildLeagueOverview(input).remaining.totalSeries,5,'Manual 2–0 also completes the series');
  score.WinsA=1;assert.equal(buildLeagueOverview(input).remaining.totalSeries,6,'A single manual game does not complete a BO2');
  input.matches.push({TeamRad:203,TeamDire:201,WinnerId:203});
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,5,'Later imported games extend the override just as in standings');
  input.overrides=[{GroupId:1,TeamA:201,TeamB:202,WinsA:0,WinsB:0,BaseWinsA:1,BaseWinsB:1}];
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,7,'An explicit 0–0 reopens an imported completed pairing');
  input.overrides[0].GroupId=2;
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,6,'Overrides for another group do not affect the count');
  input.overrides=[];
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,6,'Use games restores the original count');
  input.overrides=[{GroupId:2,TeamA:204,TeamB:205,WinsA:1,WinsB:0,BaseWinsA:0,BaseWinsB:0}];
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,6,'A nonzero score preserves an explicitly closed partial series');
  input.overrides[0].WinsA=0;
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,7,'A manual reset also reopens a closed series');
});

test('overview endpoint scopes saved records and H2H overrides to the active league and returns aggregate roster counts',async()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE LeagueSeasons(SeasonId INTEGER PRIMARY KEY,LeagueName TEXT,Status TEXT,ExternalLeagueId INTEGER);
    CREATE TABLE LeagueRosterEntries(EntryId INTEGER,TeamSubmissionId INTEGER,LeagueId INTEGER,TeamId INTEGER,GroupId INTEGER,DisplayName TEXT,SortOrder INTEGER);
    CREATE TABLE GroupNames(LeagueId INTEGER,GroupId INTEGER,GroupName TEXT);
    CREATE TABLE SeriesInfo(SeriesId INTEGER,Team1 INTEGER,Team2 INTEGER,Stage TEXT,LeagueId INTEGER,DateCreated TEXT);
    CREATE TABLE SeriesLifecycle(SeriesId INTEGER,Status TEXT);
    CREATE TABLE SeriesMatch(SeriesId INTEGER,MatchId INTEGER);
    CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER);
    CREATE TABLE MatchTeam(MatchId INTEGER,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER);
    CREATE TABLE GroupResultOverrides(LeagueId INTEGER,GroupId INTEGER,TeamA INTEGER,TeamB INTEGER,WinsA INTEGER,WinsB INTEGER,BaseWinsA INTEGER,BaseWinsB INTEGER);
    CREATE TABLE ScheduledEvents(EventId INTEGER,SeasonId INTEGER,Team1Key INTEGER,Team2Key INTEGER,Stage TEXT,Status TEXT,ScheduledStartUtc TEXT,SeriesId INTEGER,SourceMessageId TEXT);
    CREATE TABLE LeagueStageBoundaries(LeagueId INTEGER,GroupEndMatchId INTEGER,TieBreakerEndMatchId INTEGER);
    INSERT INTO LeagueSeasons VALUES(1,'Current','active',100),(2,'Past','ended',200);
    INSERT INTO LeagueRosterEntries VALUES(1,101,100,1,1,'Current team',0),(2,201,200,2,1,'Past team',0);
    INSERT INTO GroupNames VALUES(100,1,'Moon'),(200,1,'Past group');
    INSERT INTO SeriesInfo VALUES(10,1,2,'g',100,'2026-11-17'),(20,1,2,'g',200,'2026-11-17'),(30,1,2,'g',100,'2026-11-17');
    INSERT INTO SeriesLifecycle VALUES(10,'completed'),(20,'completed'),(30,'completed');
    INSERT INTO SeriesMatch VALUES(10,10),(10,11),(20,20);INSERT INTO MatchLeague VALUES(10,100),(11,100),(20,200);
    INSERT INTO MatchTeam VALUES(10,1,2,1),(11,2,1,2);
    INSERT INTO ScheduledEvents VALUES(1,1,101,102,'regular','scheduled','2026-11-20T23:00:00Z',NULL,NULL),
      (2,2,201,202,'regular','scheduled','2026-11-20T23:00:00Z',NULL,NULL),
      (3,1,101,102,'regular','scheduled','2026-11-20T23:00:00Z',NULL,'local-test:123');
    INSERT INTO LeagueStageBoundaries VALUES(100,11,NULL);`);
  const app=express();
  app.use('/overview',(req,res,next)=>req.headers['x-admin']==='yes'?next():res.sendStatus(403),
    createLeagueOverviewRouter({league:db,
      readRoster:(league,id,status)=>{assert.equal(league,db);assert.equal(id,1);assert.equal(status,'active');return [{TeamSubmissionId:101,PlayerId:1,MMR:1234,Screenshot:'private'}];},
      now:()=>new Date('2026-11-18T12:00:00Z')}));
  const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  const get=(id,admin=true)=>fetch(`http://127.0.0.1:${server.address().port}/overview/${id}`,{headers:admin?{'x-admin':'yes'}:{}});
  try {
    assert.equal((await get(1,false)).status,403);
    const response=await get(1);assert.match(response.headers.get('cache-control'),/no-store/);
    const data=await response.json();assert.equal(data.season.stage,'tiebreakers');
    assert.equal(data.snapshot.completedSeries,1);assert.equal(data.snapshot.scheduledSeries,1);assert.equal(data.snapshot.players,1);
    assert.deepEqual(data.remaining.groups.map(group=>group.name),['Moon']);
    assert.deepEqual(data.remaining.groups[0].teams,[{entryId:1,name:'Current team',remainingSeries:0}]);
    assert.ok(!/MMR|Screenshot|1234|PlayerId|private/.test(JSON.stringify(data)));
    db.exec(`INSERT INTO LeagueRosterEntries VALUES(3,102,100,2,1,'Second current team',1);
      INSERT INTO GroupResultOverrides VALUES(100,1,1,2,0,0,1,1),(200,1,1,2,2,0,0,0);`);
    assert.equal((await(await get(1)).json()).remaining.totalSeries,1,'Reads the active league reset without using another season override');
    db.exec('UPDATE GroupResultOverrides SET WinsA=2 WHERE LeagueId=100');
    assert.equal((await(await get(1)).json()).remaining.totalSeries,0,'Reads a manual completed result');
    db.exec('DELETE FROM GroupResultOverrides WHERE LeagueId=100');
    assert.equal((await(await get(1)).json()).remaining.totalSeries,0,'Restores actual game scores after clearing the override');
    assert.equal((await get(0)).status,400);assert.equal((await get('invalid')).status,400);
    assert.equal((await get(99)).status,404);assert.equal((await get(2)).status,409);
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));db.close();}
});
