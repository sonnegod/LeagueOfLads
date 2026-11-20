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
    matches:[{TeamRad:201,TeamDire:202,WinnerId:201},{TeamRad:202,TeamDire:201,WinnerId:202}],
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
  assert.deepEqual(data.snapshot,{teams:7,groups:2,players:7,completedSeries:1,remainingSeries:8,totalSeries:9,partialSeries:0});
  assert.equal(data.remaining.totalSeries,8);
  const [moon,sun]=data.remaining.groups;
  assert.equal(moon.remainingSeries,2);
  assert.deepEqual(moon.teams.map(team=>[team.name,team.remainingSeries]),[['Team 3',2],['Team 1',1],['Team 2',1]],'Playoff games, in-progress series and scheduled fixtures do not consume a remaining regular-season pairing');
  assert.equal(sun.remainingSeries,6);
  assert.deepEqual(sun.teams.map(team=>team.remainingSeries),[3,3,3,3],'Closed series and forfeits need a completed H2H score to count as played');
  assert.equal(data.remaining.groups.flatMap(group=>group.teams).reduce((total,team)=>total+team.remainingSeries,0),16,'A series is counted once overall and once for each participant');
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
  data=buildLeagueOverview(input);assert.equal(data.remaining.totalSeries,117,'A fixture forfeit alone cannot replace an H2H score');
  input.groups.push({GroupId:4,GroupName:'Empty'});
  data=buildLeagueOverview(input);assert.deepEqual(data.remaining.groups[3].teams,[]);assert.equal(data.remaining.groups[3].remainingSeries,0);
  input.groups=[];assert.deepEqual(buildLeagueOverview(input).remaining,{totalSeries:0,groups:[]});
});

test('both snapshot totals use effective H2H scores and ignore series lifecycle, fixtures and time',()=>{
  const input=inputs();
  input.matches.push({TeamRad:201,TeamDire:203,WinnerId:201});
  input.overrides=[{GroupId:2,TeamA:204,TeamB:205,WinsA:2,WinsB:0,BaseWinsA:0,BaseWinsB:0}];
  const data=buildLeagueOverview(input,new Date('2026-11-20T18:00:00Z'));
  assert.deepEqual(data.snapshot,{teams:7,groups:2,players:7,completedSeries:2,remainingSeries:7,totalSeries:9,partialSeries:1});
  assert.equal(data.snapshot.remainingSeries,data.remaining.totalSeries);
  assert.equal(data.snapshot.completedSeries+data.snapshot.remainingSeries,9);
  const withoutTracking={...input,series:[],events:[]};
  assert.deepEqual(data.snapshot,buildLeagueOverview(withoutTracking,new Date('2026-11-21T12:00:00Z')).snapshot);
  input.overrides.push({GroupId:1,TeamA:201,TeamB:202,WinsA:0,WinsB:0,BaseWinsA:1,BaseWinsB:1});
  const reset=buildLeagueOverview(input);
  assert.equal(reset.snapshot.completedSeries,1,'A manual H2H reset removes the pairing from completed');
  assert.equal(reset.snapshot.remainingSeries,8,'The same reset adds it to remaining');
  input.overrides.push({GroupId:1,TeamA:201,TeamB:203,WinsA:1,WinsB:1,BaseWinsA:1,BaseWinsB:0});
  const finished=buildLeagueOverview(input);
  assert.equal(finished.snapshot.completedSeries,2);
  assert.equal(finished.snapshot.remainingSeries,7);
  assert.equal(finished.snapshot.partialSeries,0,'A manually completed partial score is no longer partial');
});

test('recorded BO2 games reduce remaining series even with stale, missing or split series tracking',()=>{
  const input=inputs();
  input.entries=input.entries.slice(0,3);input.groups=input.groups.slice(0,1);input.events=[];
  const games=[{TeamRad:201,TeamDire:202,WinnerId:201},{TeamRad:202,TeamDire:201,WinnerId:202}];
  for(const series of [
    [{SeriesId:1,Team1:201,Team2:202,Stage:'g',Status:'in_progress'}],
    [{SeriesId:1,Team1:201,Team2:202,Stage:'g',Status:null}],
    [{SeriesId:1,Team1:201,Team2:202,Stage:'g',Status:'in_progress'},{SeriesId:2,Team1:202,Team2:201,Stage:'g',Status:'in_progress'}],
    [],
  ]){
    input.series=series;input.matches=games;
    let data=buildLeagueOverview(input);
    assert.deepEqual(data.remaining.groups[0].teams.map(team=>[team.name,team.remainingSeries]),[['Team 3',2],['Team 1',1],['Team 2',1]]);
    assert.equal(data.remaining.totalSeries,2,'A completed opponent pair is subtracted exactly once');
    input.matches=games.slice(0,1);
    data=buildLeagueOverview(input);assert.ok(data.remaining.groups[0].teams.every(team=>team.remainingSeries===2),'A single recorded game remains outstanding');
  }
  input.series=[];input.matches=[{TeamRad:201,TeamDire:201,WinnerId:201}];
  assert.ok(buildLeagueOverview(input).remaining.groups[0].teams.every(team=>team.remainingSeries===2),'A three-team group starts at two opponents and ignores self-matches');
  input.matches=[...games,...games];
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,2,'Extra games never subtract the same opponent twice');
});

