import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { deleteMatchRecords, findOrphanMatchRecords, cleanupOrphanMatchRecords } from '../config/matchMaintenance.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY);
    CREATE TABLE MatchPlayer (MatchId INTEGER REFERENCES MatchTeam(MatchId), PlayerId INTEGER);
    CREATE TABLE MatchTeamPlayer (MatchId INTEGER,PlayerId INTEGER,TeamId INTEGER);
    CREATE TABLE PickInfo (MatchId INTEGER,OrderNum INTEGER);
    CREATE TABLE SeriesInfo (SeriesId INTEGER PRIMARY KEY);
    CREATE TABLE SeriesMatch (MatchId INTEGER,SeriesId INTEGER);
    CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY,LeagueId INTEGER);
    CREATE TABLE MatchIngestionState (MatchId INTEGER PRIMARY KEY);
    CREATE TABLE LiveMatchSnapshots (MatchId INTEGER);
    INSERT INTO MatchTeam VALUES (1),(2);
    INSERT INTO MatchPlayer VALUES (1,10),(2,20);
    INSERT INTO MatchTeamPlayer VALUES (1,10,100),(2,20,200),(2,20,200);
    INSERT INTO PickInfo VALUES (1,0),(2,0);
    INSERT INTO SeriesInfo VALUES (50);
    INSERT INTO SeriesMatch VALUES (1,50),(2,50);
    INSERT INTO MatchLeague VALUES (1,1000),(2,2000);
    INSERT INTO MatchIngestionState VALUES (1),(2);
    INSERT INTO LiveMatchSnapshots VALUES (99);`);
  return db;
}

test('match deletion removes every warehouse child before its parent and preserves the rest of a series', () => {
  const db = fixture();
  try {
    const audits = [];
    const deleted = deleteMatchRecords(db,'1',(id,counts) => audits.push({id,counts}));
    assert.deepEqual(deleted,{PickInfo:1,SeriesMatch:1,MatchIngestionState:1,MatchTeamPlayer:1,MatchPlayer:1,MatchLeague:1,MatchTeam:1});
    assert.equal(audits.length,1);assert.equal(audits[0].id,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM SeriesInfo').get().n,1);
    assert.equal(db.prepare('SELECT MatchId FROM SeriesMatch').get().MatchId,2);
    assert.deepEqual(findOrphanMatchRecords(db),{PickInfo:0,SeriesMatch:0,MatchIngestionState:0,MatchTeamPlayer:0,MatchPlayer:0,MatchLeague:0});
    assert.equal(Object.values(deleteMatchRecords(db,1,()=>assert.fail('No-op deletion audited'))).every(n=>n===0),true);
    for(const id of [null,undefined,0,-1,'1 OR 1=1','9007199254740992'])assert.throws(()=>deleteMatchRecords(db,id),/Invalid ID/);
  } finally { db.close(); }
});

test('a failed child delete or audit rolls the complete match deletion back', () => {
  const db = fixture();
  try {
    db.exec("CREATE TRIGGER prevent_series_delete BEFORE DELETE ON SeriesMatch BEGIN SELECT RAISE(ABORT,'blocked'); END");
    assert.throws(()=>deleteMatchRecords(db,1),/blocked/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM PickInfo WHERE MatchId=1').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeam WHERE MatchId=1').get().n,1);
    db.exec('DROP TRIGGER prevent_series_delete');
    assert.throws(()=>deleteMatchRecords(db,1,()=>{throw new Error('Audit failed');}),/Audit failed/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchPlayer WHERE MatchId=1').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchIngestionState WHERE MatchId=1').get().n,1);
  } finally { db.close(); }
});

test('orphan cleanup preserves valid duplicates, live observations and parent series, and is repeatable', () => {
  const db = fixture();
  try {
    db.exec(`INSERT INTO PickInfo VALUES (99,0),(99,1);INSERT INTO SeriesMatch VALUES (99,50);
      INSERT INTO MatchTeamPlayer VALUES (99,90,900);INSERT INTO MatchIngestionState VALUES (99);`);
    const expected={PickInfo:2,SeriesMatch:1,MatchIngestionState:1,MatchTeamPlayer:1,MatchPlayer:0,MatchLeague:0};
    assert.deepEqual(findOrphanMatchRecords(db),expected);
    assert.deepEqual(cleanupOrphanMatchRecords(db),expected);
    assert.equal(Object.values(cleanupOrphanMatchRecords(db)).every(n=>n===0),true);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeamPlayer WHERE MatchId=2').get().n,2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM LiveMatchSnapshots').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM SeriesInfo').get().n,1);
    db.exec('DROP TABLE MatchIngestionState');
    assert.equal('MatchIngestionState' in cleanupOrphanMatchRecords(db),false);
  } finally { db.close(); }
});
