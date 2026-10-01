import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getUnmatchedMatchTeams } from '../config/unmatchedMatchTeams.js';

test('flags active league match TeamIds without a valid group, including matches with no player details', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY, LeagueId INTEGER);
      CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY, TeamRad INTEGER, TeamDire INTEGER);
      CREATE TABLE LeagueGroups (LeagueId INTEGER, TeamId INTEGER, GroupId INTEGER);
      CREATE TABLE GroupNames (LeagueId INTEGER, GroupId INTEGER, GroupName TEXT);
      CREATE TABLE TeamInfo (TeamId INTEGER, TeamName TEXT);
      CREATE TABLE LeagueTeamNames (LeagueId INTEGER, TeamId INTEGER, DisplayName TEXT);
      INSERT INTO MatchLeague VALUES (1, 100), (2, 100), (3, 100), (4, 200);
      INSERT INTO MatchTeam VALUES (1, 10, 20), (2, 10, 30), (3, 30, 20), (4, 40, 50);
      INSERT INTO GroupNames VALUES (100, 1, 'Group A'), (200, 1, 'Other league');
      INSERT INTO LeagueGroups VALUES (100, 10, 1), (100, 20, 1), (100, 30, 99);
      INSERT INTO TeamInfo VALUES (30, 'Original name');
      INSERT INTO LeagueTeamNames VALUES (100, 30, 'Season name');`);

    assert.deepEqual(getUnmatchedMatchTeams(db, 100), [
      { teamId: 30, teamName: 'Season name', matchIds: [3, 2] },
    ]);
    assert.deepEqual(getUnmatchedMatchTeams(db, 200), [
      { teamId: 40, teamName: 'Team 40', matchIds: [4] },
      { teamId: 50, teamName: 'Team 50', matchIds: [4] },
    ]);

    db.exec("INSERT INTO GroupNames VALUES (100, 99, 'Group B')");
    assert.deepEqual(getUnmatchedMatchTeams(db, 100), []);
  } finally { db.close(); }
});