test('9/9/10 groups subtract completed H2H pairings independently of series and fixture status',()=>{
  const input={season:{SeasonId:1},entries:[],groups:[],roster:[],series:[],events:[],matches:[],overrides:[],stage:'groups'};
  let nextId=1;
  for(const [groupIndex,size] of [9,9,10].entries()) {
    const groupId=groupIndex+1,first=nextId;
    input.groups.push({GroupId:groupId,GroupName:`Group ${groupId}`});
    for(let n=0;n<size;n++){const id=nextId++;input.entries.push({EntryId:id,TeamId:id,TeamSubmissionId:id+100,TeamName:`Team ${id}`,GroupId:groupId});}
    const game=(other,winner)=>input.matches.push({TeamRad:first,TeamDire:first+other,WinnerId:winner});
    const series=(other,status)=>input.series.push({SeriesId:first*10+other,Team1:first,Team2:first+other,Stage:'g',Status:status});
    game(1,first);game(1,first+1);series(1,'in_progress');
    input.overrides.push({GroupId:groupId,TeamA:first,TeamB:first+2,WinsA:1,WinsB:1,BaseWinsA:0,BaseWinsB:0});
    game(3,first);game(3,first+3);series(3,'closed');
    input.events.push({Team1Key:first+100,Team2Key:first+104,Stage:'regular',Status:'forfeit'});
    input.overrides.push({GroupId:groupId,TeamA:first,TeamB:first+4,WinsA:2,WinsB:0,BaseWinsA:0,BaseWinsB:0});
    game(5,first);series(5,'in_progress');
    game(6,first);game(6,first+6);series(6,'completed');
    input.overrides.push({GroupId:groupId,TeamA:first,TeamB:first+6,WinsA:0,WinsB:0,BaseWinsA:1,BaseWinsB:1});
    input.series.push({SeriesId:first*10+7,Team1:first,Team2:first+7,Stage:'t',Status:'completed'});
  }
  const data=buildLeagueOverview(input);
  assert.deepEqual(data.remaining.groups.map(group=>group.remainingSeries),[32,32,41]);
  assert.equal(data.remaining.totalSeries,105);
  assert.equal(data.snapshot.completedSeries,12);
  assert.equal(data.snapshot.remainingSeries,105);
  assert.equal(data.snapshot.totalSeries,117);
  assert.equal(data.snapshot.partialSeries,3);
  assert.deepEqual(data.remaining,buildLeagueOverview({...input,series:[],events:[]}).remaining,'Only H2H results determine remaining series');
  for(const [groupIndex,group] of data.remaining.groups.entries()) {
    const first=[1,10,19][groupIndex],size=[9,9,10][groupIndex];
    for(const team of group.teams){
      const offset=team.entryId-first;
      const played=offset===0?4:offset>=1&&offset<=4?1:0;
      assert.equal(team.remainingSeries,size-1-played,`${group.name}, ${team.name}: ${size}-1-${played}`);
    }
  }
});

test('H2H overrides control remaining counts, including partial scores, later imports, resets and group scoping',()=>{
  const input=inputs();
  input.matches=[{TeamRad:201,TeamDire:202,WinnerId:201},{TeamRad:202,TeamDire:201,WinnerId:202},{TeamRad:201,TeamDire:203,WinnerId:201}];
  const score={GroupId:1,TeamA:201,TeamB:203,WinsA:1,WinsB:1,BaseWinsA:1,BaseWinsB:0};
  input.overrides=[score];
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,7,'Manual 1–1 completes the pending series without a saved series result');
  score.WinsA=2;score.WinsB=0;assert.equal(buildLeagueOverview(input).remaining.totalSeries,7,'Manual 2–0 also completes the series');
  score.WinsA=1;assert.equal(buildLeagueOverview(input).remaining.totalSeries,8,'A single manual game does not complete a BO2');
  input.matches.push({TeamRad:203,TeamDire:201,WinnerId:203});
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,7,'Later imported games extend the override just as in standings');
  input.overrides=[{GroupId:1,TeamA:201,TeamB:202,WinsA:0,WinsB:0,BaseWinsA:1,BaseWinsB:1}];
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,8,'An explicit 0–0 reopens an imported completed pairing');
  input.overrides[0].GroupId=2;
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,7,'Overrides for another group do not affect the count');
  input.overrides=[];
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,7,'Use games restores the actual completed game count');
  input.overrides=[{GroupId:2,TeamA:204,TeamB:205,WinsA:1,WinsB:0,BaseWinsA:0,BaseWinsB:0}];
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,7,'A partial H2H score remains outstanding even when a series is closed');
  input.overrides[0].WinsA=0;
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,7,'Zero and partial H2H scores are both outstanding');
  input.overrides[0].WinsA=2;
  assert.equal(buildLeagueOverview(input).remaining.totalSeries,6,'A completed H2H score closes that opponent pairing');
});

