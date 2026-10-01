import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import AdjustedPlayersStore from '../config/adjustedPlayersStore.js';
import SeasonStore from '../config/seasonStore.js';

const screenshot = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY, PlayerName TEXT NOT NULL);
    CREATE TABLE LeagueInfo (LeagueId INTEGER PRIMARY KEY, LeagueName TEXT NOT NULL, Active INTEGER NOT NULL);
    CREATE TABLE GroupNames (LeagueId INTEGER, GroupId INTEGER, GroupName TEXT, UNIQUE(LeagueId, GroupId));
    CREATE TABLE LeagueRules (LeagueId INTEGER PRIMARY KEY, UpperBracketTeams INTEGER, LowerBracketTeams INTEGER,
      EliminatedTeams INTEGER, HasTiebreaker INTEGER, TiebreakerPosition INTEGER);
    CREATE TABLE LeagueRosterEntries (EntryId INTEGER PRIMARY KEY AUTOINCREMENT, LeagueId INTEGER,
      GroupId INTEGER, DisplayName TEXT, SortOrder INTEGER, TeamId INTEGER, TeamSubmissionId INTEGER);
    CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY, TeamRad INTEGER, TeamDire INTEGER, WinnerId INTEGER);
    CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY, LeagueId INTEGER, DatePlayed TEXT);
    CREATE TABLE TeamInfo (TeamId INTEGER PRIMARY KEY, TeamName TEXT);
    CREATE TABLE HeroInfo (HeroId INTEGER PRIMARY KEY, HeroName TEXT);
    CREATE TABLE LeagueTeamNames (LeagueId INTEGER, TeamId INTEGER, DisplayName TEXT);
    CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER PRIMARY KEY, GroupEndMatchId INTEGER, TieBreakerEndMatchId INTEGER);
    CREATE TABLE SeriesInfo (SeriesId INTEGER PRIMARY KEY, Team1 INTEGER, Team2 INTEGER);
    CREATE TABLE SeriesMatch (SeriesId INTEGER, MatchId INTEGER);
    CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, HeroId INTEGER,
      Kills INTEGER, Deaths INTEGER, Assists INTEGER, Healing INTEGER, TowerDamage INTEGER,
      GPM INTEGER, Lasthits INTEGER, HeroDamage INTEGER);
    CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);`);
  new AdjustedPlayersStore(db);
  return db;
}

test('season signup, group assignment, MMR snapshot, and champion follow the lifecycle', () => {
  const db = database();
  try {
    const audit = [];
    const store = new SeasonStore(db, (type, message) => audit.push([type, message]));
    const season = store.create('Lads Season');
    assert.throws(() => store.create('Second league'), { status: 409 });
    store.saveSignup(season.SeasonId, 'Season signup', 'Bring your team');
    store.setSignupStatus(season.SeasonId, true);
    db.prepare('INSERT INTO PlayerInfo (PlayerId, PlayerName) VALUES (?, ?)').run(1, 'Captain');
    db.prepare(`INSERT INTO AdjustedPlayers (PlayerId, AdjustedMMR, CreatedAt, UpdatedAt)
      VALUES (1, 7000, 'now', 'now')`).run();
    const players = Array.from({ length: 5 }, (_, index) => ({
      playerId: index + 1, playerName: index ? `Player ${index + 1}` : 'Captain',
      mmr: 6000, dotaProfileUrl: 'https://www.dotabuff.com/players/1', screenshot,
    }));
    const team = store.saveTeam(season.SeasonId, 1, { teamName: 'The Lads', players });
    assert.equal(store.teams(season.SeasonId, true)[0].CaptainName, 'Captain');
    assert.equal(team.players[0].MMR, 7000);
    assert.equal('ScreenshotData' in team.players[0], false);
    assert.equal(store.screenshot(team.TeamSubmissionId, 1).ScreenshotMime, 'image/png');
    assert.throws(() => store.saveTeam(season.SeasonId, 99, { teamName: 'Other', players }),
      { status: 400 });
    store.setSignupStatus(season.SeasonId, false);
    db.prepare('UPDATE AdjustedPlayers SET AdjustedMMR = 8000 WHERE PlayerId = 1').run();
    assert.equal(store.getTeam(team.TeamSubmissionId).players[0].MMR, 7000);
    const manual = store.addManualTeam(season.SeasonId, 'Manual', 6200);
    store.addGroup(season.SeasonId, 'A');
    store.addGroup(season.SeasonId, 'B');
    store.saveRules(season.SeasonId, { UpperBracketTeams: 1, LowerBracketTeams: 1,
      EliminatedTeams: 0, HasTiebreaker: false });
    const result = store.randomize(season.SeasonId);
    assert.deepEqual(result.groups.map(group => group.teams.length), [1, 1]);
    const boardTeams = store.teams(season.SeasonId);
    assert.deepEqual(store.groupSummary(season.SeasonId, boardTeams), store.groupSummary(season.SeasonId));
    const started = store.start(season.SeasonId, 12345);
    assert.equal(started.Status, 'active');
    assert.equal(store.teams(season.SeasonId, true).length, 2);
    assert.throws(() => store.saveTeam(season.SeasonId, null, { teamName: 'Changed', players }, true,
      team.TeamSubmissionId), { status: 409 });
    assert.equal(db.prepare('SELECT COUNT(*) AS Count FROM SignupMMRs').get().Count, 5);
    assert.equal(db.prepare('SELECT SignupMMR FROM SignupMMRs WHERE PlayerId = 1').get().SignupMMR, 7000);
    assert.equal(db.prepare('SELECT COUNT(*) AS Count FROM LeagueRosterEntries').get().Count, 2);
    assert.equal(db.prepare('SELECT UpperBracketTeams FROM LeagueRules WHERE LeagueId = 12345').get().UpperBracketTeams, 1);
    assert.throws(() => store.create('Another'), { status: 409 });
    db.exec(`INSERT INTO TeamInfo VALUES (111, 'The Lads'), (222, 'Manual');
      INSERT INTO MatchTeam VALUES (1, 111, 222, 111);
      INSERT INTO MatchTeam VALUES (2, 111, 222, 111);
      INSERT INTO MatchTeam VALUES (3, 222, 111, 111);
      INSERT INTO MatchLeague (MatchId, LeagueId) VALUES (1, 12345), (2, 12345), (3, 12345);
      INSERT INTO LeagueStageBoundaries VALUES (12345, 1, 1);
      INSERT INTO SeriesInfo VALUES (1, 111, 222);
      INSERT INTO SeriesMatch VALUES (1, 2), (1, 3);
      INSERT INTO HeroInfo VALUES (1, 'Axe'), (2, 'Crystal Maiden');
      INSERT INTO MatchPlayer (MatchId, PlayerId, HeroId, Kills, Deaths, Assists)
        VALUES (1, 1, 1, 4, 2, 8), (2, 1, 2, 6, 1, 11),
        (3, 1, 2, 3, 0, 9), (2, 2, 1, 2, 3, 12),
        (1, 3, 1, 1, 1, 14), (3, 3, 2, 2, 2, 10);
      UPDATE MatchPlayer SET Healing = 1200, GPM = 450 WHERE MatchId = 2 AND PlayerId = 1;
      UPDATE MatchPlayer SET TowerDamage = 2800, GPM = 500 WHERE MatchId = 3 AND PlayerId = 3;
      INSERT INTO MatchTeamPlayer VALUES (1, 1, 111), (2, 1, 111), (3, 1, 111),
        (2, 2, 111), (1, 3, 111), (3, 3, 111);`);
    const ended = store.end(season.SeasonId, 111);
    assert.equal(ended.Status, 'ended');
    assert.equal(store.publicHome().champion.teamName, 'The Lads');
    assert.deepEqual(store.publicHome().champion.groupGames, { wins: 1, losses: 0 });
    assert.deepEqual(store.publicHome().champion.playoffGames, { wins: 2, losses: 0 });
    assert.deepEqual(store.publicHome().champion.playoffSeries, { wins: 1, losses: 0 });
    assert.deepEqual(store.publicHome().champion.players.map(player => player.playerId), [1, 3]);
    assert.deepEqual(store.publicHome().champion.players[0], {
      playerId: 1, playerName: 'Captain', games: 3, wins: 3, playoffWins: 2,
      signatureHero: { heroId: 2, heroName: 'Crystal Maiden', games: 2, wins: 2 },
      spotlight: { label: 'Keeping the team alive', value: 1200, unit: 'healing in one match',
        matchId: 2, stage: 'Playoffs', opponentName: 'Manual' },
    });
    assert.deepEqual(store.publicHome().champion.players[1].spotlight,
      { label: 'Siege work', value: 2800, unit: 'tower damage in one match',
        matchId: 3, stage: 'Playoffs', opponentName: 'Manual' });
    db.prepare('UPDATE LeagueStageBoundaries SET TieBreakerEndMatchId = NULL WHERE LeagueId = 12345').run();
    assert.equal(store.publicHome().champion.players[0].spotlight.stage, 'Playoffs');
    assert.ok(audit.some(([type]) => type === 'League Ended'));
    assert.equal(store.create('Next Season').Status, 'draft');
    assert.equal(manual.IsManual, 1);
  } finally { db.close(); }
});

test('an existing active league is adopted without creating a second current season', () => {
  const db = database();
  try {
    db.prepare("INSERT INTO LeagueInfo VALUES (999, 'Legacy league', 1)").run();
    const store = new SeasonStore(db);
    assert.equal(store.current().ExternalLeagueId, 999);
    assert.equal(store.current().Status, 'active');
    assert.equal(new SeasonStore(db).current().SeasonId, store.current().SeasonId);
    assert.throws(() => store.create('New season'), { status: 409 });
  } finally { db.close(); }
});

test('an optional League ID can be saved with the draft and used when starting', () => {
  const db = database();
  try {
    db.prepare("INSERT INTO LeagueInfo VALUES (77, 'Previous league', 0)").run();
    const store = new SeasonStore(db);
    assert.throws(() => store.create('New season', 77), { status: 409 });
    assert.throws(() => store.create('New season', 0), { status: 400 });
    const draft = store.create('New season', 12345);
    assert.equal(draft.ExternalLeagueId, 12345);
    store.saveSignup(draft.SeasonId, 'Join us', 'Five players per team');
    store.setSignupStatus(draft.SeasonId, true);
    store.setSignupStatus(draft.SeasonId, false);
    const team = store.addManualTeam(draft.SeasonId, 'Team One', 6000);
    const group = store.addGroup(draft.SeasonId, 'Group A');
    store.assignTeam(draft.SeasonId, team.TeamSubmissionId, group.GroupId);
    assert.equal(store.start(draft.SeasonId).ExternalLeagueId, 12345);
    assert.equal(db.prepare('SELECT Active FROM LeagueInfo WHERE LeagueId = 12345').get().Active, 1);
  } finally { db.close(); }
});

test('the latest completed legacy league can have its champion confirmed', () => {
  const db = database();
  try {
    db.exec(`INSERT INTO LeagueInfo VALUES (77, 'Old league', 0);
      INSERT INTO TeamInfo VALUES (1, 'Winners'), (2, 'Others');
      INSERT INTO MatchTeam VALUES (4, 1, 2, 1);
      INSERT INTO MatchLeague (MatchId, LeagueId) VALUES (4, 77);`);
    const store = new SeasonStore(db);
    const completed = store.lastEnded();
    assert.equal(completed.ExternalLeagueId, 77);
    assert.equal(store.publicHome().champion, null);
    store.correctChampion(completed.SeasonId, 1);
    assert.equal(store.publicHome().champion.teamName, 'Winners');
    assert.equal(new SeasonStore(db).lastEnded().SeasonId, completed.SeasonId);
  } finally { db.close(); }
});
