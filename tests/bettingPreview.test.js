import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildHistoricalPreview,historicalOutcomes,historicalPreviewPath,saveHistoricalPreview,readHistoricalPreview} from '../betting/historicalPreview.js';
import {BettingStore} from '../betting/store.js';
import express from 'express';
import {createBettingRoutes} from '../routes/bettingRoutes.js';

function fixture() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE LeagueInfo (LeagueId INTEGER PRIMARY KEY,LeagueName TEXT);
    CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY,LeagueId INTEGER,DatePlayed TEXT);
    CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER,Duration INTEGER,Rehost INTEGER);
    CREATE TABLE MatchPlayer (MatchId INTEGER,PlayerId INTEGER,Kills REAL,Deaths REAL,Assists REAL,Lasthits REAL,HeroDamage REAL,TowerDamage REAL,Healing REAL,GPM REAL,XPM REAL);
    CREATE TABLE MatchTeamPlayer (MatchId INTEGER,PlayerId INTEGER,TeamId INTEGER);
    CREATE TABLE TeamInfo (TeamId INTEGER,TeamName TEXT);
    CREATE TABLE PlayerInfo (PlayerId INTEGER,PlayerName TEXT);
    CREATE TABLE LeagueGroups (LeagueId INTEGER,TeamId INTEGER,GroupId INTEGER);
    CREATE TABLE LeagueRules (LeagueId INTEGER,UpperBracketTeams INTEGER,LowerBracketTeams INTEGER,EliminatedTeams INTEGER,HasTiebreaker INTEGER,TiebreakerPosition INTEGER);
    CREATE TABLE SeriesInfo (SeriesId INTEGER,LeagueId INTEGER,Team1 INTEGER,Team2 INTEGER,DateCreated TEXT,Stage TEXT);
    CREATE TABLE SeriesMatch (SeriesId INTEGER,MatchId INTEGER);
    INSERT INTO LeagueInfo VALUES(20,'Season 20'),(21,'Season 21'),(22,'Future season');
    INSERT INTO LeagueRules VALUES(21,2,2,0,0,NULL);`);
  for(let t=101;t<=104;t++){
    db.prepare('INSERT INTO TeamInfo VALUES(?,?)').run(t,`Team ${t}`);db.prepare('INSERT INTO LeagueGroups VALUES(21,?,1)').run(t);
    for(let slot=0;slot<5;slot++){const p=(t-101)*5+slot+1;db.prepare('INSERT INTO PlayerInfo VALUES(?,?)').run(p,`Player ${p}`);}
  }
  function game(matchId,leagueId,day,a,b) {
    db.prepare('INSERT INTO MatchLeague VALUES(?,?,?)').run(matchId,leagueId,day);
    db.prepare('INSERT INTO MatchTeam VALUES(?,?,?,?,3000,0)').run(matchId,a,b,matchId%2?a:b);
    for(const team of [a,b])for(let slot=0;slot<5;slot++) {
      const p=(team-101)*5+slot+1;db.prepare('INSERT INTO MatchTeamPlayer VALUES(?,?,?)').run(matchId,p,team);
      db.prepare('INSERT INTO MatchPlayer VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(matchId,p,p+matchId%3,4,10,200,20000,1000,100,450+p,600+p);
    }
  }
  for(let n=1;n<=12;n++)game(n,20,`2026-02-${String(n).padStart(2,'0')}`,n%2?101:103,n%2?102:104);
  for(let n=1;n<=4;n++)game(1000+n,21,n<=2?'2026-03-01':'2026-03-02',n<=2?101:103,n<=2?102:104);
  game(2000,22,'2026-04-01',101,102);
  db.exec(`INSERT INTO SeriesInfo VALUES(1,21,101,102,'2026-03-01','g'),(2,21,103,104,'2026-03-02','g');
    INSERT INTO SeriesMatch VALUES(1,1001),(1,1002),(2,1003),(2,1004);`);
  return db;
}

test('historical preseason and played-series prices exclude every target result/stat and later season',()=>{
  const db=fixture();try {
    const options={leagueId:21,matchRosters:true,simulations:100};
    const preview=buildHistoricalPreview(db,options);
    assert.equal(preview.trainingLeagueId,20);assert.equal(preview.trainingGames,12);
    assert.ok(preview.preseasonMarkets>20);assert.ok(preview.seriesMarkets>20);
    assert.equal(preview.rosterSource,'first_complete_recorded_lineup');
    assert.ok(preview.markets.some(m=>m.type==='player_leader'));assert.ok(preview.markets.some(m=>m.type==='champion'));
    assert.ok(preview.privateInputs.inputs.metricHistory.every(p=>p.LeagueId===20&&p.MatchId<1001));
    const results=historicalOutcomes(db,preview);
    db.exec(`UPDATE MatchPlayer SET Kills=999999,Deaths=999999,Assists=999999,Lasthits=999999,HeroDamage=999999,TowerDamage=999999,Healing=999999,GPM=999999,XPM=999999 WHERE MatchId>=1000;
      UPDATE MatchTeam SET WinnerId=TeamRad,Duration=999999 WHERE MatchId>=1000;`);
    const changed=buildHistoricalPreview(db,options);
    assert.equal(changed.inputDigest,preview.inputDigest);assert.deepEqual(changed.markets,preview.markets);
    assert.notDeepEqual(historicalOutcomes(db,changed),results);
    assert.throws(()=>buildHistoricalPreview(db,{...options,trainingLeagueId:22}),/wholly earlier/);
    assert.throws(()=>buildHistoricalPreview(db,{...options,trainingLeagueId:21}),/wholly earlier/);
  }finally{db.close();}
});

test('preview storage is idempotent, private inputs stay out of web payloads, and live betting rejects the preview database',()=>{
  const db=fixture();const directory=mkdtempSync(join(tmpdir(),'lads-historical-bet-'));let previewDb;
  try {
    const preview=buildHistoricalPreview(db,{leagueId:21,matchRosters:true,simulations:100});
    preview.privateInputs.privateSentinel='SECRET_MODEL_INPUT';
    const path=historicalPreviewPath(join(directory,'Betting.db'),21);const outcomes=historicalOutcomes(db,preview);
    const run=saveHistoricalPreview(path,preview,outcomes);assert.equal(saveHistoricalPreview(path,preview,outcomes),run);
    const payload=readHistoricalPreview(path,{scope:'preseason'});assert.equal(payload.markets.length,20);assert.ok(payload.nextBefore);
    assert.equal(JSON.stringify(payload).includes('SECRET_MODEL_INPUT'),false);
    for(const field of ['privateInputs','SignupMMR','Probability','seed','InputJson'])assert.equal(JSON.stringify(payload).includes(field),false);
    const second=readHistoricalPreview(path,{scope:'preseason',before:payload.nextBefore});
    assert.ok(second.markets.every(m=>!payload.markets.some(p=>p.marketId===m.marketId)));
    const players=readHistoricalPreview(path,{preseasonGroup:'player'});
    assert.equal(players.markets.length,20);assert.ok(players.markets.every(m=>['season_player','player_leader'].includes(m.type)));
    const playerPage2=readHistoricalPreview(path,{preseasonGroup:'player',before:players.nextBefore});
    assert.ok(playerPage2.markets.every(m=>['season_player','player_leader'].includes(m.type)&&!players.markets.some(p=>p.marketId===m.marketId)));
    const teams=readHistoricalPreview(path,{preseasonGroup:'team'});
    assert.ok(teams.markets.length);assert.ok(teams.markets.every(m=>['champion','placement'].includes(m.type)));
    const teamGroups=readHistoricalPreview(path,{preseasonGroup:'team',groupTeams:true,groupNames:{1:'Test group'}});
    assert.equal(teamGroups.teamGroups.length,1);assert.equal(teamGroups.teamGroups[0].name,'Test group');
    assert.deepEqual(teamGroups.teamGroups[0].teams.map(t=>t.name),['Team 101','Team 102','Team 103','Team 104']);
    assert.ok(teamGroups.teamGroups[0].teams.every(t=>t.championOdds>1&&t.placement.length===2));
    assert.equal(teamGroups.markets.length,0);assert.equal(teamGroups.nextBefore,null);
    const filteredTeams=readHistoricalPreview(path,{preseasonGroup:'team',groupTeams:true,search:'Team 102'});
    assert.deepEqual(filteredTeams.teamGroups[0].teams.map(t=>t.teamId),[102]);
    const grouped=readHistoricalPreview(path,{preseasonGroup:'player',groupPlayers:true});
    assert.equal(grouped.players.length,20);assert.equal(grouped.markets.length,0);
    assert.ok(grouped.players.every(p=>p.markets.length===16&&new Set(p.markets.map(m=>m.stat)).size===9));
    assert.equal(grouped.leaderMarkets.length,4);
    const matching=readHistoricalPreview(path,{preseasonGroup:'player',groupPlayers:true,search:'Healing'});
    assert.ok(matching.players.length);assert.ok(matching.players.every(p=>p.markets.length===2&&p.markets.every(m=>m.stat==='healing')));
    previewDb=new Database(path);assert.throws(()=>new BettingStore(previewDb),/cannot be used as a live betting database/);
    assert.equal(previewDb.prepare("SELECT 1 FROM sqlite_master WHERE name='BettingWallets'").get(),undefined);
    assert.throws(()=>historicalPreviewPath(path,'../Betting.db'),/Invalid preview/);
  }finally{previewDb?.close();db.close();rmSync(directory,{recursive:true,force:true});}
});

test('missing original setup holds preseason, and conflicting reconstructed players are withheld',()=>{
  const db=fixture();try {
    const missing=buildHistoricalPreview(db,{leagueId:21,simulations:100});assert.equal(missing.preseasonMarkets,0);assert.ok(missing.seriesMarkets);
    db.exec('UPDATE MatchTeamPlayer SET PlayerId=1 WHERE MatchId=1003 AND PlayerId=11');
    const preview=buildHistoricalPreview(db,{leagueId:21,matchRosters:true,simulations:100});
    assert.deepEqual(preview.conflictingPlayers,[1]);
    assert.equal(preview.markets.some(m=>m.scope==='preseason'&&m.playerId===1),false);
    assert.ok(preview.held.some(h=>h.reason==='conflicting_reconstructed_roster'));
    assert.equal(preview.markets.some(m=>m.type==='player_leader'),false);
  }finally{db.close();}
});

test('historical preview web reads require admin access and contain no private setup values',async()=>{
  const db=fixture();const directory=mkdtempSync(join(tmpdir(),'lads-historical-api-'));let server;const betting=new Database(join(directory,'Betting.db'));
  try {
    const book=new BettingStore(betting);const preview=buildHistoricalPreview(db,{leagueId:21,matchRosters:true,simulations:100});
    preview.privateInputs.hidden='PRIVATE_HISTORICAL_FEATURE';
    saveHistoricalPreview(historicalPreviewPath(betting.name,21),preview,historicalOutcomes(db,preview));
    const routes=createBettingRoutes({book,league:db,schedules:{},analyticsPath:'unused'});const app=express();
    app.use('/api/betting',routes.publicRoutes);app.use('/api/admin/betting',(req,res,next)=>req.headers['x-test-admin']==='yes'?next():res.status(403).json({error:'Forbidden'}),routes.adminRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/admin/betting/preview?leagueId=21`)).status,403);
    assert.equal((await fetch(`${base}/api/betting/preview?leagueId=21`)).status,404);
    const response=await fetch(`${base}/api/admin/betting/preview?leagueId=21`,{headers:{'x-test-admin':'yes'}});assert.equal(response.status,200);
    const text=await response.text();for(const field of ['PRIVATE_HISTORICAL_FEATURE','PrivateInputsJson','AverageSignupMMR','SignupMMR','Probability'])assert.equal(text.includes(field),false);
    assert.equal((await fetch(`${base}/api/admin/betting/preview?leagueId=21&scope=invalid`,{headers:{'x-test-admin':'yes'}})).status,400);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));db.close();betting.close();rmSync(directory,{recursive:true,force:true});}
});
