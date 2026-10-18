import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { updateMatchRecord } from '../config/matchRecordAdmin.js';

function fixture(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER);
    CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER);
    CREATE TABLE MatchTeamPlayer(MatchId INTEGER,PlayerId INTEGER,TeamId INTEGER);
    CREATE TABLE SeriesInfo(SeriesId INTEGER PRIMARY KEY AUTOINCREMENT,Team1 INTEGER,Team2 INTEGER,DateCreated TEXT,LeagueId INTEGER,Stage TEXT);
    CREATE TABLE SeriesMatch(SeriesId INTEGER,MatchId INTEGER,DateCreated TEXT);
    INSERT INTO MatchTeam VALUES(1,10,20,10),(2,10,20,20),(3,10,20,10);
    INSERT INTO MatchLeague VALUES(1,100),(2,100),(3,200);`);
  for(const matchId of [1,2,3])for(let p=1;p<=10;p++)db.prepare('INSERT INTO MatchTeamPlayer VALUES(?,?,?)').run(matchId,p,p<=5?10:20);
  return db;
}
const values=(overrides={})=>({matchId:'1',teamRad:'30',teamDire:'20',winnerId:'30',originalTeamRad:'10',originalTeamDire:'20',leagueId:100,...overrides});
const snapshot=db=>Object.fromEntries(['MatchTeam','MatchLeague','MatchTeamPlayer','SeriesInfo','SeriesMatch'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

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
