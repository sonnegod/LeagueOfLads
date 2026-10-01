import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getLeaguePlayerRecords } from '../config/leaguePlayerRecords.js';
import { isRegularTeamPlayer } from '../client/src/utils/playerTeamEligibility.js';

test('league player records keep a stand-in appearance separate from the main team', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE MatchLeague (MatchId INTEGER, LeagueId INTEGER);
      CREATE TABLE MatchTeam (MatchId INTEGER, TeamRad INTEGER, TeamDire INTEGER, WinnerId INTEGER);
      CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, Kills INTEGER, Deaths INTEGER,
        Assists INTEGER, LastHits INTEGER, GPM INTEGER, XPM INTEGER);
      CREATE TABLE PlayerInfo (PlayerId INTEGER, PlayerName TEXT);
      CREATE TABLE TeamInfo (TeamId INTEGER, TeamName TEXT);
      CREATE TABLE LeagueTeamNames (LeagueId INTEGER, TeamId INTEGER, DisplayName TEXT);
      INSERT INTO MatchLeague VALUES (1, 99), (2, 99), (3, 99), (4, 99);
      INSERT INTO MatchTeam VALUES (1, 10, 20, 10), (2, 10, 20, 20),
        (3, 10, 20, 10), (4, 20, 30, 20);
      INSERT INTO MatchTeamPlayer VALUES (1, 1, 10), (2, 1, 10), (3, 1, 10),
        (4, 1, 20), (4, 1, 20);
      INSERT INTO MatchPlayer VALUES (1, 1, 10, 2, 8, 100, 450, 500),
        (2, 1, 8, 3, 6, 90, 400, 460), (3, 1, 6, 1, 9, 120, 500, 550),
        (4, 1, 1, 5, 4, 40, 320, 350);
      INSERT INTO PlayerInfo VALUES (1, 'Player One');
      INSERT INTO TeamInfo VALUES (10, 'Team Ten'), (20, 'Team Twenty'), (30, 'Team Thirty');
      INSERT INTO LeagueTeamNames VALUES (99, 10, 'Main squad');`);

    const records = getLeaguePlayerRecords(db, 99);
    assert.equal(records.length, 2);
    assert.deepEqual(records.map(row => [row.TeamId, row.TeamName, row.TeamGames, row.GamesPlayed]), [
      [10, 'Main squad', 3, 3], [20, 'Team Twenty', 4, 1],
    ]);
    assert.equal(records[0].AvgKills, 8);
    assert.equal(records[0].WinPercentage, 66.67);
    assert.equal(records[1].AvgKills, 1);
    assert.equal(records[1].WinPercentage, 100);
    assert.equal(isRegularTeamPlayer(records[0].GamesPlayed, records[0].TeamGames, true), true);
    assert.equal(isRegularTeamPlayer(records[1].GamesPlayed, records[1].TeamGames, true), false);
  } finally { db.close(); }
});

test('league spotlights need at least two games and the season participation cutoff', () => {
  assert.equal(isRegularTeamPlayer(1, 1, true), false);
  assert.equal(isRegularTeamPlayer(1, 2, true), false);
  assert.equal(isRegularTeamPlayer(2, 2, true), true);
  assert.equal(isRegularTeamPlayer(2, 3, true), false);
  assert.equal(isRegularTeamPlayer(3, 4, true), true);
  assert.equal(isRegularTeamPlayer(5, 8, true), false);
  assert.equal(isRegularTeamPlayer(6, 8, true), true);
  assert.equal(isRegularTeamPlayer(4, 8, false), false);
  assert.equal(isRegularTeamPlayer(5, 9, true), true);
  assert.equal(isRegularTeamPlayer(4, 9, true), false);
});
