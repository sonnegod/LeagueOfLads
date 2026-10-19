import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getLeagueRegisteredTeams, includeRegisteredTeams, includeRegisteredPlayers, saveRegisteredLeagueTeam } from '../config/leagueParticipants.js';
import { getLeaguePlayerRecords } from '../config/leaguePlayerRecords.js';
import { leagueTeamLink } from '../client/src/utils/leagueTeamLink.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER PRIMARY KEY, ExternalLeagueId INTEGER, Status TEXT);
    CREATE TABLE SeasonGroups (GroupId INTEGER PRIMARY KEY, SeasonId INTEGER, GroupName TEXT, SortOrder INTEGER);
    CREATE TABLE SeasonTeams (TeamSubmissionId INTEGER PRIMARY KEY, SeasonId INTEGER, TeamName TEXT, ExternalTeamId INTEGER, GroupId INTEGER, UpdatedAt TEXT);
    CREATE TABLE TeamRosterPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER, Slot INTEGER);
    CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY, PlayerName TEXT);
    CREATE TABLE GroupNames (LeagueId INTEGER, GroupId INTEGER, GroupName TEXT, PRIMARY KEY (LeagueId, GroupId));
    CREATE TABLE LeagueRosterEntries (EntryId INTEGER PRIMARY KEY, LeagueId INTEGER, TeamSubmissionId INTEGER,
      TeamId INTEGER, DisplayName TEXT, GroupId INTEGER NOT NULL, SortOrder INTEGER,
      UNIQUE (LeagueId, TeamId), UNIQUE (LeagueId, GroupId, DisplayName));
    CREATE TABLE LeagueGroups (LeagueId INTEGER, TeamId INTEGER, GroupId INTEGER, PRIMARY KEY (LeagueId, TeamId));
    CREATE TABLE LeagueTeamNames (LeagueId INTEGER, TeamId INTEGER, DisplayName TEXT, PRIMARY KEY (LeagueId, TeamId));
    CREATE TABLE GroupResultOverrides (LeagueId INTEGER, GroupId INTEGER, TeamA INTEGER, TeamB INTEGER);
    CREATE TABLE TeamInfo (TeamId INTEGER PRIMARY KEY, TeamName TEXT);
    CREATE TABLE MatchLeague (MatchId INTEGER, LeagueId INTEGER);
    CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY, TeamRad INTEGER, TeamDire INTEGER, WinnerId INTEGER);
    CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);
    CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, Kills INTEGER, Deaths INTEGER, Assists INTEGER, LastHits INTEGER, GPM INTEGER, XPM INTEGER);
    INSERT INTO LeagueSeasons VALUES (1, 100, 'active'), (2, 200, 'ended'), (3, 300, 'signup_closed');
    INSERT INTO SeasonGroups VALUES (11, 1, 'A', 1), (12, 1, 'B', 2);
    INSERT INTO GroupNames VALUES (100, 1, 'A'), (100, 2, 'B'), (200, 1, 'A');
    INSERT INTO SeasonTeams VALUES (1, 1, 'Alpha', NULL, 11, 'before'), (2, 1, 'Beta', NULL, 12, 'before'),
      (3, 2, 'Previous', 30, NULL, 'before'), (4, 3, 'Not public yet', NULL, NULL, 'before');
    INSERT INTO LeagueRosterEntries VALUES (10, 100, 1, NULL, 'Alpha', 1, 1),
      (20, 100, 2, NULL, 'Beta', 2, 1), (30, 200, 3, 30, 'Previous', 1, 1);
    INSERT INTO PlayerInfo VALUES (1, 'Player One'), (2, 'Player Two'), (3, 'Player Three');
    INSERT INTO TeamRosterPlayers VALUES (1, 1, 0), (1, 2, 1), (2, 3, 0), (3, 1, 0);`);
  return db;
}

function view(db, leagueId = 100) {
  const registered = getLeagueRegisteredTeams(db, leagueId);
  const played = db.prepare(`SELECT sides.TeamId, ti.TeamName, COUNT(*) AS GamesPlayed,
      100.0 * SUM(sides.TeamId = sides.WinnerId) / COUNT(*) AS WinPercentage FROM (
        SELECT mt.TeamRad AS TeamId, mt.WinnerId FROM MatchTeam mt JOIN MatchLeague ml USING (MatchId) WHERE ml.LeagueId = ?
        UNION ALL SELECT mt.TeamDire, mt.WinnerId FROM MatchTeam mt JOIN MatchLeague ml USING (MatchId) WHERE ml.LeagueId = ?
      ) sides JOIN TeamInfo ti USING (TeamId) GROUP BY sides.TeamId`).all(leagueId, leagueId);
  const teams = includeRegisteredTeams(played, registered);
  return { teams, players: includeRegisteredPlayers(db, leagueId, getLeaguePlayerRecords(db, leagueId), teams) };
}

test('published signup teams and players appear before games with unknown stats and usable roster links', () => {
  const db = fixture();
  try {
    const { teams, players } = view(db);
    assert.deepEqual(teams.map(t => [t.TeamName, t.TeamId, t.GamesPlayed, t.WinPercentage]), [
      ['Alpha', null, 0, null], ['Beta', null, 0, null],
    ]);
    assert.deepEqual(players.map(p => [p.PlayerId, p.TeamSubmissionId, p.GamesPlayed, p.WinPercentage]), [
      [1, 1, 0, null], [3, 2, 0, null], [2, 1, 0, null],
    ]);
    assert.ok(players.every(p => p.AvgGPM === null));
    assert.equal(leagueTeamLink(teams[0]), '/team/roster/1');
    assert.equal(view(db, 300).teams.length, 0);
    assert.equal(view(db, 300).players.length, 0);
  } finally { db.close(); }
});

test('rename, regroup, and link before any game preserve signup identity and update both representations', () => {
  const db = fixture();
  try {
    const audits = [], rebuilds = [];
    const hooks = { audit: (...args) => audits.push(args), rebuild: id => rebuilds.push(id) };
    saveRegisteredLeagueTeam(db, 100, { entryId: 10, teamId: null, teamName: 'New Alpha', groupId: 2 }, hooks);
    assert.equal(view(db).teams.find(t => t.EntryId === 10).TeamName, 'New Alpha');
    assert.deepEqual(db.prepare('SELECT TeamName, ExternalTeamId, GroupId FROM SeasonTeams WHERE TeamSubmissionId = 1').get(),
      { TeamName: 'New Alpha', ExternalTeamId: null, GroupId: 12 });
    saveRegisteredLeagueTeam(db, 100, { entryId: 10, teamId: 50, teamName: 'New Alpha', groupId: 2 }, hooks);
    assert.deepEqual(db.prepare('SELECT * FROM LeagueGroups').all(), [{ LeagueId: 100, TeamId: 50, GroupId: 2 }]);
    assert.equal(db.prepare('SELECT ExternalTeamId FROM SeasonTeams WHERE TeamSubmissionId = 1').get().ExternalTeamId, 50);
    assert.equal(leagueTeamLink(view(db).teams.find(t => t.EntryId === 10)), '/team/50');
    assert.equal(view(db).players.find(p => p.PlayerId === 1).TeamSubmissionId, 1);
    assert.equal(audits.length, 2);
    assert.deepEqual(rebuilds, [100, 100]);
    // Once matches land, the existing roster rows gain their season-only statistics.
    db.exec(`INSERT INTO TeamInfo VALUES (60, 'Opposition');
      INSERT INTO MatchTeam VALUES (1, 50, 60, 50), (2, 60, 50, 60), (3, 50, 60, 50);
      INSERT INTO MatchLeague VALUES (1, 100), (2, 100), (3, 200);
      INSERT INTO MatchTeamPlayer VALUES (1, 1, 50), (2, 1, 60);
      INSERT INTO MatchPlayer VALUES (1, 1, 8, 1, 10, 100, 500, 600), (2, 1, 1, 4, 2, 50, 300, 400);`);
    const { teams, players } = view(db);
    const team = teams.find(t => t.TeamSubmissionId === 1);
    assert.equal(teams.filter(t => t.TeamId === 50).length, 1);
    assert.equal(team.GamesPlayed, 2);
    assert.equal(team.WinPercentage, 50);
    const main = players.find(p => p.PlayerId === 1 && p.TeamId === 50);
    assert.equal(main.GamesPlayed, 1);
    assert.equal(main.AvgKills, 8);
    assert.equal(main.TeamSubmissionId, 1);
    assert.equal(players.filter(p => p.PlayerId === 1).length, 2); // Stand-in row is separate.
    assert.equal(players.find(p => p.PlayerId === 2).TeamGames, 2);
    const matches = db.prepare('SELECT * FROM MatchTeam').all();
    saveRegisteredLeagueTeam(db, 100, { entryId: 10, teamId: null, teamName: 'New Alpha', groupId: 2 }, hooks);
    assert.deepEqual(db.prepare('SELECT * FROM MatchTeam').all(), matches);
    assert.equal(leagueTeamLink(view(db).teams.find(t => t.EntryId === 10)), '/team/roster/1');
  } finally { db.close(); }
});

test('cross-season edits, invalid groups and duplicate team links fail without partial writes', () => {
  const db = fixture();
  try {
    const hooks = { rebuild() {}, audit() {} };
    const save = overrides => saveRegisteredLeagueTeam(db, 100,
      { entryId: 10, teamId: 50, teamName: 'Alpha', groupId: 1, ...overrides }, hooks);
    assert.throws(() => save({ entryId: 30 }), { status: 404 });
    assert.throws(() => save({ groupId: 99 }), { status: 400 });
    assert.throws(() => save({ teamId: 0 }), { status: 400 });
    save({});
    assert.throws(() => save({ entryId: 20 }), { status: 409 });
    assert.equal(db.prepare('SELECT TeamId FROM LeagueRosterEntries WHERE EntryId = 20').get().TeamId, null);
    assert.equal(db.prepare('SELECT ExternalTeamId FROM SeasonTeams WHERE TeamSubmissionId = 2').get().ExternalTeamId, null);
    assert.equal(db.prepare('SELECT DisplayName FROM LeagueRosterEntries WHERE EntryId = 30').get().DisplayName, 'Previous');
  } finally { db.close(); }
});
