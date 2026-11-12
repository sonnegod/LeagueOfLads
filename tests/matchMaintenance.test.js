import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { deleteMatchRecords, findOrphanMatchRecords, cleanupOrphanMatchRecords } from '../config/matchMaintenance.js';
import { rebuildLeagueGroupStandings } from '../config/groupStandings.js';

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

function standingsFixture() {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../scripts/db/ladsData.schema.sql', import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE GroupResultOverrides(LeagueId INTEGER,GroupId INTEGER,TeamA INTEGER,TeamB INTEGER,
      WinsA INTEGER,WinsB INTEGER,BaseWinsA INTEGER,BaseWinsB INTEGER);
    CREATE TABLE BettingRefreshState(Id INTEGER PRIMARY KEY,RequestedRevision INTEGER DEFAULT 0,
      CompletedRevision INTEGER DEFAULT 0,RequestedAtUtc TEXT,AnalyticsRequestedRevision INTEGER DEFAULT 0);
    INSERT INTO BettingRefreshState(Id) VALUES(1);
    CREATE TABLE MatchResultsState(Id INTEGER PRIMARY KEY,Revision INTEGER);
    INSERT INTO MatchResultsState VALUES(1,0);
    INSERT INTO LeagueInfo VALUES(100,'Current',1),(200,'Other season',0);
    INSERT INTO GroupNames(LeagueId,GroupId,GroupName) VALUES(100,1,'Moon'),(200,1,'Other');
    INSERT INTO LeagueGroups(LeagueId,TeamId,GroupId) VALUES(100,10,1),(100,20,1),(100,30,1),(200,40,1),(200,50,1);
    INSERT INTO LeagueStageBoundaries(LeagueId,GroupEndMatchId) VALUES(100,3);
    INSERT INTO MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,SeriesId) VALUES(1,10,20,10,0),(2,20,30,20,0),
      (3,10,30,10,0),(4,40,50,40,0),(5,10,20,20,0);
    INSERT INTO MatchLeague VALUES(1,100,NULL),(2,100,NULL),(3,100,NULL),(4,200,NULL),(5,100,NULL);`);
  rebuildLeagueGroupStandings(db,100);rebuildLeagueGroupStandings(db,200);
  return db;
}
const standings = (db, leagueId = 100) => db.prepare(`SELECT s.TeamId,s.Wins,s.Losses,n.Score
  FROM LeagueStandings s JOIN Neustadtl n USING(LeagueId,TeamId) WHERE s.LeagueId=? ORDER BY s.TeamId`).all(leagueId);

test('deletion removes the winner’s win and loser’s loss and recalculates all group tiebreak scores', () => {
  const db = standingsFixture();
  try {
    const otherSeason = standings(db,200);
    assert.deepEqual(standings(db), [{TeamId:10,Wins:2,Losses:0,Score:1},{TeamId:20,Wins:1,Losses:1,Score:0},
      {TeamId:30,Wins:0,Losses:2,Score:0}]);
    deleteMatchRecords(db,2,()=>{
      assert.equal(db.prepare('SELECT Losses FROM LeagueStandings WHERE LeagueId=100 AND TeamId=30').get().Losses,1,
        'The successful delete and audit already see the rebuilt standings');
    });
    assert.deepEqual(standings(db), [{TeamId:10,Wins:2,Losses:0,Score:0},{TeamId:20,Wins:0,Losses:1,Score:0},
      {TeamId:30,Wins:0,Losses:1,Score:0}]);
    assert.deepEqual(standings(db,200),otherSeason);
    const state = db.prepare('SELECT * FROM BettingRefreshState').get();
    assert.equal(state.RequestedRevision,1);assert.equal(state.AnalyticsRequestedRevision,1);
    assert.equal(db.prepare('SELECT Revision FROM MatchResultsState').get().Revision,1);
    const beforePostseason = standings(db);
    deleteMatchRecords(db,5);
    assert.deepEqual(standings(db),beforePostseason,'Postseason deletion does not change group results');
    deleteMatchRecords(db,1);deleteMatchRecords(db,3);
    assert.ok(standings(db).every(team=>team.Wins===0&&team.Losses===0&&team.Score===0));
    assert.deepEqual(standings(db,200),otherSeason);
  } finally { db.close(); }
});

test('deletion respects head-to-head overrides and rolls back the match and standings if rebuild or audit fails', () => {
  const db = standingsFixture();
  try {
    db.exec('INSERT INTO GroupResultOverrides VALUES(100,1,10,20,2,0,1,0)');
    rebuildLeagueGroupStandings(db,100);
    deleteMatchRecords(db,1);
    assert.equal(db.prepare('SELECT Wins FROM LeagueStandings WHERE LeagueId=100 AND TeamId=10').get().Wins,3);
    assert.equal(db.prepare('SELECT WinsA FROM GroupResultOverrides').get().WinsA,2);
    const before = standings(db), revision = db.prepare('SELECT Revision FROM MatchResultsState').get().Revision;
    db.exec("CREATE TRIGGER prevent_standings_update BEFORE UPDATE ON LeagueStandings BEGIN SELECT RAISE(ABORT,'standings blocked'); END");
    assert.throws(()=>deleteMatchRecords(db,2),/standings blocked/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeam WHERE MatchId=2').get().n,1);
    assert.deepEqual(standings(db),before);
    db.exec('DROP TRIGGER prevent_standings_update');
    assert.throws(()=>deleteMatchRecords(db,2,()=>{throw Error('Audit failed');}),/Audit failed/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeam WHERE MatchId=2').get().n,1);
    assert.deepEqual(standings(db),before);
    assert.equal(db.prepare('SELECT Revision FROM MatchResultsState').get().Revision,revision);
    assert.equal(db.prepare('SELECT RequestedRevision FROM BettingRefreshState').get().RequestedRevision,1);
  } finally { db.close(); }
});
