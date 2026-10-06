import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureAnalyticsSchema } from '../scripts/db/analyticsSchema.js';

function memoryDb() {
  const db = new Database(':memory:');
  ensureAnalyticsSchema(db);
  return db;
}

function seedRunAndTeam(db) {
  db.prepare(`INSERT INTO AnalyticsRuns
    (RunKey, SeasonId, CutoffAt, PublicDataCutoffAt, LeagueDataCutoffAt,
     ModelVersion, RosterFingerprint, CreatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'season:12:signup-close:v1:roster-a', 12, '2026-10-05T00:00:00.000Z',
    '2026-10-03T09:01:23.000Z', '2026-06-27', 'v1', 'roster-a',
    '2026-10-05T00:01:00.000Z');
  db.prepare(`INSERT INTO PreseasonTeamFeatures
    (RunId, TeamSubmissionId, TeamName, IsManual, RosterSize, MMRSource,
     AverageMMR, MMRStdDev, PriorLeagueGames, RecentPublicGames, StrengthScore, Confidence)
    VALUES (1, 42, 'Example Team', 0, 5, 'roster', 6500, 200, 30, 100, 0.62, 0.8)`).run();
}

test('analytics schema is idempotent and preserves rows', () => {
  const db = memoryDb();
  try {
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    seedRunAndTeam(db);
    const before = db.prepare(`SELECT type, name FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
    ensureAnalyticsSchema(db);
    assert.deepEqual(db.prepare(`SELECT type, name FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all(), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM PreseasonTeamFeatures').get().n, 1);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    db.close();
  }
});

test('legacy recommendation table is renamed without losing forecast rows', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE MarketRecommendations (
      RecommendationId INTEGER PRIMARY KEY, RunId INTEGER, MarketKey TEXT,
      OutcomeKey TEXT, TeamSubmissionId INTEGER, FairProbability REAL,
      SuggestedDecimalOdds REAL, Confidence REAL, GeneratedAt TEXT);
      INSERT INTO MarketRecommendations VALUES
        (7, 1, 'champion', 'team:42', 42, 0.25, 4, 0.6, '2026-10-05');`);
    ensureAnalyticsSchema(db);
    assert.equal(db.prepare('SELECT ForecastId FROM ModelForecasts').get().ForecastId, 7);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'MarketRecommendations'").get(), undefined);
  } finally { db.close(); }
});

test('preseason features and forecasts keep IDs, samples, and ratings private', () => {
  const db = memoryDb();
  try {
    seedRunAndTeam(db);
    db.prepare(`INSERT INTO PreseasonPlayerFeatures
      (RunId, TeamSubmissionId, PlayerId, SignupMMR, PriorLeagueGames,
       PriorLeagueWins, RecentPublicGames, RecentPublicWins, RecentPublicKills,
       RecentPublicDeaths, RecentPublicAssists, RecentPublicHeroCount, Confidence)
      VALUES (1, 42, 123, 6700, 12, 7, 40, 22, 150, 110, 300, 10, 0.75)`).run();
    db.prepare(`INSERT INTO ModelForecasts
      (RunId, MarketKey, OutcomeKey, TeamSubmissionId, FairProbability,
       SuggestedDecimalOdds, Confidence, GeneratedAt)
      VALUES (1, 'season:12:champion', 'team_submission:42', 42, 0.25,
        3.6, 0.8, '2026-10-05T00:02:00.000Z')`).run();

    assert.equal(db.prepare('SELECT SignupMMR FROM PreseasonPlayerFeatures').get().SignupMMR, 6700);
    assert.equal(db.prepare('SELECT TeamSubmissionId FROM ModelForecasts').get().TeamSubmissionId, 42);
    assert.throws(() => db.prepare(`INSERT INTO PreseasonPlayerFeatures
      (RunId, TeamSubmissionId, PlayerId, SignupMMR, Confidence)
      VALUES (1, 999, 124, 6000, 0.5)`).run(), /FOREIGN KEY constraint failed/);
    assert.throws(() => db.prepare(`INSERT INTO ModelForecasts
      (RunId, MarketKey, OutcomeKey, TeamSubmissionId, FairProbability,
       SuggestedDecimalOdds, Confidence, GeneratedAt)
      VALUES (1, 'season:12:champion', 'bad', 42, 1.1, 1.1, 0.5, 'now')`).run(),
    /CHECK constraint failed/);

    for (const table of ['CompletedMatchFacts', 'HomeFeedItems']) {
      const columns = db.pragma(`table_info(${table})`).map(row => row.name);
      assert.equal(columns.some(column => /mmr|fingerprint|screenshot/i.test(column)), false);
    }
  } finally {
    db.close();
  }
});

