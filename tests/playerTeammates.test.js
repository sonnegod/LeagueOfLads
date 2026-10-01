import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getPlayerTeammates } from '../config/playerTeammates.js';

test('teammates count only shared team appearances and require five games in the selected league', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY, PlayerName TEXT);
      CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY, TeamRad INTEGER, TeamDire INTEGER, WinnerId INTEGER);
      CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY, LeagueId INTEGER);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER);
      CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);
      INSERT INTO PlayerInfo VALUES (1, 'Focus'), (2, 'Regular'), (3, 'Cross-season'), (4, 'Missing appearance');`);

    const match = db.prepare('INSERT INTO MatchTeam VALUES (?, 100, 200, ?)');
    const league = db.prepare('INSERT INTO MatchLeague VALUES (?, ?)');
    const appearance = db.prepare('INSERT INTO MatchPlayer VALUES (?, ?)');
    const teamAppearance = db.prepare('INSERT INTO MatchTeamPlayer VALUES (?, ?, ?)');
    for (let matchId = 1; matchId <= 8; matchId += 1) {
      match.run(matchId, [1, 2, 3, 6, 8].includes(matchId) ? 100 : 200);
      league.run(matchId, [6, 8].includes(matchId) ? 20 : 10);
      for (const playerId of [1, 2, 3, 4]) appearance.run(matchId, playerId);
      teamAppearance.run(matchId, 1, matchId === 7 ? 999 : 100);
      teamAppearance.run(matchId, 2, matchId === 6 ? 200 : matchId === 7 ? 999 : 100);
      if (matchId <= 4 || matchId === 6) teamAppearance.run(matchId, 3, 100);
      if (matchId <= 4) teamAppearance.run(matchId, 4, 100);
    }
    teamAppearance.run(1, 2, 100); // A duplicate record must not add a game.

    assert.deepEqual(getPlayerTeammates(db, 1, 'all'), [
      { PlayerId: 2, PlayerName: 'Regular', GamesPlayed: 6, Wins: 4, WinPercentage: 66.67 },
      { PlayerId: 3, PlayerName: 'Cross-season', GamesPlayed: 5, Wins: 4, WinPercentage: 80 },
    ]);
    assert.deepEqual(getPlayerTeammates(db, 1, 10), [
      { PlayerId: 2, PlayerName: 'Regular', GamesPlayed: 5, Wins: 3, WinPercentage: 60 },
    ]);
    assert.deepEqual(getPlayerTeammates(db, 1, 20), []);
  } finally {
    db.close();
  }
});
