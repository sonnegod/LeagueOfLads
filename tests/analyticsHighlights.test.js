import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { migrateAnalytics } from '../analytics/store.js';
import { localDay, localWeek, publishLeagueHighlights, moderateHighlight } from '../analytics/highlights.js';
import { readHighlightFeed, highlightDTO } from '../analytics/highlightFeed.js';
import { createAnalyticsRoutes } from '../routes/analyticsRoutes.js';
import { runWithAuditActor } from '../config/adminAuditContext.js';
import { readLeagueDashboard } from '../analytics/leagueDashboard.js';
import { bracketSeriesFormats, verifiedSeriesOutcome } from '../analytics/seriesStories.js';
import { seasonWatch } from '../analytics/stageStories.js';

const now = new Date('2026-10-13T12:00:00.000Z');
const factTables = ['SeasonFacts', 'TeamFacts', 'PlayerFacts', 'HeroFacts', 'MatchFacts', 'TeamGameFacts', 'PlayerGameFacts', 'GroupFacts', 'SeriesFacts'];
function fixture(path = ':memory:') {
  const db = new Database(path); db.pragma('foreign_keys = ON'); migrateAnalytics(db);
  db.exec(`INSERT INTO AnalyticsRuns (RunId, StartedAtUtc, AsOfUtc, Version, Status) VALUES (1, '2026-10-13T12:00:00.000Z', '2026-10-13T12:00:00.000Z', 4, 'running');
    INSERT INTO SeasonFacts VALUES (1, 3, 100, 'Example season', 'active', NULL, 112, 112);
    INSERT INTO TeamFacts VALUES (1, 11, 3, 21, 'Team A', 1, 0), (1, 12, 3, 22, 'Team B', 1, 0);`);
  for (let id = 1; id <= 10; id++) db.prepare('INSERT INTO PlayerFacts VALUES (1, ?, ?)').run(id, `Player ${id}`);
  for (let id = 1; id <= 6; id++) db.prepare('INSERT INTO HeroFacts VALUES (1, ?, ?)').run(id, `Hero ${id}`);
  for (let game = 1; game <= 12; game++) {
    const match = 100 + game;
    const time = game <= 5 ? `2026-10-11T${String(16 + game).padStart(2, '0')}:00:00.000Z`
      : game === 12 ? '2026-10-13T03:30:00.000Z' : `2026-10-12T${String(10 + game).padStart(2, '0')}:00:00.000Z`;
    const winner = game === 11 ? 22 : 21;
    db.prepare('INSERT INTO MatchFacts VALUES (1, ?, 3, 100, NULL, ?, ?, ?, ?, 2400, ?, ?)')
      .run(match, 'regular', time, time, 'api', winner, '2026-10-13T10:00:00.000Z');
    db.prepare('INSERT INTO TeamGameFacts VALUES (1, ?, 11, 12, 21, ?, ?)').run(match, Number(winner === 21), 'radiant');
    db.prepare('INSERT INTO TeamGameFacts VALUES (1, ?, 12, 11, 22, ?, ?)').run(match, Number(winner === 22), 'dire');
    for (let player = 1; player <= 10; player++) {
      db.prepare(`INSERT INTO PlayerGameFacts VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 250, ?, ?, 20000, ?, ?, ?)`)
        .run(match, player, player <= 5 ? 11 : 12, (game + player) % 6 + 1,
          Number(winner === (player <= 5 ? 21 : 22)), player === 1 ? 'stand_in' : 'rostered',
          player === 1 ? 20 + game : 3 + game, player === 4 ? 0 : 5, player === 5 ? 30 + game : 10,
          500 + game * 10 + player * 3, 600 + game * 10 + player * 3,
          player === 2 ? 100000 + game * 1000 : 10000, player === 3 ? 10000 + game * 100 : 0,
          player === 6 ? 15000 + game * 100 : 0);
    }
  }
  db.exec(`INSERT INTO PrivatePlayerFeatures VALUES (1, 1, '2026-07-01', '2026-10-13', 100, 50, 987654321, 2, 3, 1, 'ready');
    INSERT INTO PrivateRosterInputs VALUES (1, 11, 1, 987654321, 'secret');`);
  return db;
}
function publish(db, runId = 1, at = now) {
  db.transaction(() => {
    publishLeagueHighlights(db, runId, at);
    db.prepare("UPDATE AnalyticsRuns SET Status = 'complete' WHERE RunId = ?").run(runId);
    db.prepare('UPDATE AnalyticsState SET PublishedRunId = ? WHERE Id = 1').run(runId);
  })();
}
function copyRun(db, id, from = id - 1) {
  db.prepare(`INSERT INTO AnalyticsRuns (RunId, StartedAtUtc, AsOfUtc, Version, Status, Scope, SelectedSeasonId)
    SELECT ?, StartedAtUtc, AsOfUtc, Version, 'running', Scope, SelectedSeasonId FROM AnalyticsRuns WHERE RunId = ?`).run(id, from);
  for (const table of factTables) {
    const columns = db.pragma(`table_info(${table})`).map(c => c.name).filter(c => c !== 'RunId').join(', ');
    db.prepare(`INSERT INTO ${table} SELECT ?, ${columns} FROM ${table} WHERE RunId = ?`).run(id, from);
  }
}

