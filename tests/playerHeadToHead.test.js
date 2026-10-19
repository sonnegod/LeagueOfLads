import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {getHeadToHeadMatches} from '../config/playerHeadToHead.js';

test('H2H counts each match once despite repeated memberships and league links, and uses recorded dates',()=>{
  const db=new Database(':memory:');
  try {
    db.exec(`CREATE TABLE MatchPlayer(MatchId INTEGER,PlayerId INTEGER,Winner INTEGER,Kills INTEGER,Deaths INTEGER,Assists INTEGER);
      CREATE TABLE MatchTeamPlayer(MatchId INTEGER,PlayerId INTEGER,TeamId INTEGER);
      CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,StartTimeUtc INTEGER);
      CREATE TABLE MatchLeague(MatchId INTEGER,DatePlayed TEXT);
      CREATE TABLE TeamInfo(TeamId INTEGER PRIMARY KEY,TeamName TEXT);
      INSERT INTO TeamInfo VALUES(100,'Blue'),(200,'Red');
      INSERT INTO MatchTeam VALUES(1,NULL),(2,1767225600),(3,NULL);
      INSERT INTO MatchLeague VALUES(1,NULL),(1,NULL),(2,'1900-01-01'),(3,'2025-01-01');
      INSERT INTO MatchPlayer VALUES(1,10,0,0,0,0),(1,20,1,0,0,0),
        (2,10,1,10,2,8),(2,20,0,1,5,2),(3,10,1,3,1,6),(3,20,1,4,1,7);
      INSERT INTO MatchTeamPlayer VALUES(1,10,100),(1,10,100),(1,10,100),
        (1,20,200),(1,20,200),(1,20,200),(2,10,100),(2,20,200),(3,10,100),(3,20,100);`);
    const result=getHeadToHeadMatches(db,10,20);
    assert.deepEqual(result.map(m=>m.MatchId),[2,1]); // Same-team games do not count.
    assert.deepEqual(result.map(m=>m.DatePlayed),['2026-01-01T00:00:00Z',null]);
    assert.equal(result.filter(m=>m.P1Won===1).length,1);
    assert.equal(result.filter(m=>m.P1Won===0).length,1);
    assert.equal(result[1].P1KDA,'0/0/0');assert.equal(result[1].P2Team,'Red');
    assert.equal(getHeadToHeadMatches(db,20,10)[1].P1Won,1);
    assert.deepEqual(getHeadToHeadMatches(db,10,10),[]);
    assert.deepEqual(getHeadToHeadMatches(db,10,99),[]);
    db.prepare("UPDATE MatchLeague SET DatePlayed='2024-06-15' WHERE MatchId=1").run();
    assert.equal(getHeadToHeadMatches(db,10,20)[1].DatePlayed,'2024-06-15');
  }finally{db.close();}
});
