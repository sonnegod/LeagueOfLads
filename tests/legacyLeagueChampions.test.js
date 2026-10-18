import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { backfillLegacyChampions, legacyChampionCandidates } from '../config/legacyLeagueChampions.js';
import PlayerAwardsStore from '../config/playerAwards.js';
import { ensureChampionshipRosterSchema } from '../config/championshipRoster.js';

test('legacy winners are persisted once without changing saved champions, current seasons, or latest completed season', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE LeagueInfo (LeagueId INTEGER PRIMARY KEY, LeagueName TEXT, Active INTEGER);
      CREATE TABLE LeagueSeasons (SeasonId INTEGER PRIMARY KEY AUTOINCREMENT, LeagueName TEXT, Status TEXT,
        ExternalLeagueId INTEGER UNIQUE, ChampionTeamId INTEGER, CreatedAt TEXT, UpdatedAt TEXT, EndedAt TEXT);
      CREATE UNIQUE INDEX current_season ON LeagueSeasons ((1)) WHERE Status <> 'ended';
      CREATE TABLE SeasonTeams (TeamSubmissionId INTEGER, SeasonId INTEGER, ExternalTeamId INTEGER);
      CREATE TABLE TeamInfo (TeamId INTEGER PRIMARY KEY, TeamName TEXT);
      CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY, LeagueId INTEGER, DatePlayed TEXT);
      CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY, TeamRad INTEGER, TeamDire INTEGER, WinnerId INTEGER);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, HeroId INTEGER);
      CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);
      CREATE TABLE TeamRosterPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER);
      CREATE TABLE LeagueTeamNames (LeagueId INTEGER, TeamId INTEGER, DisplayName TEXT);
      CREATE TABLE HeroInfo (HeroId INTEGER PRIMARY KEY, HeroName TEXT);
      INSERT INTO LeagueInfo VALUES (18, 'Season 18', 0), (19, 'Season 19', 0), (20, 'Season 20', 0),
        (21, 'Season 21', 1), (15, 'Unfinished result', 0), (16, 'Invalid winner', 0),
        (17, 'Old bootstrap', 0), (14, 'Unconfirmed signup season', 0);
      INSERT INTO TeamInfo VALUES (100, 'Historical winners'), (200, 'Other team');
      INSERT INTO LeagueSeasons VALUES
        (1, 'Season 20', 'ended', 20, 200, 'created', 'unchanged', '2026-08-01T00:00:00.000Z'),
        (2, 'Season 21', 'active', 21, NULL, 'created', 'unchanged', NULL),
        (3, 'Old bootstrap', 'ended', 17, NULL, 'created', 'before', NULL),
        (4, 'Unconfirmed signup season', 'ended', 14, NULL, 'created', 'unchanged', NULL);
      INSERT INTO SeasonTeams VALUES (1, 4, 100);
      INSERT INTO MatchLeague VALUES (1, 18, NULL), (2, 18, NULL),
        (3, 19, '2026-01-25'), (4, 20, '2026-08-01'), (5, 21, '2026-10-01'),
        (6, 15, '2025-01-01'), (7, 16, '2025-01-01'), (8, 17, '2025-01-01'), (9, 14, '2025-01-01');
      INSERT INTO MatchTeam VALUES (1, 100, 200, 200), (2, 100, 200, 100),
        (3, 100, 200, 100), (4, 100, 200, 100), (5, 100, 200, 100),
        (6, 100, 200, NULL), (7, 100, 200, 999), (8, 100, 200, 100), (9, 100, 200, 100);
      INSERT INTO MatchPlayer VALUES (1, 1, 1), (2, 1, 1), (3, 1, 1);
      INSERT INTO MatchTeamPlayer VALUES (1, 1, 100), (2, 1, 100), (3, 1, 100);`);
    ensureChampionshipRosterSchema(db);
    const original = db.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId IN (1, 2, 4)').all();
    assert.deepEqual(legacyChampionCandidates(db).map(row => row.LeagueId), [17, 18, 19]);
    const store = new PlayerAwardsStore(db);
    assert.equal(store.forPlayer(1).awards.filter(award => award.type === 'champion').length, 0);
    assert.deepEqual(backfillLegacyChampions(db, '2026-10-16T12:00:00.000Z'), { inserted: 2, updated: 1 });
    assert.deepEqual(backfillLegacyChampions(db), { inserted: 0, updated: 0 });
    assert.deepEqual(db.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId IN (1, 2, 4)').all(), original);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM LeagueSeasons WHERE Status <> ?').get('ended').n, 1);
    assert.equal(db.prepare('SELECT ChampionTeamId FROM LeagueSeasons WHERE ExternalLeagueId = 18').get().ChampionTeamId, 100);
    assert.equal(db.prepare('SELECT EndedAt FROM LeagueSeasons WHERE ExternalLeagueId = 18').get().EndedAt, null);
    assert.equal(db.prepare('SELECT EndedAt FROM LeagueSeasons WHERE ExternalLeagueId = 19').get().EndedAt, '2026-01-25T00:00:00.000Z');
    assert.equal(db.prepare(`SELECT ExternalLeagueId FROM LeagueSeasons WHERE Status = 'ended'
      ORDER BY EndedAt DESC, SeasonId DESC LIMIT 1`).get().ExternalLeagueId, 20);
    assert.deepEqual(store.forPlayer(1).awards.filter(award => award.type === 'champion')
      .map(award => award.leagueId), [19, 18]);
    assert.equal(store.withChampionships([{ PlayerId: 1 }])[0].championships.length, 2);
    assert.deepEqual(legacyChampionCandidates(db), []);
  } finally { db.close(); }
});