test('daily/weekly recaps use completed New York periods, not ingestion time, and retain sample counts', () => {
  const db = fixture();
  try {
    publish(db);
    const day = db.prepare("SELECT * FROM HighlightEvents WHERE Fingerprint = 'daily:3:2026-10-12'").get();
    assert.equal(day.Status, 'published');
    const evidence = JSON.parse(day.EvidenceJson);
    assert.equal(evidence.games, 7); // 03:30 UTC October 13 belongs to October 12 locally.
    assert.ok(evidence.matchIds.includes(112));
    assert.equal(evidence.standInAppearances, 7);
    assert.equal(evidence.topGpm.samples, 7);
    const weekly = db.prepare("SELECT * FROM HighlightEvents WHERE Fingerprint = 'weekly:3:2026-10-05'").get();
    assert.equal(weekly.Status, 'published');
    assert.equal(JSON.parse(weekly.EvidenceJson).games, 5);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE FirstPublishedAtUtc IS NOT NULL AND Period = 'daily'").get().n, 5);
    assert.equal(localDay('2026-11-01T03:30:00Z'), '2026-10-31');
    assert.equal(localDay('2026-11-01T06:30:00Z'), '2026-11-01');
    assert.equal(localWeek('2026-11-02T04:30:00Z'), '2026-10-26');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Fingerprint = 'daily:3:2026-10-13'").get().n, 0);
  } finally { db.close(); }
});

test('identical reruns preserve publication/revision history and the daily quota across all refreshes', () => {
  const db = fixture();
  try {
    publish(db);
    const initial = db.prepare('SELECT COUNT(*) AS n FROM HighlightEvents').get().n;
    const revisions = db.prepare('SELECT COUNT(*) AS n FROM HighlightRevisions').get().n;
    copyRun(db, 2); publish(db, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM HighlightEvents').get().n, initial);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM HighlightRevisions').get().n, revisions);
    db.prepare('UPDATE PlayerGameFacts SET HeroDamage = 999999 WHERE RunId = 2 AND MatchId = 112 AND PlayerId = 10').run();
    publish(db, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE FirstPublishedAtUtc IS NOT NULL AND Period = 'daily'").get().n, 5);
    const published = db.prepare("SELECT PlayerId FROM HighlightEvents WHERE Status = 'published' AND Period = 'daily' AND PlayerId IS NOT NULL").all();
    assert.equal(new Set(published.map(r => r.PlayerId)).size, published.length);
    db.prepare('DELETE FROM MatchFacts WHERE RunId = 1').run(); // Content history is independent of fact retention.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Status = 'published'").get().n, 6);
  } finally { db.close(); }
});

