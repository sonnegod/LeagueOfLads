import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRegularTeamMarkets } from '../betting/resolveRegularTeamMarkets.js';

test('team futures follow reviewed final seeding, including eliminated teams', t => {
  const dir = mkdtempSync(join(tmpdir(), 'team-resolution-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ladsPath = join(dir, 'LadsData.db');
  const bettingPath = join(dir, 'Betting.db');
  const lads = new Database(ladsPath);
  const betting = new Database(bettingPath);
  try {
    lads.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER, Status TEXT, ExternalLeagueId INTEGER);
      CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER, GroupEndMatchId INTEGER,
        TieBreakerEndMatchId INTEGER);
      CREATE TABLE SeasonTeams (SeasonId INTEGER, TeamSubmissionId INTEGER,
        GroupId INTEGER, ExternalTeamId INTEGER);
      CREATE TABLE PlayoffSeeding (TeamId INTEGER, LeagueId INTEGER, Seed INTEGER, Bracket TEXT);
      INSERT INTO LeagueSeasons VALUES (7,'active',77);
      INSERT INTO LeagueStageBoundaries VALUES (77,10,12);
      INSERT INTO SeasonTeams VALUES (7,11,1,101),(7,12,1,102),(7,13,2,103),(7,14,2,104);
      INSERT INTO PlayoffSeeding VALUES (101,77,1,'upper'),(101,77,1,'upper'),
        (103,77,1,'lower');`);
    betting.exec(`CREATE TABLE BettingSchemaMeta (id INTEGER, version INTEGER);
      INSERT INTO BettingSchemaMeta VALUES (1,2);
      CREATE TABLE Markets (id INTEGER PRIMARY KEY, market_key TEXT);
      CREATE TABLE BettingOptions (market_id INTEGER, outcome_key TEXT);`);
    const addMarket = betting.prepare('INSERT INTO Markets (market_key) VALUES (?)');
    const addOption = betting.prepare('INSERT INTO BettingOptions VALUES (?, ?)');
    for (const [group, teams] of [[1, [11, 12]], [2, [13, 14]]]) {
      const id = addMarket.run(`7:regular:group_winner:${group}`).lastInsertRowid;
      for (const team of teams) addOption.run(id, `team_submission:${team}`);
    }
    for (const team of [11, 12, 13, 14]) {
      const id = addMarket.run(`7:regular:playoffs_vs_eliminated:${team}`).lastInsertRowid;
      addOption.run(id, 'qualify');
      addOption.run(id, 'eliminated');
    }
  } finally { lads.close(); betting.close(); }
  const result = resolveRegularTeamMarkets({ seasonId: 7, ladsPath, bettingPath });
  assert.equal(result.results.length, 6);
  assert.equal(result.finalSeeding.length, 2); // Identical duplicate seed rows are harmless.
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.results.find(row => row.marketKey === 'regular:group_winner:2')
    .winningOutcomeKey, 'team_submission:13');
  assert.equal(result.results.find(row => row.marketKey === 'regular:playoffs_vs_eliminated:12')
    .winningOutcomeKey, 'eliminated');
  const changed = new Database(ladsPath);
  try { changed.exec(`INSERT INTO PlayoffSeeding VALUES (104,77,2,'lower')`); }
  finally { changed.close(); }
  assert.notEqual(resolveRegularTeamMarkets({ seasonId: 7, ladsPath, bettingPath }).fingerprint,
    result.fingerprint);
  const conflicting = new Database(ladsPath);
  try { conflicting.exec(`INSERT INTO PlayoffSeeding VALUES (101,77,2,'lower')`); }
  finally { conflicting.close(); }
  assert.throws(() => resolveRegularTeamMarkets({ seasonId: 7, ladsPath, bettingPath }),
    /Conflicting playoff seeds/);
});

test('team futures refuse unrecorded tiebreaker boundary', t => {
  const dir = mkdtempSync(join(tmpdir(), 'team-resolution-boundary-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ladsPath = join(dir, 'LadsData.db');
  const bettingPath = join(dir, 'Betting.db');
  const lads = new Database(ladsPath);
  const betting = new Database(bettingPath);
  try {
    lads.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER, Status TEXT, ExternalLeagueId INTEGER);
      CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER, GroupEndMatchId INTEGER,
        TieBreakerEndMatchId INTEGER);
      INSERT INTO LeagueSeasons VALUES (7,'active',77);
      INSERT INTO LeagueStageBoundaries VALUES (77,10,NULL);`);
    betting.exec(`CREATE TABLE BettingSchemaMeta (id INTEGER, version INTEGER);
      INSERT INTO BettingSchemaMeta VALUES (1,2);`);
  } finally { lads.close(); betting.close(); }
  assert.throws(() => resolveRegularTeamMarkets({ seasonId: 7, ladsPath, bettingPath }),
    /boundaries must be final/);
});
