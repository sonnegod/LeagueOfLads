import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {readFileSync} from 'node:fs';
import {createUpcomingGamesRouter} from '../routes/upcomingGamesRoutes.js';

const start=new Date('2026-10-23T12:00:00.000Z');
function fixture() {
  const league=new Database(':memory:');
  league.exec(`CREATE TABLE LeagueSeasons(SeasonId INTEGER PRIMARY KEY,Status TEXT);
    CREATE TABLE SeasonTeams(TeamSubmissionId INTEGER PRIMARY KEY,SeasonId INTEGER,TeamName TEXT,ManualAverageMMR INTEGER);
    INSERT INTO LeagueSeasons VALUES(1,'active'),(2,'ended'),(3,'signup_closed'),(4,'draft');
    INSERT INTO SeasonTeams VALUES(11,1,'Moon',987654),(12,1,'Sun',987654),(21,2,'Old A',987654),(22,2,'Old B',987654),
      (31,3,'Next A',987654),(32,3,'Next B',987654),(41,4,'Draft A',987654),(42,4,'Draft B',987654);`);
  league.exec(readFileSync(new URL('../scripts/db/schedules.schema.sql',import.meta.url),'utf8'));
  const add=({seasonId=1,time='2026-10-24T00:00:00.000Z',status='scheduled',startedAt=null,source=null,team1=seasonId*10+1,team2=seasonId*10+2}={})=>
    Number(league.prepare(`INSERT INTO ScheduledEvents(SeasonId,Team1Key,Team2Key,Stage,BestOf,ScheduledStartUtc,Timezone,
      Status,StartedAtUtc,SourceMessageId,CreatedAtUtc,UpdatedAtUtc) VALUES(?,?,?,'regular',2,?,'America/New_York',?,?,?,?,?)`)
      .run(seasonId,team1,team2,time,status,startedAt,source,start.toISOString(),start.toISOString()).lastInsertRowid);
  return {league,add};
}
async function serve(f,operation,env={}) {
  let current=start;
  const app=express();app.use(createUpcomingGamesRouter({league:f.league,now:()=>current,env}));
  const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  try {
    const read=async()=>{
      const response=await fetch(`http://127.0.0.1:${server.address().port}/upcoming-games`);
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
      return response.json();
    };
    await operation(read,date=>{current=date;});
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));f.league.close();}
}

test('the anonymous ticker lists scheduled games without pricing, excludes played/held/test/ended fixtures and exposes only names and times',async()=>{
  const f=fixture();
  const later=f.add(),earlier=f.add({time:'2026-10-23T22:00:00.000Z'}),nextSeason=f.add({seasonId:3,time:'2026-10-25T00:00:00.000Z'});
  for(const status of ['started','completed','needs_review','cancelled','forfeit','replaced'])f.add({status});
  f.add({time:start.toISOString()});f.add({time:'2026-10-22T23:00:00.000Z'});
  f.add({source:'local-test:hidden'});f.add({startedAt:start.toISOString()});f.add({seasonId:2});f.add({seasonId:4});
  f.add({team2:21});
  await serve(f,async read=>{
    const data=await read();
    assert.deepEqual(data.games,[{eventId:earlier,team1:'Moon',team2:'Sun',startAt:'2026-10-23T22:00:00.000Z'},
      {eventId:later,team1:'Moon',team2:'Sun',startAt:'2026-10-24T00:00:00.000Z'},
      {eventId:nextSeason,team1:'Next A',team2:'Next B',startAt:'2026-10-25T00:00:00.000Z'}]);
    assert.equal(JSON.stringify(data).includes('987654'),false);
    f.league.prepare("UPDATE SeasonTeams SET TeamName='Renamed Moon' WHERE TeamSubmissionId=11").run();
    assert.equal((await read()).games[0].team1,'Renamed Moon');
    f.league.exec("UPDATE LeagueSeasons SET Status='ended'");assert.deepEqual(await read(),{games:[]});
  });
});

test('upcoming selection stays bounded and chronological beyond a large played schedule, and drops games at kickoff',async()=>{
  const f=fixture(),expected=[];
  for(let i=0;i<220;i++)f.add({time:'2026-10-22T00:00:00.000Z'});
  for(let i=30;i>0;i--){const time=new Date(start.getTime()+i*60000).toISOString();expected.push({eventId:f.add({time}),team1:'Moon',team2:'Sun',startAt:time});}
  expected.sort((a,b)=>a.startAt.localeCompare(b.startAt));
  await serve(f,async(read,setNow)=>{
    assert.deepEqual((await read()).games,expected.slice(0,20));
    setNow(new Date(start.getTime()+20*60000));assert.deepEqual((await read()).games,expected.slice(20));
  });
});

test('explicit local betting test mode includes labelled test fixtures while production excludes them',async()=>{
  for(const local of [false,true]) {
    const f=fixture(),eventId=f.add({source:'local-test:ticker'});
    await serve(f,async read=>{
      assert.deepEqual((await read()).games,local?[{eventId,team1:'Moon',team2:'Sun',startAt:'2026-10-24T00:00:00.000Z',localTestFixture:true}]:[]);
    },local?{ENVIRONMENT:'DEV',NODE_ENV:'development',BETTING_LOCAL_TEST_MODE:'true'}:{ENVIRONMENT:'PROD',NODE_ENV:'production'});
  }
  const f=fixture();try {
    assert.throws(()=>createUpcomingGamesRouter({league:f.league,env:{ENVIRONMENT:'PROD',NODE_ENV:'production',BETTING_LOCAL_TEST_MODE:'true'}}),/cannot run in production/);
  }finally{f.league.close();}
});
