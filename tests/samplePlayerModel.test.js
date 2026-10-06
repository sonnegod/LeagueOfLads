import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildSamplePlayerModel } from '../scripts/db/buildSamplePlayerModel.js';

test('sample model selects the last completed league and keeps forecasts non-bettable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lads-model-preview-'));
  const ladsPath = path.join(dir, 'LadsData.db');
  const publicPath = path.join(dir, 'public.db');
  const analyticsPath = path.join(dir, 'Analytics.db');
  const lads = new Database(ladsPath);
  const publicDb = new Database(publicPath);
  try {
    lads.exec(`CREATE TABLE LeagueInfo (LeagueId INTEGER, LeagueName TEXT, Active INTEGER);
      CREATE TABLE MatchLeague (MatchId INTEGER, LeagueId INTEGER, DatePlayed TEXT);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, Kills INTEGER,
        Deaths INTEGER, Assists INTEGER, GPM INTEGER);
      CREATE TABLE PlayerInfo (PlayerId INTEGER, PlayerName TEXT);
      CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER, GroupEndMatchId INTEGER,
        TieBreakerEndMatchId INTEGER);
      CREATE TABLE SeriesMatch (MatchId INTEGER, SeriesId INTEGER);
      CREATE TABLE SeriesInfo (SeriesId INTEGER, Stage TEXT);
      INSERT INTO LeagueInfo VALUES (10, 'Last completed league', 0), (11, 'Active league', 1);
      INSERT INTO PlayerInfo VALUES (12, 'Alpha'), (13, 'Beta'), (14, 'Visitor');
      INSERT INTO LeagueStageBoundaries VALUES (10, 102, 106);
      INSERT INTO SeriesInfo VALUES (1, 'g'), (2, 'p'), (3, 't');
      INSERT INTO SeriesMatch VALUES (101, 1), (103, 2), (105, 2), (106, 3);
      INSERT INTO MatchLeague VALUES (101, 10, '2026-09-01'),
        (102, 10, '2026-09-02'), (103, 10, '2026-09-03'),
        (105, 10, '2026-09-04'), (106, 10, '2026-09-05'),
        (104, 11, '2026-10-01');
      INSERT INTO MatchPlayer VALUES
        (101, 12, 5, 1, 7, 600), (102, 12, 5, 1, 7, 600),
        (103, 12, 1, 8, 2, 300), (105, 12, 1, 8, 2, 300),
        (106, 12, 50, 50, 50, 1500),
        (101, 13, 2, 3, 4, 400), (102, 13, 2, 3, 4, 400),
        (103, 13, 9, 1, 11, 900), (105, 13, 9, 1, 11, 900),
        (104, 14, 20, 1, 1, 900);`);
    publicDb.exec(`CREATE TABLE PublicMatchPlayer (PlayerId INTEGER, MatchId INTEGER,
      Kills INTEGER, Deaths INTEGER, Assists INTEGER, DateCreated TEXT);
      INSERT INTO PublicMatchPlayer VALUES
        (12, 201, 9, 1, 11, '2026-10-03T00:00:00.000Z'),
        (13, 202, 1, 4, 2, '2026-08-01T00:00:00.000Z');`);
    lads.close();
    publicDb.close();
    const options = { ladsPath, publicPath, analyticsPath,
      asOf: '2026-10-06T00:00:00.000Z', minimumLeagueGames: 2, simulations: 100 };
    const result = buildSamplePlayerModel(options);
    assert.equal(result.sourceLeagueId, 10);
    assert.equal(result.eligiblePlayers, 2);
    assert.deepEqual(result.eligibleByPhase, { regular: 2, playoffs: 2 });
    assert.equal(result.minimumPlayoffGames, 2);
    assert.equal(result.reused, false);
    assert.equal(result.top.regular.game_gpm[0].playerName, 'Alpha');
    assert.equal(result.top.regular.game_gpm[0].winProbability, 1);
    assert.equal(result.top.playoffs.game_gpm[0].playerName, 'Beta');
    assert.equal(result.top.playoffs.game_gpm[0].winProbability, 1);
    assert.equal(result.top.regular.season_kills[0].recentPublicGames, 1);
    assert.equal(buildSamplePlayerModel(options).reused, true);
    const db = new Database(analyticsPath, { readonly: true });
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SampleModelRuns').get().n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SamplePlayerForecasts').get().n, 32);
      const totals = db.prepare(`SELECT Phase, MetricKey, SUM(WinProbability) AS p
        FROM SamplePlayerForecasts GROUP BY Phase, MetricKey`).all();
      assert.equal(totals.length, 16);
      for (const row of totals) assert.ok(Math.abs(row.p - 1) < 0.00001);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ModelForecasts').get().n, 0);
      assert.equal(db.prepare(`SELECT PublicPerGame FROM SamplePlayerForecasts
        WHERE MetricKey = 'regular:game_gpm' AND PlayerId = 12`).get().PublicPerGame, null);
      assert.equal(db.prepare(`SELECT LeaguePerGame FROM SamplePlayerForecasts
        WHERE MetricKey = 'regular:season_kills' AND PlayerId = 12`).get().LeaguePerGame, 5);
      assert.equal(db.prepare(`SELECT LeaguePerGame FROM SamplePlayerForecasts
        WHERE MetricKey = 'playoffs:season_kills' AND PlayerId = 12`).get().LeaguePerGame, 1);
    } finally { db.close(); }
  } finally {
    if (lads.open) lads.close();
    if (publicDb.open) publicDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
