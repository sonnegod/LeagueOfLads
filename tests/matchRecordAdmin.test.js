import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { updateMatchRecord } from '../config/matchRecordAdmin.js';
import { rebuildLeagueGroupStandings } from '../config/groupStandings.js';

function fixture(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER);
    CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER);
    CREATE TABLE MatchTeamPlayer(MatchId INTEGER,PlayerId INTEGER,TeamId INTEGER);
    CREATE TABLE SeriesInfo(SeriesId INTEGER PRIMARY KEY AUTOINCREMENT,Team1 INTEGER,Team2 INTEGER,DateCreated TEXT,LeagueId INTEGER,Stage TEXT);
    CREATE TABLE SeriesMatch(SeriesId INTEGER,MatchId INTEGER,DateCreated TEXT);
    CREATE TABLE GroupNames(LeagueId INTEGER,GroupId INTEGER);
    CREATE TABLE LeagueGroups(LeagueId INTEGER,TeamId INTEGER,GroupId INTEGER);
    CREATE TABLE LeagueStageBoundaries(LeagueId INTEGER PRIMARY KEY,GroupEndMatchId INTEGER);
    CREATE TABLE GroupResultOverrides(LeagueId INTEGER,GroupId INTEGER,TeamA INTEGER,TeamB INTEGER,
      WinsA INTEGER,WinsB INTEGER,BaseWinsA INTEGER,BaseWinsB INTEGER);
    CREATE TABLE LeagueStandings(LeagueId INTEGER,TeamId INTEGER,Wins INTEGER,Losses INTEGER,PRIMARY KEY(LeagueId,TeamId));
    CREATE TABLE Neustadtl(LeagueId INTEGER,TeamId INTEGER,Score INTEGER,PRIMARY KEY(TeamId,LeagueId));
    CREATE TABLE BettingRefreshState(Id INTEGER PRIMARY KEY,RequestedRevision INTEGER DEFAULT 0,
      CompletedRevision INTEGER DEFAULT 0,RequestedAtUtc TEXT,AnalyticsRequestedRevision INTEGER DEFAULT 0);
    INSERT INTO BettingRefreshState(Id) VALUES(1);
    INSERT INTO MatchTeam VALUES(1,10,20,10),(2,10,20,20),(3,10,20,10);
    INSERT INTO MatchLeague VALUES(1,100),(2,100),(3,200);`);
  for(const matchId of [1,2,3])for(let p=1;p<=10;p++)db.prepare('INSERT INTO MatchTeamPlayer VALUES(?,?,?)').run(matchId,p,p<=5?10:20);
  return db;
}
const values=(overrides={})=>({matchId:'1',teamRad:'30',teamDire:'20',winnerId:'30',originalTeamRad:'10',originalTeamDire:'20',leagueId:100,...overrides});
const snapshot=db=>Object.fromEntries(['MatchTeam','MatchLeague','MatchTeamPlayer','SeriesInfo','SeriesMatch','LeagueStandings','Neustadtl','BettingRefreshState'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const standings=(db,leagueId=100)=>db.prepare(`SELECT s.TeamId,s.Wins,s.Losses,n.Score
  FROM LeagueStandings s JOIN Neustadtl n USING(LeagueId,TeamId) WHERE s.LeagueId=? ORDER BY s.TeamId`).all(leagueId);
function addGroups(db){
  db.exec(`INSERT INTO GroupNames VALUES(100,1),(200,1);
    INSERT INTO LeagueGroups VALUES(100,20,1),(100,30,1),(100,40,1),(200,10,1),(200,20,1),(200,30,1);
    INSERT INTO LeagueStageBoundaries VALUES(100,4);
    INSERT INTO MatchTeam VALUES(4,20,40,20),(5,30,20,30);
    INSERT INTO MatchLeague VALUES(4,100),(5,100);
    INSERT INTO LeagueStandings VALUES(100,10,7,8);
    INSERT INTO Neustadtl VALUES(100,10,99);`);
  rebuildLeagueGroupStandings(db,100);rebuildLeagueGroupStandings(db,200);
}

test('correcting an ungrouped match team immediately credits the official group team and recalculates Neustadtl',()=>{
  const db=fixture();try{
    addGroups(db);const otherSeason=standings(db,200);
    assert.deepEqual(standings(db),[{TeamId:10,Wins:0,Losses:0,Score:0},{TeamId:20,Wins:1,Losses:0,Score:0},
      {TeamId:30,Wins:0,Losses:0,Score:0},{TeamId:40,Wins:0,Losses:1,Score:0}]);
    updateMatchRecord(db,values(),()=>{
      // A successful save and its audit already see the corrected standings.
      assert.equal(db.prepare('SELECT Wins FROM LeagueStandings WHERE LeagueId=100 AND TeamId=30').get().Wins,1);
    });
    assert.deepEqual(standings(db),[{TeamId:10,Wins:0,Losses:0,Score:0},{TeamId:20,Wins:1,Losses:1,Score:0},
      {TeamId:30,Wins:1,Losses:0,Score:1},{TeamId:40,Wins:0,Losses:1,Score:0}]);
    assert.deepEqual(standings(db,200),otherSeason);
  }finally{db.close();}
});

test('winner-only corrections refresh every affected group score while postseason games stay outside standings',()=>{
  const db=fixture();try{
    addGroups(db);updateMatchRecord(db,values());
    updateMatchRecord(db,values({matchId:4,teamRad:20,teamDire:40,winnerId:40,originalTeamRad:20,originalTeamDire:40}));
    assert.deepEqual(standings(db),[{TeamId:10,Wins:0,Losses:0,Score:0},{TeamId:20,Wins:0,Losses:2,Score:0},
      {TeamId:30,Wins:1,Losses:0,Score:0},{TeamId:40,Wins:1,Losses:0,Score:0}]);
    const before=standings(db);
    updateMatchRecord(db,values({matchId:5,teamRad:30,teamDire:20,winnerId:20,originalTeamRad:30,originalTeamDire:20}));
    assert.deepEqual(standings(db),before);
  }finally{db.close();}
});

test('corrections retain manual result overrides and rebuild all linked leagues rather than only the selected season',()=>{
  const db=fixture();try{
    addGroups(db);
    db.exec(`INSERT INTO GroupResultOverrides VALUES(100,1,20,30,0,2,0,0);
      INSERT INTO MatchLeague VALUES(1,200);`);
    updateMatchRecord(db,values());
    assert.deepEqual(standings(db),[{TeamId:10,Wins:0,Losses:0,Score:0},{TeamId:20,Wins:1,Losses:3,Score:0},
      {TeamId:30,Wins:3,Losses:0,Score:3},{TeamId:40,Wins:0,Losses:1,Score:0}]);
    assert.deepEqual(standings(db,200),[{TeamId:10,Wins:1,Losses:0,Score:0},{TeamId:20,Wins:0,Losses:2,Score:0},
      {TeamId:30,Wins:1,Losses:0,Score:0}]);
    assert.equal(db.prepare('SELECT WinsB FROM GroupResultOverrides').get().WinsB,2);
  }finally{db.close();}
});

test('standings rebuild or audit failures roll back the correction and all derived rows together',()=>{
  const db=fixture();try{
    addGroups(db);
    db.exec(`INSERT INTO SeriesInfo VALUES(1,10,20,'2026-01-01',100,'g');
      INSERT INTO SeriesMatch VALUES(1,1,'2026-01-01'),(1,2,'2026-01-01');`);
    const before=snapshot(db);
    assert.throws(()=>updateMatchRecord(db,values(),()=>{throw new Error('audit unavailable');}),/audit unavailable/);
    assert.deepEqual(snapshot(db),before);
    db.exec(`CREATE TRIGGER standings_unavailable BEFORE INSERT ON Neustadtl BEGIN
      SELECT RAISE(ABORT,'standings unavailable'); END;`);
    assert.throws(()=>updateMatchRecord(db,values()),/standings unavailable/);
    assert.deepEqual(snapshot(db),before);
  }finally{db.close();}
});

test('legacy matches without a series are corrected atomically, preserving the opposite side and other seasons',()=>{
  const db=fixture();
  try{
    const audits=[];
    assert.equal(updateMatchRecord(db,values(),(...args)=>audits.push(args)).success,true);
    assert.deepEqual(db.prepare('SELECT TeamId,COUNT(*) players FROM MatchTeamPlayer WHERE MatchId=1 GROUP BY TeamId ORDER BY TeamId').all(),[{TeamId:20,players:5},{TeamId:30,players:5}]);
    assert.deepEqual(db.prepare('SELECT * FROM MatchTeam WHERE MatchId=3').get(),{MatchId:3,TeamRad:10,TeamDire:20,WinnerId:10});
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeamPlayer WHERE MatchId<>1 AND TeamId=30').get().n,0);
    assert.equal(audits.length,1);assert.match(audits[0][1],/Match 1/);
  }finally{db.close();}
});

test('swapping teams maps each original side once, and winner-only edits leave membership unchanged',()=>{
  const db=fixture();
  try{
    updateMatchRecord(db,values({teamRad:20,teamDire:10,winnerId:20}));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeamPlayer WHERE MatchId=1 AND PlayerId<=5 AND TeamId=20').get().n,5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeamPlayer WHERE MatchId=1 AND PlayerId>5 AND TeamId=10').get().n,5);
    const members=db.prepare('SELECT * FROM MatchTeamPlayer').all();
    updateMatchRecord(db,values({teamRad:20,teamDire:10,winnerId:10,originalTeamRad:20,originalTeamDire:10}));
    assert.deepEqual(db.prepare('SELECT * FROM MatchTeamPlayer').all(),members);
    assert.equal(db.prepare('SELECT WinnerId FROM MatchTeam WHERE MatchId=1').get().WinnerId,10);
  }finally{db.close();}
});

test('series reassignment moves just the edited game and matches season, date and stage',()=>{
  const db=fixture();
  try{
    db.exec(`INSERT INTO SeriesInfo VALUES(1,10,20,'2026-01-01',100,'g'),
      (2,30,20,'2026-01-02',100,'g'),(3,30,20,'2026-01-01',200,'g'),
      (4,30,20,'2026-01-01',100,'p'),(5,30,20,'2026-01-01',100,'g');
      INSERT INTO SeriesMatch VALUES(1,1,'2026-01-01'),(1,2,'2026-01-01'),(3,3,'2026-01-01');`);
    updateMatchRecord(db,values());
    assert.equal(db.prepare('SELECT SeriesId FROM SeriesMatch WHERE MatchId=1').get().SeriesId,5);
    assert.equal(db.prepare('SELECT SeriesId FROM SeriesMatch WHERE MatchId=2').get().SeriesId,1);
    assert.equal(db.prepare('SELECT SeriesId FROM SeriesMatch WHERE MatchId=3').get().SeriesId,3);
    assert.equal(db.prepare('SELECT Team1 FROM SeriesInfo WHERE SeriesId=1').get().Team1,10);
  }finally{db.close();}
});

test('a corrected game gets its own series when the old series still contains another matchup',()=>{
  const db=fixture();
  try{
    db.exec(`INSERT INTO SeriesInfo VALUES(1,10,20,'2026-01-01',100,'g');
      INSERT INTO SeriesMatch VALUES(1,1,'2026-01-01'),(1,2,'2026-01-01');`);
    updateMatchRecord(db,values());
    const next=db.prepare('SELECT SeriesId FROM SeriesMatch WHERE MatchId=1').get().SeriesId;
    assert.notEqual(next,1);
    assert.deepEqual(db.prepare('SELECT Team1,Team2,LeagueId,Stage FROM SeriesInfo WHERE SeriesId=?').get(next),{Team1:30,Team2:20,LeagueId:100,Stage:'g'});
    assert.equal(db.prepare('SELECT SeriesId FROM SeriesMatch WHERE MatchId=2').get().SeriesId,1);
  }finally{db.close();}
});

test('an audit failure rolls back teams, memberships and newly created series',()=>{
  const db=fixture();
  try{
    db.exec(`INSERT INTO SeriesInfo VALUES(1,10,20,'2026-01-01',100,'g');
      INSERT INTO SeriesMatch VALUES(1,1,'2026-01-01'),(1,2,'2026-01-01');`);
    const before=snapshot(db);
    assert.throws(()=>updateMatchRecord(db,values(),()=>{throw new Error('audit unavailable');}),/audit unavailable/);
    assert.deepEqual(snapshot(db),before);
  }finally{db.close();}
});

test('wrong-season, stale-client and invalid-result corrections leave all records intact',()=>{
  const db=fixture();
  try{
    const before=snapshot(db);
    for(const [change,status] of [[{leagueId:200},404],[{originalTeamRad:99},409],[{teamDire:30},400],[{winnerId:99},400]]){
      assert.throws(()=>updateMatchRecord(db,values(change)),error=>error.status===status);
      assert.deepEqual(snapshot(db),before);
    }
  }finally{db.close();}
});
