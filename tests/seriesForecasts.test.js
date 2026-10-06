import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bo2TeamProbabilities, buildSeriesForecasts } from '../betting/analytics/seriesForecasts.js';
import { draftForecastMarkets } from '../betting/analytics/draftForecastMarkets.js';
import { autoDraftScheduledSeries } from '../betting/analytics/autoDraftScheduledSeries.js';
import { resolveSeriesForecasts } from '../betting/analytics/resolveSeriesForecasts.js';
import { publishSeriesMarkets } from '../betting/publishSeriesMarkets.js';
import { autoSettleV2Series } from '../betting/autoSettleV2Series.js';
import { syncSeriesCloseTimes } from '../betting/syncSeriesCloseTimes.js';

test('Bo2 team prices include only the three possible series results', () => {
  assert.deepEqual(bo2TeamProbabilities(0.5), {
    a20: 0.25, draw: 0.5, b20: 0.25,
  });
});

test('upcoming series produces team and player-prop drafts for explicit publication', t => {
  const dir = mkdtempSync(join(tmpdir(), 'series-forecast-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ladsPath = join(dir, 'LadsData.db');
  const publicPath = join(dir, 'public.db');
  const analyticsPath = join(dir, 'Analytics.db');
  const bettingPath = join(dir, 'Betting.db');
  const lads = new Database(ladsPath);
  const publicDb = new Database(publicPath);
  try {
    lads.exec(`CREATE TABLE ScheduledSeries (UID INTEGER, Team1 INTEGER, Team2 INTEGER, Date TEXT);
      CREATE TABLE ScheduledSeriesTimes (ScheduledSeriesUid INTEGER, StartAt TEXT);
      CREATE TABLE LeagueSeasons (SeasonId INTEGER, Status TEXT, ExternalLeagueId INTEGER);
      CREATE TABLE SeasonTeams (TeamSubmissionId INTEGER, SeasonId INTEGER, ExternalTeamId INTEGER,
        TeamName TEXT, IsManual INTEGER, ManualAverageMMR INTEGER);
      CREATE TABLE SeasonTeamPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER, MMR INTEGER);
      CREATE TABLE PlayerInfo (PlayerId INTEGER, PlayerName TEXT);
      CREATE TABLE MatchLeague (MatchId INTEGER, DatePlayed TEXT);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, Kills INTEGER,
        Deaths INTEGER, Assists INTEGER, GPM INTEGER, XPM INTEGER);
      CREATE TABLE SeriesInfo (SeriesId INTEGER, Team1 INTEGER, Team2 INTEGER, LeagueId INTEGER);
      CREATE TABLE SeriesMatch (SeriesId INTEGER, MatchId INTEGER);
      CREATE TABLE MatchTeam (MatchId INTEGER, TeamRad INTEGER, TeamDire INTEGER,
        WinnerId INTEGER, Rehost INTEGER);
      INSERT INTO ScheduledSeries VALUES (99, 101, 102, '2026-10-10');
      INSERT INTO ScheduledSeriesTimes VALUES (99, '2026-10-10T01:00:00.000Z');
      INSERT INTO LeagueSeasons VALUES (7, 'active', 77);
      INSERT INTO SeasonTeams VALUES (11,7,101,'One',0,NULL),(12,7,102,'Two',0,NULL);
      INSERT INTO MatchLeague VALUES (1,'2026-09-01'),(2,'2026-09-02');
      INSERT INTO SeriesInfo VALUES (500,101,102,77);`);
    const addPlayer = lads.prepare('INSERT INTO PlayerInfo VALUES (?, ?)');
    const addSignup = lads.prepare('INSERT INTO SeasonTeamPlayers VALUES (?, ?, ?)');
    const addMatch = lads.prepare('INSERT INTO MatchPlayer VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let team = 11; team <= 12; team += 1) for (let slot = 1; slot <= 5; slot += 1) {
      const id = team * 100 + slot;
      addPlayer.run(id, `Player ${id}`);
      addSignup.run(team, id, 6000 + team * 30 + slot);
      addMatch.run(1, id, slot + 3, slot, slot + 5, 400 + slot * 20, 450 + slot * 20);
      addMatch.run(2, id, slot + 4, slot + 1, slot + 6, 420 + slot * 20, 470 + slot * 20);
    }
    publicDb.exec(`CREATE TABLE PublicMatchPlayer (PlayerId INTEGER, MatchId INTEGER,
      Kills INTEGER, Deaths INTEGER, Assists INTEGER, DateCreated TEXT);
      INSERT INTO PublicMatchPlayer VALUES (1101,200,8,2,10,'2026-10-03T00:00:00.000Z');`);
  } finally { lads.close(); publicDb.close(); }
  const options = { seriesUid: 99, ladsPath, publicPath, analyticsPath,
    asOf: '2026-10-06T00:00:00.000Z', simulations: 100 };
  const result = buildSeriesForecasts(options);
  assert.equal(result.forecasts, 103);
  assert.equal(buildSeriesForecasts(options).reused, true);
  const analytics = new Database(analyticsPath, { readonly: true });
  try {
    assert.equal(analytics.prepare('SELECT COUNT(*) AS n FROM PreseasonPlayerFeatures').get().n, 10);
    const sums = analytics.prepare(`SELECT MarketKey, SUM(FairProbability) AS p
      FROM ModelForecasts GROUP BY MarketKey`).all();
    assert.equal(sums.length, 51);
    for (const row of sums) assert.ok(Math.abs(row.p - 1) < 1e-8, row.MarketKey);
    assert.equal(analytics.prepare(`SELECT COUNT(*) AS n FROM ModelForecasts
      WHERE OutcomeKey IN ('over','under') AND LineValue IS NULL`).get().n, 0);
  } finally { analytics.close(); }
  const betting = new Database(bettingPath);
  betting.exec(`CREATE TABLE BettingSchemaMeta (id INTEGER, version INTEGER);
    INSERT INTO BettingSchemaMeta VALUES (1,2);
    CREATE TABLE Markets (id INTEGER PRIMARY KEY, market_key TEXT UNIQUE,
      season_id INTEGER, type TEXT, title TEXT, status TEXT, reference_id TEXT,
      source_run_key TEXT, source_as_of TEXT, close_time TEXT, published_at TEXT,
      settled_at TEXT);
    CREATE TABLE BettingOptions (id INTEGER PRIMARY KEY, market_id INTEGER,
      outcome_key TEXT, name TEXT, line_value REAL, status TEXT DEFAULT 'OPEN');
    CREATE TABLE OptionPriceHistory (id INTEGER PRIMARY KEY, option_id INTEGER,
      odds REAL, fair_probability REAL, source_run_key TEXT, published_at TEXT);
    CREATE TABLE MarketResults (market_id INTEGER PRIMARY KEY, result_status TEXT,
      result_reference TEXT, result_at TEXT);
    CREATE TABLE MarketResultWinningOptions (market_id INTEGER, option_id INTEGER);
    CREATE TABLE ParlayTickets (id INTEGER, user_id TEXT, total_amount INTEGER,
      status TEXT, settlement_time TEXT);
    CREATE TABLE BetLegs (ticket_id INTEGER, market_id INTEGER, option_id INTEGER,
      odds_at_time REAL);
    CREATE TABLE UserWallets (user_id TEXT, balance INTEGER, total_won INTEGER);
    CREATE TABLE TransactionLog (user_id TEXT, amount INTEGER, type TEXT,
      reference_id INTEGER);`);
  betting.close();
  assert.equal(draftForecastMarkets({ runId: result.runId, analyticsPath, bettingPath }).markets, 51);
  const automated = autoDraftScheduledSeries({ seriesUids: [99, 99], ladsPath,
    publicPath, analyticsPath, bettingPath, asOf: options.asOf, simulations: 100 });
  assert.equal(automated.series.length, 1);
  assert.equal(automated.series[0].marketsCreated, 51);
  assert.equal(autoDraftScheduledSeries({ seriesUids: [99], ladsPath, publicPath,
    analyticsPath, bettingPath, asOf: options.asOf, simulations: 100 })
    .series[0].status, 'EXISTING');
  assert.equal(draftForecastMarkets({ runId: result.runId, analyticsPath,
    bettingPath, dryRun: false }).created, 0);
  assert.equal(publishSeriesMarkets({ seriesUid: 99, ladsPath, bettingPath,
    now: options.asOf }).dryRun, true);
  assert.equal(publishSeriesMarkets({ seriesUid: 99, ladsPath, bettingPath,
    now: options.asOf, apply: true }).markets, 51);
  const earlierKickoff = new Database(ladsPath);
  try {
    earlierKickoff.prepare(`UPDATE ScheduledSeriesTimes SET StartAt = ?
      WHERE ScheduledSeriesUid = 99`).run('2026-10-10T00:30:00.000Z');
  } finally { earlierKickoff.close(); }
  assert.equal(syncSeriesCloseTimes({ seriesUids: [99], ladsPath, bettingPath,
    now: options.asOf }).tightened, 51);
  const posted = new Database(bettingPath, { readonly: true });
  try {
    assert.equal(posted.prepare(`SELECT COUNT(*) AS n FROM Markets WHERE status = 'OPEN'`).get().n, 51);
    assert.equal(posted.prepare(`SELECT COUNT(*) AS n FROM Markets WHERE reference_id = '99'`).get().n, 51);
    assert.equal(posted.prepare(`SELECT COUNT(*) AS n FROM BettingOptions WHERE line_value IS NOT NULL`).get().n, 100);
  } finally { posted.close(); }
  const completed = new Database(ladsPath);
  try {
    completed.exec(`ALTER TABLE MatchLeague ADD COLUMN LeagueId INTEGER;
      INSERT INTO MatchLeague VALUES (3,'2026-10-10',77),(4,'2026-10-10',77);
      INSERT INTO SeriesMatch VALUES (500,3),(500,4);
      INSERT INTO MatchTeam VALUES (3,101,102,101,0),(4,101,102,102,0);`);
    const insert = completed.prepare('INSERT INTO MatchPlayer VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let team = 11; team <= 12; team += 1) for (let slot = 1; slot <= 5; slot += 1) {
      const id = team * 100 + slot;
      insert.run(3, id, 5, 2, 8, 450, 500);
      insert.run(4, id, 6, 3, 9, 475, 525);
    }
  } finally { completed.close(); }
  const resolved = resolveSeriesForecasts({ seriesUid: 99, completedSeriesId: 500,
    ladsPath, bettingPath });
  assert.equal(resolved.results.length, 51);
  assert.equal(resolved.results.find(row => row.marketKey.endsWith(':exact_score')).winningOutcomeKey,
    'draw:1-1');
  assert.equal(resolved.results.filter(row => row.marketKey.includes(':player:')).length, 50);
  const sweep = new Database(ladsPath);
  try { sweep.prepare('UPDATE MatchTeam SET WinnerId = 101 WHERE MatchId = 4').run(); }
  finally { sweep.close(); }
  const swept = resolveSeriesForecasts({ seriesUid: 99, completedSeriesId: 500,
    ladsPath, bettingPath });
  assert.equal(swept.results.find(row => row.marketKey.endsWith(':exact_score')).winningOutcomeKey,
    'team_submission:11:2-0');
  const wrongLeague = new Database(ladsPath);
  try { wrongLeague.prepare('UPDATE SeriesInfo SET LeagueId = 999 WHERE SeriesId = 500').run(); }
  finally { wrongLeague.close(); }
  const awaiting = autoSettleV2Series({ bettingPath, ladsPath,
    now: '2026-10-11T00:00:00.000Z' });
  assert.equal(awaiting.locked, 51);
  assert.equal(awaiting.series[0].status, 'awaiting_valid_league_result');
  const corrected = new Database(ladsPath);
  try { corrected.prepare('UPDATE SeriesInfo SET LeagueId = 77 WHERE SeriesId = 500').run(); }
  finally { corrected.close(); }
  const automatic = autoSettleV2Series({ bettingPath, ladsPath,
    now: '2026-10-11T00:00:00.000Z' });
  assert.equal(automatic.locked, 0);
  assert.equal(automatic.series[0].status, 'settled');
  const settled = new Database(bettingPath, { readonly: true });
  try {
    assert.equal(settled.prepare('SELECT COUNT(*) AS n FROM MarketResults').get().n, 51);
    assert.equal(settled.prepare("SELECT COUNT(*) AS n FROM Markets WHERE status = 'SETTLED'").get().n, 51);
  } finally { settled.close(); }
  assert.deepEqual(autoSettleV2Series({ bettingPath, ladsPath,
    now: '2026-10-11T00:00:00.000Z' }).series, []);
  assert.throws(() => resolveSeriesForecasts({ seriesUid: 99, completedSeriesId: 501,
    ladsPath, bettingPath }), /does not match/);
  assert.throws(() => buildSeriesForecasts({ ...options,
    asOf: '2026-10-11T00:00:00.000Z' }), /upcoming/);
});