test('run metadata stays fixed and a completed run cannot be edited or deleted', () => {
  const db = memoryDb();
  try {
    seedRunAndTeam(db);
    db.prepare(`INSERT INTO PreseasonPlayerFeatures
      (RunId, TeamSubmissionId, PlayerId, SignupMMR, Confidence)
      VALUES (1, 42, 123, 6700, 0.75)`).run();
    db.prepare(`INSERT INTO ModelForecasts
      (RunId, MarketKey, OutcomeKey, TeamSubmissionId, FairProbability,
       SuggestedDecimalOdds, Confidence, GeneratedAt)
      VALUES (1, 'season:12:champion', 'team_submission:42', 42, 0.25,
        3.6, 0.8, '2026-10-05T00:02:00.000Z')`).run();
    assert.throws(() => db.prepare('UPDATE AnalyticsRuns SET ModelVersion = ? WHERE RunId = 1')
      .run('v2'), /analytics run metadata is immutable/);
    db.prepare(`UPDATE AnalyticsRuns SET Status = 'complete', CompletedAt = ? WHERE RunId = 1`)
      .run('2026-10-05T00:03:00.000Z');
    assert.throws(() => db.prepare(`UPDATE AnalyticsRuns SET Status = 'failed' WHERE RunId = 1`)
      .run(), /completed analytics runs are immutable/);
    assert.throws(() => db.prepare('DELETE FROM AnalyticsRuns WHERE RunId = 1').run(),
      /completed analytics runs cannot be deleted/);
    assert.throws(() => db.prepare(`UPDATE PreseasonTeamFeatures
      SET AverageMMR = 7000 WHERE RunId = 1 AND TeamSubmissionId = 42`).run(),
    /completed analytics run data is immutable/);
    assert.throws(() => db.prepare(`DELETE FROM PreseasonPlayerFeatures
      WHERE RunId = 1 AND TeamSubmissionId = 42 AND PlayerId = 123`).run(),
    /completed analytics run data is immutable/);
    assert.throws(() => db.prepare(`UPDATE ModelForecasts
      SET SuggestedDecimalOdds = 4 WHERE RunId = 1`).run(),
    /completed analytics run data is immutable/);
    assert.throws(() => db.prepare(`INSERT INTO ModelForecasts
      (RunId, MarketKey, OutcomeKey, TeamSubmissionId, FairProbability,
       SuggestedDecimalOdds, Confidence, GeneratedAt)
      VALUES (1, 'season:12:champion', 'other', 42, 0.1, 8, 0.8, 'now')`).run(),
    /completed analytics run data is immutable/);
  } finally {
    db.close();
  }
});

test('completed matches and homepage items store only publishable facts', () => {
  const db = memoryDb();
  try {
    db.prepare(`INSERT INTO CompletedMatchFacts
      (MatchId, LeagueId, PlayedDate, RadiantTeamId, DireTeamId,
       WinnerTeamId, Stage, PreMatchRadiantWinProbability, RefreshedAt)
      VALUES (101, 10, '2026-10-04', 20, 21, 21, 'group', 0.7,
        '2026-10-05T05:00:00.000Z')`).run();
    db.prepare(`INSERT INTO HomeFeedItems
      (ItemKey, LeagueId, FeedType, EventDate, Headline, MatchId,
       TeamId, RankScore, PublishedAt, ExpiresAt)
      VALUES ('match:101:upset', 10, 'upset', '2026-10-04', 'An upset win',
        101, 21, 0.5, '2026-10-05T05:10:00.000Z', '2026-10-12T05:10:00.000Z')`).run();
    assert.equal(db.prepare('SELECT MatchId FROM HomeFeedItems').get().MatchId, 101);
    assert.throws(() => db.prepare(`INSERT INTO CompletedMatchFacts
      (MatchId, LeagueId, PlayedDate, RadiantTeamId, DireTeamId,
       WinnerTeamId, RefreshedAt)
      VALUES (102, 10, '2026-10-04', 20, 21, 22, 'now')`).run(),
    /CHECK constraint failed/);
    assert.throws(() => db.prepare(`INSERT INTO HomeFeedItems
      (ItemKey, LeagueId, FeedType, EventDate, Headline, MatchId, PublishedAt)
      VALUES ('missing-match', 10, 'upset', '2026-10-04', 'Missing match', 999, 'now')`).run(),
    /FOREIGN KEY constraint failed/);
  } finally {
    db.close();
  }
});