test('source corrections revise stories, preserve moderation, and withdraw invalid supporting games', () => {
  const db = fixture();
  try {
    publish(db);
    const story = db.prepare("SELECT * FROM HighlightEvents WHERE Status = 'published' AND Category = 'damage'").get();
    assert.ok(story);
    const match = JSON.parse(story.EvidenceJson).matchIds[0];
    moderateHighlight(db, story.HighlightId, { hidden: true, body: 'Admin wording' }, '123');
    copyRun(db, 2);
    db.prepare('UPDATE PlayerGameFacts SET HeroDamage = HeroDamage + 1000 WHERE RunId = 2 AND MatchId = ? AND PlayerId = ?')
      .run(match, story.PlayerId);
    publish(db, 2);
    const revised = db.prepare('SELECT * FROM HighlightEvents WHERE HighlightId = ?').get(story.HighlightId);
    assert.equal(revised.Hidden, 1);
    assert.equal(revised.BodyOverride, 'Admin wording');
    assert.equal(revised.OverrideNeedsReview, 1);
    assert.ok(revised.Revision > story.Revision);
    assert.notEqual(revised.SourceHash, story.SourceHash);
    moderateHighlight(db, story.HighlightId, { title: null, body: null, hidden: false }, '123');
    assert.equal(db.prepare('SELECT OverrideNeedsReview FROM HighlightEvents WHERE HighlightId = ?').get(story.HighlightId).OverrideNeedsReview, 0);
    copyRun(db, 3);
    db.prepare('DELETE FROM MatchFacts WHERE RunId = 3 AND MatchId = ?').run(match);
    publish(db, 3);
    assert.equal(db.prepare('SELECT Status FROM HighlightEvents WHERE HighlightId = ?').get(story.HighlightId).Status, 'withdrawn');
    assert.ok(db.prepare('SELECT ActorId FROM HighlightRevisions WHERE HighlightId = ? AND ActorId = ?').get(story.HighlightId, '123'));
  } finally { db.close(); }
});

