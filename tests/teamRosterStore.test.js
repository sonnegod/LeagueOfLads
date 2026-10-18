import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import TeamRosterStore from '../config/teamRosterStore.js';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY, PlayerName TEXT);
    CREATE TABLE LeagueSeasons (SeasonId INTEGER PRIMARY KEY, Status TEXT, ExternalLeagueId INTEGER, LeagueName TEXT, EndedAt TEXT);
    CREATE TABLE SeasonTeams (TeamSubmissionId INTEGER PRIMARY KEY, SeasonId INTEGER,
      TeamName TEXT, IsManual INTEGER, ExternalTeamId INTEGER);
    CREATE TABLE SeasonTeamPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER, Slot INTEGER);
    CREATE TABLE LeagueRosterEntries (TeamSubmissionId INTEGER, DisplayName TEXT);
    CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY, TeamRad INTEGER, TeamDire INTEGER);
    CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY, LeagueId INTEGER, DatePlayed TEXT);
    CREATE TABLE LeagueInfo (LeagueId INTEGER PRIMARY KEY, LeagueName TEXT);
    CREATE TABLE TeamInfo (TeamId INTEGER PRIMARY KEY, TeamName TEXT);
    CREATE TABLE LeagueTeamNames (LeagueId INTEGER, TeamId INTEGER, DisplayName TEXT);
    CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER);
    CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);
    INSERT INTO LeagueSeasons (SeasonId, Status, ExternalLeagueId, LeagueName)
      VALUES (1, 'active', 100, 'Current'), (2, 'ended', 200, 'Past'), (3, 'signup_closed', 300, 'Next');
    INSERT INTO SeasonTeams VALUES (1, 1, 'Current team', 0, NULL), (2, 2, 'Past team', 0, 111),
      (3, 3, 'Pending', 0, NULL), (4, 1, 'Manual', 1, 222);
    INSERT INTO LeagueRosterEntries VALUES (1, 'Public team name');`);
  for (let id = 1; id <= 11; id += 1) {
    db.prepare('INSERT INTO PlayerInfo VALUES (?, ?)').run(id, `Player ${id}`);
  }
  for (const [teamId, players] of [[1, [1, 2, 3, 4, 5]], [2, [2, 6, 7, 8, 9]], [3, [1, 2, 3, 4, 5]]]) {
    players.forEach((id, slot) => db.prepare('INSERT INTO SeasonTeamPlayers VALUES (?, ?, ?)').run(teamId, id, slot));
  }
  return db;
}

test('finalized rosters survive later ID linking and corrections, while pending signups stay private', () => {
  const db = fixture();
  try {
    const store = new TeamRosterStore(db);
    const roster = store.forSubmission(1);
    assert.equal(roster.TeamName, 'Public team name');
    assert.equal(roster.TeamId, null);
    assert.deepEqual(roster.players.map(player => player.PlayerId), [1, 2, 3, 4, 5]);
    assert.equal(store.forSubmission(3), null);
    assert.equal(store.forSubmission(4), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS Count FROM TeamRosterPlayers').get().Count, 10);

    db.prepare('UPDATE SeasonTeams SET ExternalTeamId = 111 WHERE TeamSubmissionId = 1').run();
    assert.equal(store.forTeam(111).TeamSubmissionId, 1);
    assert.equal(store.forTeam(111, 200).TeamSubmissionId, 2);
    db.prepare('UPDATE SeasonTeams SET ExternalTeamId = 333 WHERE TeamSubmissionId = 1').run();
    assert.equal(store.forTeam(111, 100), null);
    assert.equal(store.forTeam(333, 100).TeamSubmissionId, 1);
    db.prepare('UPDATE SeasonTeams SET ExternalTeamId = NULL WHERE TeamSubmissionId = 1').run();
    assert.equal(store.forSubmission(1).players.length, 5);
    assert.equal(store.forTeam(333), null);

    db.prepare('UPDATE SeasonTeamPlayers SET PlayerId = 11 WHERE TeamSubmissionId = 1 AND Slot = 0').run();
    new TeamRosterStore(db);
    assert.equal(store.forSubmission(1).players[0].PlayerId, 1);
  } finally { db.close(); }
});

test('stand-ins are determined per team and match league; older records remain unclassified', () => {
  const db = fixture();
  try {
    const store = new TeamRosterStore(db);
    db.prepare('UPDATE SeasonTeams SET ExternalTeamId = 111 WHERE TeamSubmissionId = 1').run();
    db.exec(`INSERT INTO MatchTeam VALUES (1, 111, 222), (2, 111, 222), (3, 111, 222), (4, 333, 222);
      INSERT INTO MatchLeague (MatchId, LeagueId) VALUES (1, 100), (2, 200), (3, 400), (4, 100);
      INSERT INTO MatchTeamPlayer VALUES (1, 1, 111), (1, 1, 111), (1, 6, 111), (1, 11, 222),
        (2, 1, 111), (2, 6, 111), (3, 1, 111), (4, 1, 111);`);
    assert.deepEqual(store.appearances(111), [
      { PlayerId: 1, RosterGames: 1, StandInGames: 1, UnclassifiedGames: 1 },
      { PlayerId: 6, RosterGames: 1, StandInGames: 1, UnclassifiedGames: 0 },
    ]);
    assert.deepEqual(store.appearances(111, 100), [
      { PlayerId: 1, RosterGames: 1, StandInGames: 0, UnclassifiedGames: 0 },
      { PlayerId: 6, RosterGames: 0, StandInGames: 1, UnclassifiedGames: 0 },
    ]);
  } finally { db.close(); }
});

test('legacy teams have lineup history but no active roster, while finalized signups provide the active roster', () => {
  const db = fixture();
  try {
    const store = new TeamRosterStore(db);
    db.exec(`INSERT INTO TeamInfo VALUES (444, 'Legacy team');
      INSERT INTO LeagueInfo VALUES (400, 'Earlier league'), (500, 'Later league');
      INSERT INTO MatchTeam VALUES (10, 444, 222), (11, 222, 444), (12, 111, 222);
      INSERT INTO MatchLeague VALUES (10, 400, '2026-01-01'), (11, 500, '2026-02-01'), (12, 100, '2026-03-01');
      INSERT INTO MatchTeamPlayer VALUES (10, 1, 444), (10, 2, 444),
        (11, 6, 444), (11, 6, 444), (11, 7, 444), (11, 11, 222), (11, 5, 999),
        (11, 8, 444), (12, 6, 111);
      INSERT INTO MatchPlayer VALUES (10, 1), (10, 2), (11, 6), (11, 7), (11, 11), (11, 5), (12, 6);`);
    assert.equal(store.forTeam(444), null);
    assert.equal(store.forTeam(444, 400), null);
    const history = store.historyForTeam(444);
    assert.equal(history[0].MatchId, 11);
    assert.deepEqual(history[0].players.map(player => player.PlayerId), [6, 7]);
    assert.equal(history[1].MatchId, 10);
    assert.deepEqual(history[1].players.map(player => player.PlayerId), [1, 2]);
    assert.equal(store.forTeam(444, 600), null);
    db.prepare('UPDATE SeasonTeams SET ExternalTeamId = 111 WHERE TeamSubmissionId = 1').run();
    const signup = store.forTeam(111);
    assert.equal(signup.Source, 'signup');
    assert.deepEqual(signup.players.map(player => player.PlayerId), [1, 2, 3, 4, 5]);
  } finally { db.close(); }
});

test('roster periods preserve exact new start dates and backfill older dates as estimates', () => {
  const db = fixture();
  try {
    const store = new TeamRosterStore(db);
    assert.equal(store.forSubmission(1).EffectiveFrom, null);
    db.exec(`INSERT INTO MatchLeague VALUES (10, 100, '2026-01-02'), (11, 100, '2026-01-01');
      UPDATE LeagueSeasons SET EndedAt = '2025-12-31T00:00:00Z' WHERE SeasonId = 2;
      UPDATE LeagueSeasons SET Status = 'active' WHERE SeasonId = 3;`);
    store.finalize(3, '2026-04-01T00:00:00Z');
    const older = store.forSubmission(1);
    assert.equal(older.EffectiveFrom, '2026-01-01');
    assert.equal(older.FromEstimated, 1);
    const latest = store.forSubmission(3);
    assert.equal(latest.EffectiveFrom, '2026-04-01T00:00:00Z');
    assert.equal(latest.FromEstimated, 0);
    assert.equal(latest.EffectiveTo, null);
    new TeamRosterStore(db);
    assert.equal(store.forSubmission(3).EffectiveFrom, latest.EffectiveFrom);
    assert.equal(store.forSubmission(2).EffectiveTo, '2025-12-31T00:00:00Z');
    store.endSeason(3, '2026-05-01T00:00:00Z');
    assert.equal(store.forSubmission(3).EffectiveTo, '2026-05-01T00:00:00Z');
  } finally { db.close(); }
});

test('legacy history groups each player once per season across stand-in lineups', () => {
  const db = fixture();
  try {
    const store = new TeamRosterStore(db);
    for (let matchId = 1; matchId <= 5; matchId += 1) {
      const leagueId = matchId === 5 ? 500 : 400;
      db.prepare('INSERT INTO MatchTeam VALUES (?, 444, 222)').run(matchId);
      db.prepare('INSERT INTO MatchLeague VALUES (?, ?, ?)').run(matchId, leagueId, `2026-01-0${matchId}`);
      for (const playerId of matchId === 3 ? [1, 2, 3, 4, 6] : [5, 4, 3, 2, 1]) {
        db.prepare('INSERT INTO MatchTeamPlayer VALUES (?, ?, 444)').run(matchId, playerId);
        db.prepare('INSERT INTO MatchPlayer VALUES (?, ?)').run(matchId, playerId);
      }
    }
    db.exec('INSERT INTO MatchTeamPlayer VALUES(4,1,444); INSERT INTO MatchPlayer VALUES(4,1)');
    const history = store.historyForTeam(444, 400);
    assert.equal(history.length, 1);
    assert.deepEqual(history.map(period => [period.EffectiveFrom, period.EffectiveTo, period.GamesPlayed]), [
      ['2026-01-01', '2026-01-04', 4],
    ]);
    assert.deepEqual(history[0].players.map(player => player.PlayerId), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(history[0].players.map(player => [player.PlayerId, player.GamesPlayed, player.EffectiveFrom, player.EffectiveTo]), [
      [1,4,'2026-01-01','2026-01-04'],[2,4,'2026-01-01','2026-01-04'],
      [3,4,'2026-01-01','2026-01-04'],[4,4,'2026-01-01','2026-01-04'],
      [5,3,'2026-01-01','2026-01-04'],[6,1,'2026-01-03','2026-01-03'],
    ]);
    assert.equal(history[0].MatchId,1);assert.equal(history[0].LastMatchId,4);
    assert.equal(store.historyForTeam(444).length, 2);
    const later=store.historyForTeam(444, 500);
    assert.equal(later.length, 1);
    assert.equal(later[0].GamesPlayed,1);
    assert.deepEqual(later[0].players.map(player=>[player.PlayerId,player.GamesPlayed]),[[1,1],[2,1],[3,1],[4,1],[5,1]]);
  } finally { db.close(); }
});

test('declared history excludes match lineup variations within a signup league', () => {
  const db = fixture();
  try {
    const store = new TeamRosterStore(db);
    db.exec(`UPDATE SeasonTeams SET ExternalTeamId = 111 WHERE TeamSubmissionId = 1;
      INSERT INTO MatchTeam VALUES (1, 111, 222);
      INSERT INTO MatchLeague VALUES (1, 100, '2026-01-01');
      INSERT INTO MatchTeamPlayer VALUES (1, 6, 111);
      INSERT INTO MatchPlayer VALUES (1, 6);`);
    const history = store.historyForTeam(111, 100);
    assert.equal(history.length, 1);
    assert.equal(history[0].Source, 'signup');
    assert.deepEqual(history[0].players.map(player => player.PlayerId), [1, 2, 3, 4, 5]);
    assert.equal(store.historyForTeam(111).length, 2);
  } finally { db.close(); }
});
test('a cleared effective roster is not restored from submissions on restart and keeps its declared history',()=>{
  const db=fixture();try {
    const store=new TeamRosterStore(db);db.prepare('UPDATE SeasonTeams SET ExternalTeamId=111 WHERE TeamSubmissionId=1').run();
    db.exec(`CREATE TABLE TeamRosterMembershipHistory (TeamSubmissionId INTEGER,PlayerId INTEGER,Slot INTEGER,EffectiveFromUtc TEXT,EffectiveToUtc TEXT,FromEstimated INTEGER);
      INSERT INTO TeamRosterMembershipHistory SELECT TeamSubmissionId,PlayerId,Slot,'2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',0 FROM TeamRosterPlayers WHERE TeamSubmissionId=1;
      DELETE FROM TeamRosterPlayers WHERE TeamSubmissionId=1;`);
    new TeamRosterStore(db);
    assert.equal(store.forSubmission(1),null);
    const history=store.historyForTeam(111,100);assert.equal(history.length,1);assert.equal(history[0].players.length,5);
    assert.equal(history[0].EffectiveTo,'2026-10-01T00:00:00Z');
  }finally{db.close();}
});
