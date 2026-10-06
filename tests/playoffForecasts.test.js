import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePlayoffBracket } from '../client/src/utils/playoffBracket.js';
import { buildPlayoffForecasts } from '../betting/analytics/playoffForecasts.js';
import { draftForecastMarkets } from '../betting/analytics/draftForecastMarkets.js';
import { publishPlayoffMarkets } from '../betting/publishPlayoffMarkets.js';

test('saved unplayed bracket creates draft playoff player and champion odds', t => {
  const dir = mkdtempSync(join(tmpdir(), 'playoff-forecasts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ladsPath = join(dir, 'LadsData.db');
  const publicPath = join(dir, 'public.db');
  const analyticsPath = join(dir, 'Analytics.db');
  const bettingPath = join(dir, 'Betting.db');
  const lads = new Database(ladsPath);
  const publicDb = new Database(publicPath);
  try {
    lads.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER, Status TEXT, ExternalLeagueId INTEGER);
      CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER, GroupEndMatchId INTEGER,
        TieBreakerEndMatchId INTEGER);
      CREATE TABLE PlayoffSeeding (LeagueId INTEGER, TeamId INTEGER, Seed INTEGER, Bracket TEXT);
      CREATE TABLE PlayoffBracket (LeagueId INTEGER, PlayoffStructure TEXT);
      CREATE TABLE SeasonTeams (SeasonId INTEGER, TeamSubmissionId INTEGER, TeamName TEXT,
        ExternalTeamId INTEGER, IsManual INTEGER, ManualAverageMMR INTEGER);
      CREATE TABLE SeasonTeamPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER, MMR INTEGER);
      CREATE TABLE PlayerInfo (PlayerId INTEGER, PlayerName TEXT);
      CREATE TABLE MatchLeague (MatchId INTEGER, LeagueId INTEGER, DatePlayed TEXT);
      CREATE TABLE MatchTeam (MatchId INTEGER, TeamRad INTEGER, TeamDire INTEGER,
        WinnerId INTEGER, Rehost INTEGER);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, Kills INTEGER,
        Deaths INTEGER, Assists INTEGER, GPM INTEGER, XPM INTEGER);
      INSERT INTO LeagueSeasons VALUES (7,'active',77);
      INSERT INTO LeagueStageBoundaries VALUES (77,2,2);
      INSERT INTO PlayoffSeeding VALUES (77,101,1,'upper'),(77,102,1,'upper'),
        (77,103,1,'lower'),(77,104,1,'lower');
      INSERT INTO SeasonTeams VALUES (7,11,'One',101,0,NULL),(7,12,'Two',102,0,NULL),
        (7,13,'Three',103,0,NULL),(7,14,'Four',104,0,NULL);
      INSERT INTO MatchLeague VALUES (1,77,'2026-09-01'),(2,77,'2026-09-02');
      INSERT INTO MatchTeam VALUES (1,101,102,101,0),(2,103,104,103,0);`);
    const bracket = generatePlayoffBracket([
      { Bracket: 'upper' }, { Bracket: 'upper' },
      { Bracket: 'lower' }, { Bracket: 'lower' },
    ]);
    Object.assign(bracket.upperBracket[0].matches[0], { team1Id: '101', team2Id: '102' });
    Object.assign(bracket.lowerBracket[0].matches[0], { team1Id: '103', team2Id: '104' });
    lads.prepare('INSERT INTO PlayoffBracket VALUES (77,?)').run(JSON.stringify(bracket));
    const addPlayer = lads.prepare('INSERT INTO PlayerInfo VALUES (?, ?)');
    const addRoster = lads.prepare('INSERT INTO SeasonTeamPlayers VALUES (?, ?, ?)');
    const addStat = lads.prepare('INSERT INTO MatchPlayer VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let team = 11; team <= 14; team += 1) for (let slot = 1; slot <= 5; slot += 1) {
      const id = team * 100 + slot;
      addPlayer.run(id, `Player ${id}`);
      addRoster.run(team, id, 6000 + team * 10 + slot);
      addStat.run(1, id, 5 + slot, 2, 6, 400, 420);
      addStat.run(2, id, 6 + slot, 3, 7, 410, 430);
    }
    publicDb.exec(`CREATE TABLE PublicMatchPlayer (PlayerId INTEGER, MatchId INTEGER,
      Kills INTEGER, Deaths INTEGER, Assists INTEGER, DateCreated TEXT)`);
  } finally { lads.close(); publicDb.close(); }
  const args = { seasonId: 7, ladsPath, publicPath, analyticsPath,
    asOf: '2026-10-06T00:00:00.000Z', simulations: 100 };
  const result = buildPlayoffForecasts(args);
  assert.equal(result.reused, false);
  assert.equal(result.bracketMatches, 4);
  assert.equal(result.forecasts, 264);
  assert.equal(buildPlayoffForecasts(args).reused, true);
  const analytics = new Database(analyticsPath, { readonly: true });
  try {
    const sums = analytics.prepare(`SELECT MarketKey, SUM(FairProbability) AS p
      FROM ModelForecasts GROUP BY MarketKey`).all();
    assert.equal(sums.length, 14);
    for (const row of sums) assert.ok(Math.abs(row.p - 1) < 1e-8, row.MarketKey);
  } finally { analytics.close(); }
  const betting = new Database(bettingPath);
  try {
    betting.exec(`CREATE TABLE BettingSchemaMeta (id INTEGER, version INTEGER);
      INSERT INTO BettingSchemaMeta VALUES (1,2);
      CREATE TABLE Markets (id INTEGER PRIMARY KEY, market_key TEXT UNIQUE,
        season_id INTEGER, type TEXT, title TEXT, status TEXT, reference_id TEXT,
        source_run_key TEXT, source_as_of TEXT, close_time TEXT, published_at TEXT);
      CREATE TABLE BettingOptions (id INTEGER PRIMARY KEY, market_id INTEGER,
        outcome_key TEXT, name TEXT, line_value REAL);
      CREATE TABLE OptionPriceHistory (id INTEGER PRIMARY KEY, option_id INTEGER,
        odds REAL, fair_probability REAL, source_run_key TEXT, published_at TEXT);`);
  } finally { betting.close(); }
  assert.equal(draftForecastMarkets({ runId: result.runId, analyticsPath, bettingPath }).markets, 14);
  assert.equal(draftForecastMarkets({ runId: result.runId, analyticsPath,
    bettingPath, dryRun: false }).created, 14);
  const publication = { seasonId: 7, ladsPath, bettingPath,
    closeAt: '2026-10-10T21:00:00.000Z', now: '2026-10-06T12:00:00.000Z' };
  assert.equal(publishPlayoffMarkets(publication).markets, 14);
  const changed = new Database(ladsPath);
  let original;
  try {
    original = changed.prepare('SELECT PlayoffStructure FROM PlayoffBracket').get().PlayoffStructure;
    const edited = JSON.parse(original);
    const first = edited.upperBracket[0].matches[0];
    [first.team1Id, first.team2Id] = [first.team2Id, first.team1Id];
    changed.prepare('UPDATE PlayoffBracket SET PlayoffStructure = ?')
      .run(JSON.stringify(edited));
  } finally { changed.close(); }
  assert.throws(() => publishPlayoffMarkets(publication), /completed bracket run/);
  const restored = new Database(ladsPath);
  try { restored.prepare('UPDATE PlayoffBracket SET PlayoffStructure = ?').run(original); }
  finally { restored.close(); }
  assert.equal(publishPlayoffMarkets({ ...publication, apply: true }).published, 14);
});