test('overview endpoint scopes saved records and H2H overrides to the active league and returns aggregate roster counts',async()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE LeagueSeasons(SeasonId INTEGER PRIMARY KEY,LeagueName TEXT,Status TEXT,ExternalLeagueId INTEGER);
    CREATE TABLE LeagueRosterEntries(EntryId INTEGER,TeamSubmissionId INTEGER,LeagueId INTEGER,TeamId INTEGER,GroupId INTEGER,DisplayName TEXT,SortOrder INTEGER);
    CREATE TABLE GroupNames(LeagueId INTEGER,GroupId INTEGER,GroupName TEXT);
    CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER);
    CREATE TABLE MatchTeam(MatchId INTEGER,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER);
    CREATE TABLE GroupResultOverrides(LeagueId INTEGER,GroupId INTEGER,TeamA INTEGER,TeamB INTEGER,WinsA INTEGER,WinsB INTEGER,BaseWinsA INTEGER,BaseWinsB INTEGER);
    CREATE TABLE LeagueStageBoundaries(LeagueId INTEGER,GroupEndMatchId INTEGER,TieBreakerEndMatchId INTEGER);
    INSERT INTO LeagueSeasons VALUES(1,'Current','active',100),(2,'Past','ended',200);
    INSERT INTO LeagueRosterEntries VALUES(1,101,100,1,1,'Current team',0),(2,201,200,2,1,'Past team',0);
    INSERT INTO GroupNames VALUES(100,1,'Moon'),(200,1,'Past group');
    INSERT INTO MatchLeague VALUES(10,100),(11,100),(20,200);
    INSERT INTO MatchTeam VALUES(10,1,2,1),(11,2,1,2);
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
    assert.equal(data.snapshot.completedSeries,0);assert.equal(data.snapshot.remainingSeries,0);assert.equal(data.snapshot.players,1);
    assert.deepEqual(data.remaining.groups.map(group=>group.name),['Moon']);
    assert.deepEqual(data.remaining.groups[0].teams,[{entryId:1,name:'Current team',remainingSeries:0}]);
    assert.ok(!/MMR|Screenshot|1234|PlayerId|private/.test(JSON.stringify(data)));
    db.exec(`INSERT INTO LeagueRosterEntries VALUES(3,102,100,2,1,'Second current team',1);
      INSERT INTO GroupResultOverrides VALUES(100,1,1,2,0,0,1,1),(200,1,1,2,2,0,0,0);`);
    const expectCounts=async(completed,remaining,message)=>{
      const overview=await(await get(1)).json();
      assert.equal(overview.snapshot.completedSeries,completed,message);
      assert.equal(overview.snapshot.remainingSeries,remaining,message);
      assert.equal(overview.remaining.totalSeries,remaining,message);
      assert.equal(overview.snapshot.totalSeries,completed+remaining);
    };
    await expectCounts(0,1,'Reads the active league reset without using another season override');
    db.exec('UPDATE GroupResultOverrides SET WinsA=2 WHERE LeagueId=100');
    await expectCounts(1,0,'Reads a manual completed result in both cards');
    db.exec('DELETE FROM GroupResultOverrides WHERE LeagueId=100');
    await expectCounts(1,0,'Restores actual game scores after clearing the override without lifecycle or fixture tables');
    db.exec('UPDATE LeagueStageBoundaries SET GroupEndMatchId=10 WHERE LeagueId=100');
    await expectCounts(0,1,'Games after the group-stage boundary do not finish a regular-season pair');
    assert.equal((await get(0)).status,400);assert.equal((await get('invalid')).status,400);
    assert.equal((await get(99)).status,404);assert.equal((await get(2)).status,409);
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));db.close();}
});
