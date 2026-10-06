import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChampionMarket, resolveChampionMarkets } from '../betting/resolveChampionMarket.js';

test('champion future resolves only after the season is final', t => {
  const dir = mkdtempSync(join(tmpdir(), 'champion-resolution-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ladsPath = join(dir, 'LadsData.db');
  const bettingPath = join(dir, 'Betting.db');
  const lads = new Database(ladsPath);
  const betting = new Database(bettingPath);
  try {
    lads.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER, Status TEXT,
      ChampionTeamId INTEGER, ExternalLeagueId INTEGER);
      CREATE TABLE SeasonTeams (SeasonId INTEGER, TeamSubmissionId INTEGER,
        ExternalTeamId INTEGER);
      INSERT INTO LeagueSeasons VALUES (7,'active',NULL,77);
      INSERT INTO SeasonTeams VALUES (7,11,101),(7,12,102);`);
    betting.exec(`CREATE TABLE BettingSchemaMeta (id INTEGER, version INTEGER);
      INSERT INTO BettingSchemaMeta VALUES (1,2);
      CREATE TABLE Markets (id INTEGER, market_key TEXT);
      CREATE TABLE BettingOptions (market_id INTEGER, outcome_key TEXT);
      INSERT INTO Markets VALUES (9,'7:season:champion');
      INSERT INTO BettingOptions VALUES (9,'team_submission:11'),
        (9,'team_submission:12');`);
    assert.throws(() => resolveChampionMarket({ seasonId: 7, ladsPath, bettingPath }), /not final/);
    lads.prepare(`UPDATE LeagueSeasons SET Status = 'ended', ChampionTeamId = 102
      WHERE SeasonId = 7`).run();
  } finally { lads.close(); betting.close(); }
  assert.deepEqual(resolveChampionMarket({ seasonId: 7, ladsPath, bettingPath }), {
    marketId: 9, status: 'FINAL', winningOutcomeKey: 'team_submission:12',
    resultReference: 'season:7:champion:102',
  });
  const withPlayoff = new Database(bettingPath);
  try {
    withPlayoff.exec(`INSERT INTO Markets VALUES (10,'7:playoffs:champion');
      INSERT INTO BettingOptions VALUES (10,'team_submission:11'),
        (10,'team_submission:12');`);
  } finally { withPlayoff.close(); }
  assert.deepEqual(resolveChampionMarkets({ seasonId: 7, ladsPath, bettingPath })
    .map(result => result.marketId), [9, 10]);
});
