import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getLeagueSeries, getTeamSeries } from '../config/leagueSeries.js';

test('recent league series include every stage once and stay scoped to the requested league', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE SeriesInfo (SeriesId INTEGER PRIMARY KEY, Team1 INTEGER, Team2 INTEGER,
        DateCreated TEXT, LeagueId INTEGER, Stage TEXT);
      CREATE TABLE TeamInfo (TeamId INTEGER PRIMARY KEY, TeamName TEXT);
      CREATE TABLE SeriesMatch (SeriesId INTEGER, MatchId INTEGER);
      CREATE TABLE MatchLeague (MatchId INTEGER, LeagueId INTEGER);
      CREATE TABLE LeagueInfo (LeagueId INTEGER PRIMARY KEY, Active INTEGER);
      CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER, GroupEndMatchId INTEGER,
        TieBreakerEndMatchId INTEGER);
      INSERT INTO TeamInfo VALUES (10, 'First'), (20, 'Second');
      INSERT INTO LeagueInfo VALUES (21, 0), (22, 0), (23, 1);
      INSERT INTO LeagueStageBoundaries VALUES (21, 100, 200);
      INSERT INTO SeriesInfo VALUES
        (1, 10, 20, '2026-08-16', 21, 'g'),
        (2, 10, 20, '2026-08-17', 21, 't'),
        (3, 10, 20, '2026-09-21', 21, 'p'),
        (4, 10, 20, '2026-09-22', 22, 'g'),
        (5, 10, 20, '2026-09-23', 21, 'p');
      INSERT INTO SeriesMatch VALUES (1, 100), (2, 200), (3, 300), (3, 301), (4, 400);
      INSERT INTO MatchLeague VALUES (100, 21), (200, 21), (300, 21), (301, 21), (400, 22);
    `);

    const series = getLeagueSeries(db, 21);
    assert.deepEqual(series.map(row => row.SeriesId), [3, 2, 1]);
    assert.deepEqual(series[0], {
      SeriesId: 3, Team1: 10, Team2: 20,
      team_one: 'First', team_two: 'Second', DateCreated: '2026-09-21',
    });
    assert.deepEqual(getLeagueSeries(db, 22).map(row => row.SeriesId), [4]);
    // An explicitly selected empty season must not show another season's results.
    assert.deepEqual(getLeagueSeries(db, 23), []);
    assert.deepEqual(getLeagueSeries(db, 99), []);
    db.exec('DELETE FROM SeriesMatch');
    assert.deepEqual(getLeagueSeries(db, 21), []);
  } finally {
    db.close();
  }
});

test('team series include either side across seasons, exclude empty series and sort by played date', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE SeriesInfo (SeriesId INTEGER PRIMARY KEY, Team1 INTEGER, Team2 INTEGER, DateCreated TEXT);
      CREATE TABLE TeamInfo (TeamId INTEGER PRIMARY KEY, TeamName TEXT);
      CREATE TABLE SeriesMatch (SeriesId INTEGER, MatchId INTEGER);
      CREATE TABLE MatchLeague (MatchId INTEGER, LeagueId INTEGER);
      INSERT INTO TeamInfo VALUES (10,'First'),(20,'Second'),(30,'Third');
      INSERT INTO SeriesInfo VALUES (1,10,20,'2026-10-25'),(2,30,10,'2026-10-24'),
        (3,20,30,'2026-10-26'),(4,10,20,'2026-10-26'),(5,10,30,'2026-09-01');
      INSERT INTO SeriesMatch VALUES (1,100),(1,101),(2,200),(3,300),(5,500);
      INSERT INTO MatchLeague VALUES (100,22),(101,22),(200,22),(300,22),(500,21);
    `);
    assert.deepEqual(getTeamSeries(db, 10, 'all').map(row => row.SeriesId), [1,2,5]);
    assert.deepEqual(getTeamSeries(db, '10', '22').map(row => row.SeriesId), [1,2]);
    assert.deepEqual(getTeamSeries(db, 10, 21).map(row => row.SeriesId), [5]);
    assert.deepEqual(getTeamSeries(db, 10).map(row => row.SeriesId), [1,2,5]);
    assert.deepEqual(getTeamSeries(db, 10, 99), []);
    assert.deepEqual(getTeamSeries(db, 99, 'all'), []);
  } finally { db.close(); }
});