test('publication pause blocks new stories while corrections and withdrawals continue', () => {
  const db = fixture();
  try {
    db.exec('UPDATE HighlightSettings SET Paused = 1'); publish(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Status = 'published'").get().n, 0);
    db.exec('UPDATE HighlightSettings SET Paused = 0'); publish(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Status = 'published'").get().n, 6);
    const story = db.prepare("SELECT * FROM HighlightEvents WHERE Status = 'published' AND Category = 'damage'").get();
    db.exec('UPDATE HighlightSettings SET Paused = 1');
    copyRun(db, 2);
    db.prepare('DELETE FROM MatchFacts WHERE RunId = 2 AND MatchId = ?').run(JSON.parse(story.EvidenceJson).matchIds[0]);
    publish(db, 2);
    assert.equal(db.prepare('SELECT Status FROM HighlightEvents WHERE HighlightId = ?').get(story.HighlightId).Status, 'withdrawn');
  } finally { db.close(); }
});

test('undated historical games never produce recaps; unknown rosters and stand-ins are explicit', () => {
  const db = fixture();
  try {
    db.exec("UPDATE MatchFacts SET StartedAtUtc = NULL, TimeSource = 'unknown'; UPDATE PlayerGameFacts SET Membership = 'unknown'");
    publish(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Category = 'recap'").get().n, 0);
    const performance = db.prepare("SELECT * FROM HighlightEvents WHERE Category = 'kills' LIMIT 1").get();
    assert.match(performance.Body, /Roster status unavailable/);
    assert.match(performance.Body, /date is unverified/);
    const payload = JSON.stringify(highlightDTO(performance));
    assert.equal(payload.includes('987654321'), false);
    assert.equal(payload.includes('Private'), false);
    assert.equal(payload.includes('SignupMMR'), false);
    // The DTO also rejects arbitrary private properties injected into evidence JSON.
    assert.equal(JSON.stringify(highlightDTO({ ...performance, EvidenceJson: JSON.stringify({ matchIds: [], SignupMMR: 987654321 }) })).includes('987654321'), false);
  } finally { db.close(); }
  const standIns = fixture();
  try {
    publish(standIns);
    assert.match(standIns.prepare("SELECT Body FROM HighlightEvents WHERE Category = 'kills' LIMIT 1").get().Body, /Stand-in appearance/);
  } finally { standIns.close(); }
});

test('incomplete metrics suppress leader claims; averages require five valid samples', () => {
  const db = fixture();
  try {
    db.exec('UPDATE PlayerGameFacts SET GPM = NULL WHERE PlayerId = 1');
    publish(db);
    assert.equal(JSON.parse(db.prepare("SELECT EvidenceJson FROM HighlightEvents WHERE Fingerprint = 'daily:3:2026-10-12'").get().EvidenceJson).topGpm, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Title LIKE '%new recorded%farming%'").get().n, 0);
    copyRun(db, 2);
    db.exec('DELETE FROM MatchFacts WHERE RunId = 2 AND MatchId > 109'); publish(db, 2);
    const smallDay = JSON.parse(db.prepare("SELECT EvidenceJson FROM HighlightEvents WHERE Fingerprint = 'daily:3:2026-10-12'").get().EvidenceJson);
    assert.equal(smallDay.games, 4); assert.equal(smallDay.topXpm, null);
  } finally { db.close(); }
});

test('streaks and records stay within their stage, and official champions retain separate stage records', () => {
  const db = fixture();
  try {
    db.exec(`UPDATE MatchFacts SET Stage = 'playoff' WHERE MatchId > 106;
      INSERT INTO ChampionFacts VALUES (1, 3, 11);
      INSERT INTO TeamSeasonStats VALUES (1, 3, 11, 'regular', 6, 6, 0), (1, 3, 11, 'playoff', 6, 5, 1);`);
    publish(db);
    const champion = db.prepare("SELECT * FROM HighlightEvents WHERE Category = 'champion'").get();
    assert.equal(champion.Status, 'published');
    assert.match(champion.Body, /regular season: 6 wins, 0 losses/);
    assert.match(champion.Body, /playoffs: 5 wins, 1 losses/);
    const streak = db.prepare("SELECT EvidenceJson FROM HighlightEvents WHERE Fingerprint = 'streak:3:playoff:11:109'").get();
    assert.deepEqual(JSON.parse(streak.EvidenceJson).matchIds, [107, 108, 109]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Fingerprint = 'streak:3:playoff:11:107'").get().n, 0);
    const high = db.prepare("SELECT EvidenceJson FROM HighlightEvents WHERE Category = 'damage' AND Stage = 'playoff' AND Title LIKE '%new recorded%' LIMIT 1").get();
    assert.ok(JSON.parse(high.EvidenceJson).comparisonMatchIds.every(id => id > 106));
  } finally { db.close(); }
});

test('failed publication rolls back stories and leaves the previous feed generation intact', () => {
  const db = fixture();
  try {
    publish(db);
    const original = db.prepare('SELECT * FROM HighlightEvents').all();
    copyRun(db, 2); db.exec('UPDATE PlayerGameFacts SET HeroDamage = 1000000 WHERE RunId = 2');
    assert.throws(() => db.transaction(() => { publishLeagueHighlights(db, 2, now); throw new Error('fail'); })(), /fail/);
    assert.deepEqual(db.prepare('SELECT * FROM HighlightEvents').all(), original);
    assert.equal(db.prepare('SELECT PublishedRunId FROM AnalyticsState').get().PublishedRunId, 1);
  } finally { db.close(); }
});

test('filtered seasons do not withdraw unrelated seasons and historical previews cannot reach the public feed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lads-highlights-'));
  const path = join(directory, 'Analytics.db'); const db = fixture(path);
  try {
    publish(db);
    copyRun(db, 2);
    db.exec("UPDATE AnalyticsRuns SET Scope = 'season', SelectedSeasonId = 4 WHERE RunId = 2");
    db.exec(`DELETE FROM MatchFacts WHERE RunId = 2; DELETE FROM SeasonFacts WHERE RunId = 2;
      INSERT INTO SeasonFacts VALUES (2, 4, 101, 'Other season', 'active', NULL, NULL, NULL)`);
    publish(db, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Status = 'published'").get().n, 6);
    db.exec("UPDATE AnalyticsRuns SET Scope = 'legacy_preview' WHERE RunId = 2");
    assert.equal(readHighlightFeed(path).highlights.length, 0);
    assert.ok(readHighlightFeed(path, { admin: true }).highlights.length > 0);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('dashboard windows emphasize completed results, paginate without duplication, and omit unverified dates from recent views', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lads-dashboard-'));
  const path = join(directory, 'Analytics.db'); const db = fixture(path);
  try {
    publish(db);
    const recent = readLeagueDashboard(path, { now, period: 'overnight', limit: 3 });
    assert.equal(recent.summary.games, 7);
    assert.equal(recent.summary.teams, 2);
    assert.equal(recent.summary.averageDurationSeconds, 2400);
    assert.equal(recent.asOf, now.toISOString());
    assert.deepEqual(recent.results.map(m => m.matchId), [112, 111, 110]);
    assert.equal(recent.results[1].winner.teamName, 'Team B');
    assert.equal(recent.results[1].loser.teamName, 'Team A');
    const next = readLeagueDashboard(path, { now, period: 'overnight', limit: 3, before: recent.nextBefore });
    assert.deepEqual(next.results.map(m => m.matchId), [109, 108, 107]);
    assert.equal(readLeagueDashboard(path, { now, period: 'week' }).summary.games, 12);
    db.exec('UPDATE MatchFacts SET StartedAtUtc = NULL WHERE MatchId = 112');
    assert.equal(readLeagueDashboard(path, { now, period: 'overnight' }).summary.games, 6);
    const historical = readLeagueDashboard(path, { now, period: 'historical' });
    assert.equal(historical.summary.games, 12);
    assert.equal(historical.summary.undatedGames, 1);
    assert.equal(historical.results[0].playedAt, null);
    const serialized = JSON.stringify(historical);
    for (const privateKey of ['SignupMMR', 'PrivatePlayerFeatures', '987654321', 'SourceHash']) assert.equal(serialized.includes(privateKey), false);
    const highlights = readHighlightFeed(path, { now, period: 'overnight', limit: 20 });
    assert.ok(highlights.highlights.filter(s => s.playerId).every(s => s.occurredAt >= recent.window.from));
    assert.ok(highlights.highlights.filter(s => s.playerId).every(s => s.playerName && s.stat));
    db.exec("UPDATE AnalyticsRuns SET Scope = 'legacy_preview' WHERE RunId = 1");
    assert.equal(readLeagueDashboard(path, { now, period: 'historical' }).available, false);
    assert.equal(readLeagueDashboard(path, { now, period: 'historical', allowPreview: true }).summary.games, 12);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('season watch describes group form, honors hidden stories, and separates an ended season from a current run', () => {
  const db = fixture();
  try {
    db.exec(`UPDATE SeasonFacts SET GroupEndMatchId = NULL, TiebreakerEndMatchId = NULL;
      INSERT INTO GroupFacts VALUES (1, 3, 1, 'North group');`);
    publish(db);
    const watch = seasonWatch(db, 1);
    assert.equal(watch.phase, 'regular');
    assert.equal(watch.forms[0].teamName, 'Team A');
    assert.equal(watch.forms[0].groupName, 'North group');
    assert.equal(watch.forms[0].wins, 4);
    assert.deepEqual(watch.forms[0].form, ['W', 'W', 'W', 'L', 'W']);
    const hot = db.prepare("SELECT * FROM HighlightEvents WHERE Category = 'hot_run'").get();
    assert.equal(hot.Status, 'published');
    moderateHighlight(db, hot.HighlightId, { hidden: true });
    assert.equal(seasonWatch(db, 1).forms.length, 0);
    publish(db); // Hidden content remains generated/valid instead of becoming withdrawn.
    assert.equal(db.prepare('SELECT Status FROM HighlightEvents WHERE HighlightId = ?').get(hot.HighlightId).Status, 'published');
    moderateHighlight(db, hot.HighlightId, { hidden: false });
    db.exec("UPDATE SeasonFacts SET Status = 'ended'");
    assert.equal(seasonWatch(db, 1).phase, 'ended');
  } finally { db.close(); }
});

test('season watch records span the season, keep stage records separate, and label uncertain series scores without inventing finals', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lads-watch-'));
  const path = join(directory, 'Analytics.db'); const db = fixture(path);
  try {
    db.exec(`UPDATE SeasonFacts SET GroupEndMatchId = 107, TiebreakerEndMatchId = 107;
      UPDATE MatchFacts SET Stage = 'playoff' WHERE MatchId >= 108;
      UPDATE MatchFacts SET SeriesId = 900 WHERE MatchId >= 110;
      INSERT INTO SeriesFacts VALUES (1, 900, 3, 21, 22, 3, 'Lower bracket round 3', 3);`);
    publish(db);
    const form = readLeagueDashboard(path, { now, period: 'historical' }).seasonWatch.forms[0];
    assert.deepEqual(form.seasonRecord, { wins: 11, losses: 1 });
    assert.deepEqual(form.stageRecord, { wins: 4, losses: 1 });
    assert.deepEqual(form.latestSeries, { seriesId: 900, opponentId: 22, opponentName: 'Team B',
      wins: 2, losses: 1, bestOf: 3, verifiedComplete: true });
    db.exec('UPDATE MatchFacts SET StartedAtUtc = NULL WHERE MatchId = 112');
    const historical = seasonWatch(db, 1).forms[0].latestSeries;
    assert.equal(historical.wins, 2); assert.equal(historical.losses, 1);
    assert.equal(historical.verifiedComplete, false);
    db.exec('UPDATE SeriesFacts SET BestOf = 5');
    assert.equal(seasonWatch(db, 1).forms[0].latestSeries.verifiedComplete, false);
    db.exec('UPDATE SeriesFacts SET SourceMatchCount = 4');
    assert.equal(seasonWatch(db, 1).forms[0].latestSeries, null); // Missing imported game.
    db.exec('UPDATE SeriesFacts SET SourceMatchCount = 3, Team2Id = 23');
    assert.equal(seasonWatch(db, 1).forms[0].latestSeries, null); // Pairing does not match the games.
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('reverse sweeps require a complete verified BO3/BO5 sequence and never infer format from a partial score', () => {
  const formats = bracketSeriesFormats({ upperBracket: [{ round: 2, matches: [{ seriesId: 1, team1Id: 21, team2Id: 22 }] }],
    grandFinals: [{ seriesId: 2, team1Id: 21, team2Id: 22 }] });
  assert.equal(formats.get(1).bestOf, 3); assert.equal(formats.get(2).bestOf, 5);
  assert.equal(bracketSeriesFormats('{bad json').size, 0);
  const games = winners => winners.map((WinnerTeamId, index) => ({ MatchId: index + 1, Stage: 'playoff',
    StartedAtUtc: `2026-10-12T${String(10 + index).padStart(2, '0')}:00:00.000Z`, DurationSeconds: 2400, WinnerTeamId }));
  const bo3 = { BestOf: 3, SourceMatchCount: 3, Team1Id: 21, Team2Id: 22 };
  assert.equal(verifiedSeriesOutcome(bo3, games([22, 21, 21])).reverseSweep, true);
  assert.equal(verifiedSeriesOutcome(bo3, games([21, 22, 21])).reverseSweep, false);
  assert.equal(verifiedSeriesOutcome({ ...bo3, BestOf: 5 }, games([22, 21, 21])), null);
  assert.equal(verifiedSeriesOutcome({ ...bo3, BestOf: null }, games([22, 21, 21])), null);
  assert.equal(verifiedSeriesOutcome({ ...bo3, SourceMatchCount: 4 }, games([22, 21, 21])), null);
  assert.equal(verifiedSeriesOutcome(bo3, games([21, 21, 22])), null); // Extra game after the clincher.
  const unknown = games([22, 21, 21]); unknown[0].StartedAtUtc = null;
  assert.equal(verifiedSeriesOutcome(bo3, unknown), null);
  const bo5 = { ...bo3, BestOf: 5, SourceMatchCount: 5 };
  assert.equal(verifiedSeriesOutcome(bo5, games([22, 22, 21, 21, 21])).reverseSweep, true);
  assert.equal(verifiedSeriesOutcome(bo5, games([22, 21, 22, 21, 21])).reverseSweep, false);
});

test('verified playoff comebacks publish as league news, and corrections withdraw their claims', () => {
  const db = fixture();
  try {
    db.exec(`UPDATE MatchFacts SET Stage = 'playoff', SeriesId = 900 WHERE MatchId >= 110;
      UPDATE MatchFacts SET WinnerTeamId = 22 WHERE MatchId = 110;
      UPDATE MatchFacts SET WinnerTeamId = 21 WHERE MatchId = 111;
      UPDATE TeamGameFacts SET Won = (TeamId = 22) WHERE MatchId = 110;
      UPDATE TeamGameFacts SET Won = (TeamId = 21) WHERE MatchId = 111;
      UPDATE PlayerGameFacts SET Won = (TeamSubmissionId = 12) WHERE MatchId = 110;
      UPDATE PlayerGameFacts SET Won = (TeamSubmissionId = 11) WHERE MatchId = 111;
      INSERT INTO SeriesFacts VALUES (1, 900, 3, 21, 22, 3, 'Lower bracket round 3', 3);`);
    publish(db);
    const story = db.prepare("SELECT * FROM HighlightEvents WHERE Category = 'reverse_sweep'").get();
    assert.equal(story.Status, 'published');
    assert.match(story.Body, /Down 1-0/);
    assert.match(story.Body, /beat Team B 2-1/);
    assert.equal(highlightDTO(story).seriesId, 900);
    const revision = story.Revision;
    copyRun(db, 2);
    db.exec("UPDATE MatchFacts SET StartedAtUtc = '2026-10-13T04:30:00.000Z' WHERE RunId = 2 AND MatchId = 112");
    publish(db, 2);
    const corrected = db.prepare('SELECT * FROM HighlightEvents WHERE HighlightId = ?').get(story.HighlightId);
    assert.ok(corrected.Revision > revision);
    assert.equal(corrected.OccurredAtUtc, '2026-10-13T04:30:00.000Z');
    copyRun(db, 3); db.exec('UPDATE SeriesFacts SET BestOf = 5 WHERE RunId = 3'); publish(db, 3);
    assert.equal(db.prepare('SELECT Status FROM HighlightEvents WHERE HighlightId = ?').get(story.HighlightId).Status, 'withdrawn');
  } finally { db.close(); }
});

test('public API is bounded/paginated; admin writes are validated and invalidate cached public stories', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lads-highlight-api-'));
  const path = join(directory, 'Analytics.db'); const db = fixture(path);
  publish(db); db.close();
  const preview = fixture(join(directory, 'Analytics-preview-100.db'));
  try {
    publish(preview);
    preview.exec("UPDATE AnalyticsRuns SET Scope = 'legacy_preview' WHERE RunId = 1");
    const ids = preview.prepare("SELECT HighlightId FROM HighlightEvents WHERE Status = 'published' ORDER BY HighlightId DESC LIMIT 2").all();
    preview.prepare('UPDATE HighlightEvents SET Hidden = 1 WHERE HighlightId = ?').run(ids[0].HighlightId);
    preview.prepare('UPDATE HighlightEvents SET OverrideNeedsReview = 1 WHERE HighlightId = ?').run(ids[1].HighlightId);
  } finally { preview.close(); }
  const audited = [];
  const routers = createAnalyticsRoutes({ getPaths: () => ({ analytics: path, league: path }),
    listLeagues: () => [{ leagueId: 100 }], audit: (...args) => audited.push(args) });
  const app = express(); app.use(express.json()); app.use('/analytics', routers.publicRoutes);
  app.use('/admin', (req, res, next) => req.headers['x-test-admin'] === 'yes'
    ? runWithAuditActor({ AdminPlayerId: 123 }, next) : res.sendStatus(401), routers.adminRoutes);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await (await fetch(`${base}/analytics/highlights?limit=2`)).json();
    assert.equal(first.highlights.length, 2); assert.ok(first.nextBefore);
    const second = await (await fetch(`${base}/analytics/highlights?limit=2&before=${first.nextBefore}`)).json();
    assert.ok(second.highlights.every(s => s.id < first.nextBefore));
    assert.equal((await fetch(`${base}/analytics/highlights?limit=21`)).status, 400);
    assert.equal((await fetch(`${base}/analytics/highlights?previewLeague=100`)).status, 400);
    assert.equal((await fetch(`${base}/admin/highlights`)).status, 401);
    assert.equal((await fetch(`${base}/admin/highlights/preview?previewLeague=100`)).status, 401);
    const authHeaders = { 'x-test-admin': 'yes' };
    assert.equal((await fetch(`${base}/admin/highlights/preview`, { headers: authHeaders })).status, 400);
    assert.equal((await fetch(`${base}/admin/highlights/preview?previewLeague=101`, { headers: authHeaders })).status, 404);
    const homepagePreview = await (await fetch(`${base}/admin/highlights/preview?previewLeague=100&limit=20&status=all`,
      { headers: authHeaders })).json();
    assert.equal(homepagePreview.highlights.length, 4); // Published only; hidden and review-held stories are excluded.
    assert.ok(homepagePreview.highlights.every(story => !('hidden' in story) && !('generatedBody' in story)));
    assert.equal(JSON.stringify(homepagePreview).includes('987654321'), false);
    assert.equal((await fetch(`${base}/analytics/highlights?allowPreview=true&previewLeague=100`)).status, 400);
    assert.equal((await fetch(`${base}/analytics/dashboard?period=bad`)).status, 400);
    assert.equal((await fetch(`${base}/analytics/dashboard?period=all`)).status, 400);
    assert.equal((await fetch(`${base}/analytics/dashboard?period=historical`)).status, 400);
    assert.equal((await fetch(`${base}/admin/dashboard/preview?previewLeague=100`)).status, 401);
    const resultsPreview = await (await fetch(`${base}/admin/dashboard/preview?previewLeague=100&limit=2`, { headers: authHeaders })).json();
    assert.equal(resultsPreview.results.length, 2);
    assert.equal(resultsPreview.summary.games, 12);
    assert.equal(resultsPreview.results[0].winner.teamName, 'Team A');
    const id = first.highlights[0].id;
    const patch = body => fetch(`${base}/admin/highlights/${id}`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-admin': 'yes' }, body: JSON.stringify(body) });
    assert.equal((await patch({ SignupMMR: 123 })).status, 400);
    assert.equal((await patch({ hidden: true })).status, 200);
    const fresh = await (await fetch(`${base}/analytics/highlights?limit=2`)).json();
    assert.ok(!fresh.highlights.some(s => s.id === id));
    assert.equal(audited.length, 1);
    const read = new Database(path, { readonly: true });
    try {
      assert.equal(read.prepare("SELECT ActorId FROM HighlightRevisions WHERE Reason = 'admin_override'").get().ActorId, '123');
    } finally { read.close(); }
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); }
});
