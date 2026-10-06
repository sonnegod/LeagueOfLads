import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPreseasonForecasts } from '../betting/analytics/preseasonForecasts.js';
import { draftForecastMarkets } from '../betting/analytics/draftForecastMarkets.js';
import { publishPreseasonMarkets } from '../betting/publishPreseasonMarkets.js';
import { REGULAR_PLAYER_MARKETS, averageEligible, regularSchedule } from '../betting/marketCatalog.js';

test('regular-season schedule counts Bo2 maps and average eligibility', () => {
  assert.deepEqual(regularSchedule(11), { series: 10, maps: 20 });
  assert.deepEqual(regularSchedule(12), { series: 11, maps: 22 });
  assert.equal(averageEligible(10, 20), true);
  assert.equal(averageEligible(9, 20), false);
  assert.equal(REGULAR_PLAYER_MARKETS.length, 13);
});

test('closed, grouped signup roster creates immutable draft forecasts for every player and team', t => {
  const dir = mkdtempSync(join(tmpdir(), 'preseason-forecast-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ladsPath = join(dir, 'LadsData.db');
  const publicPath = join(dir, 'public.db');
  const analyticsPath = join(dir, 'Analytics.db');
  const bettingPath = join(dir, 'Betting.db');
  const lads = new Database(ladsPath);
  const publicDb = new Database(publicPath);
  try {
    lads.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER, LeagueName TEXT, Status TEXT);
      CREATE TABLE SeasonGroups (GroupId INTEGER, SeasonId INTEGER, GroupName TEXT);
      CREATE TABLE SeasonTeams (TeamSubmissionId INTEGER, SeasonId INTEGER, GroupId INTEGER,
        TeamName TEXT, IsManual INTEGER, ManualAverageMMR INTEGER);
      CREATE TABLE SeasonTeamPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER, MMR INTEGER);
      CREATE TABLE PlayerInfo (PlayerId INTEGER, PlayerName TEXT);
      CREATE TABLE SeasonLeagueRules (SeasonId INTEGER, UpperBracketTeams INTEGER,
        LowerBracketTeams INTEGER, EliminatedTeams INTEGER, HasTiebreaker INTEGER,
        TiebreakerPosition INTEGER);
      CREATE TABLE MatchLeague (MatchId INTEGER, DatePlayed TEXT);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, Kills INTEGER,
        Deaths INTEGER, Assists INTEGER, GPM INTEGER, XPM INTEGER,
        Lasthits INTEGER, Winner INTEGER);
      INSERT INTO LeagueSeasons VALUES (7, 'Test season', 'signup_closed');
      INSERT INTO SeasonGroups VALUES (1,7,'A'),(2,7,'B');
      INSERT INTO SeasonTeams VALUES (11,7,1,'One',0,NULL),(12,7,1,'Two',0,NULL),
        (13,7,2,'Three',0,NULL),(14,7,2,'Four',0,NULL);
      INSERT INTO SeasonLeagueRules VALUES (7,1,0,1,0,NULL);
      INSERT INTO MatchLeague VALUES (100,'2026-08-01'),(101,'2026-08-02');`);
    const addPlayer = lads.prepare('INSERT INTO PlayerInfo VALUES (?, ?)');
    const addSignup = lads.prepare('INSERT INTO SeasonTeamPlayers VALUES (?, ?, ?)');
    const addMatch = lads.prepare('INSERT INTO MatchPlayer VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let team = 11; team <= 14; team += 1) for (let slot = 1; slot <= 5; slot += 1) {
      const id = team * 100 + slot;
      addPlayer.run(id, `Player ${id}`);
      addSignup.run(team, id, 6000 + team * 30 + slot);
      addMatch.run(100, id, slot + 3, slot, slot + 5, 400 + slot * 20, 450 + slot * 20, 100, 1);
      addMatch.run(101, id, slot + 4, slot + 1, slot + 6, 420 + slot * 20, 470 + slot * 20, 110, 0);
    }
    publicDb.exec(`CREATE TABLE PublicMatchPlayer (PlayerId INTEGER, MatchId INTEGER,
      Kills INTEGER, Deaths INTEGER, Assists INTEGER, Won INTEGER, HeroId INTEGER,
      DateCreated TEXT)`);
    publicDb.prepare(`INSERT INTO PublicMatchPlayer VALUES
      (1101,200,8,2,10,1,1,'2026-10-03T00:00:00.000Z')`).run();
  } finally { lads.close(); publicDb.close(); }
  const options = { seasonId: 7, ladsPath, publicPath, analyticsPath,
    asOf: '2026-10-06T00:00:00.000Z', simulations: 100 };
  const result = buildPreseasonForecasts(options);
  assert.equal(result.reused, false);
  assert.equal(result.players, 20);
  assert.equal(result.forecasts, 276);
  assert.deepEqual(result.groupSchedule, [
    { groupId: 1, series: 1, maps: 2 }, { groupId: 2, series: 1, maps: 2 },
  ]);
  assert.equal(buildPreseasonForecasts(options).reused, true);
  const analytics = new Database(analyticsPath, { readonly: true });
  try {
    assert.equal(analytics.prepare('SELECT Status FROM AnalyticsRuns').get().Status, 'complete');
    assert.equal(analytics.prepare('SELECT COUNT(*) AS n FROM PreseasonPlayerFeatures').get().n, 20);
    assert.equal(analytics.prepare(`SELECT RecentPublicGames AS n FROM PreseasonPlayerFeatures
      WHERE PlayerId = 1101`).get().n, 1);
    assert.equal(analytics.prepare(`SELECT COUNT(*) AS n FROM ModelForecasts
      WHERE MarketKey = 'regular:season_kills'`).get().n, 20);
    const sums = analytics.prepare(`SELECT MarketKey, SUM(FairProbability) AS probability
      FROM ModelForecasts GROUP BY MarketKey`).all();
    assert.equal(sums.length, 20);
    for (const row of sums) assert.ok(Math.abs(row.probability - 1) < 1e-8,
      `${row.MarketKey}: ${row.probability}`);
    assert.equal(analytics.prepare(`SELECT COUNT(*) AS n FROM ModelForecasts
      WHERE MarketKey LIKE 'playoffs:%'`).get().n, 0);
  } finally { analytics.close(); }

  const betting = new Database(bettingPath);
  betting.exec(`CREATE TABLE BettingSchemaMeta (id INTEGER, version INTEGER);
    INSERT INTO BettingSchemaMeta VALUES (1,2);
    CREATE TABLE Markets (id INTEGER PRIMARY KEY, market_key TEXT UNIQUE,
      season_id INTEGER, type TEXT, title TEXT, status TEXT, reference_id TEXT, source_run_key TEXT,
      source_as_of TEXT, close_time TEXT, published_at TEXT);
    CREATE TABLE BettingOptions (id INTEGER PRIMARY KEY, market_id INTEGER,
      outcome_key TEXT, name TEXT, line_value REAL);
    CREATE TABLE OptionPriceHistory (id INTEGER PRIMARY KEY, option_id INTEGER,
      odds REAL, fair_probability REAL, source_run_key TEXT, published_at TEXT);`);
  betting.close();
  const dryRun = draftForecastMarkets({ runId: result.runId, analyticsPath, bettingPath });
  assert.equal(dryRun.markets, 20);
  assert.equal(dryRun.options, 276);
  assert.equal(draftForecastMarkets({ runId: result.runId, analyticsPath,
    bettingPath, dryRun: false }).created, 20);
  assert.equal(draftForecastMarkets({ runId: result.runId, analyticsPath,
    bettingPath, dryRun: false }).created, 0);
  const posted = new Database(bettingPath, { readonly: true });
  try {
    assert.equal(posted.prepare('SELECT COUNT(*) AS n FROM Markets').get().n, 20);
    assert.equal(posted.prepare('SELECT COUNT(*) AS n FROM BettingOptions').get().n, 276);
    assert.equal(posted.prepare('SELECT COUNT(*) AS n FROM OptionPriceHistory').get().n, 276);
    assert.equal(posted.prepare("SELECT COUNT(*) AS n FROM Markets WHERE status = 'OPEN'").get().n, 0);
  } finally { posted.close(); }
  const publication = { seasonId: 7, ladsPath, bettingPath,
    closeAt: '2026-10-10T21:00:00.000Z', now: '2026-10-06T12:00:00.000Z' };
  assert.equal(publishPreseasonMarkets(publication).markets, 20);
  assert.equal(publishPreseasonMarkets({ ...publication, apply: true }).published, 20);
  const opened = new Database(bettingPath, { readonly: true });
  try {
    assert.equal(opened.prepare("SELECT COUNT(*) AS n FROM Markets WHERE status = 'OPEN'").get().n, 20);
  } finally { opened.close(); }
  assert.throws(() => publishPreseasonMarkets(publication), /DRAFT/);
});
