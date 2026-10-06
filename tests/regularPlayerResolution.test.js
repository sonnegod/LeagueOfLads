import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REGULAR_PLAYER_MARKETS } from '../betting/marketCatalog.js';
import { resolveRegularPlayerMarkets } from '../betting/resolveRegularPlayerMarkets.js';

test('regular player leaders require all group maps and 50% for averages; ties void', t => {
  const dir = mkdtempSync(join(tmpdir(), 'regular-resolution-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ladsPath = join(dir, 'LadsData.db');
  const bettingPath = join(dir, 'Betting.db');
  const lads = new Database(ladsPath);
  const betting = new Database(bettingPath);
  try {
    lads.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER, Status TEXT, ExternalLeagueId INTEGER);
      CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER, GroupEndMatchId INTEGER);
      CREATE TABLE SeasonTeams (SeasonId INTEGER, TeamSubmissionId INTEGER,
        GroupId INTEGER, ExternalTeamId INTEGER);
      CREATE TABLE SeasonTeamPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER);
      CREATE TABLE MatchLeague (MatchId INTEGER, LeagueId INTEGER);
      CREATE TABLE MatchTeam (MatchId INTEGER, TeamRad INTEGER, TeamDire INTEGER,
        Rehost INTEGER);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, Kills INTEGER,
        Deaths INTEGER, Assists INTEGER, GPM INTEGER, XPM INTEGER);
      CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);
      INSERT INTO LeagueSeasons VALUES (7,'active',77);
      INSERT INTO LeagueStageBoundaries VALUES (77,6);
      INSERT INTO SeasonTeams VALUES (7,11,1,101),(7,12,1,102),(7,13,1,103);
      INSERT INTO SeasonTeamPlayers VALUES (11,1001),(12,1002),(13,1003);
      INSERT INTO MatchLeague VALUES (1,77),(2,77),(3,77),(4,77),(5,77),(6,77);
      INSERT INTO MatchTeam VALUES (1,101,102,0),(2,101,102,0),
        (3,101,103,0),(4,101,103,0),(5,102,103,0),(6,102,103,0);`);
    const add = lads.prepare('INSERT INTO MatchPlayer VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const id of [1, 2, 3, 4]) {
      add.run(id, 1001, 10, 2, 10, 500, 500);
      lads.prepare('INSERT INTO MatchTeamPlayer VALUES (?,1001,101)').run(id);
    }
    add.run(1, 1002, 20, 1, 20, 1000, 1000); // Only 1/4 scheduled maps.
    lads.exec('INSERT INTO MatchTeamPlayer VALUES (1,1002,102)');
    for (const id of [3, 4, 5, 6]) {
      add.run(id, 1003, 10, 2, 10, 400, 400);
      lads.prepare('INSERT INTO MatchTeamPlayer VALUES (?,1003,103)').run(id);
    }
    betting.exec(`CREATE TABLE BettingSchemaMeta (id INTEGER, version INTEGER);
      INSERT INTO BettingSchemaMeta VALUES (1,2);
      CREATE TABLE Markets (id INTEGER PRIMARY KEY, market_key TEXT);
      CREATE TABLE BettingOptions (market_id INTEGER, outcome_key TEXT);`);
    const addMarket = betting.prepare('INSERT INTO Markets (market_key) VALUES (?)');
    const addOption = betting.prepare('INSERT INTO BettingOptions VALUES (?, ?)');
    for (const market of REGULAR_PLAYER_MARKETS) {
      const id = addMarket.run(`7:${market.key}`).lastInsertRowid;
      for (const player of [1001, 1002, 1003]) addOption.run(id, `player:${player}`);
    }
  } finally { lads.close(); betting.close(); }
  const result = resolveRegularPlayerMarkets({ seasonId: 7, ladsPath, bettingPath });
  assert.equal(result.results.length, 13);
  assert.equal(result.results.find(row => row.marketKey === 'regular:average_gpm').winningOutcomeKey,
    'player:1001');
  assert.equal(result.results.find(row => row.marketKey === 'regular:season_kills').status, 'VOID');
  const standIn = new Database(ladsPath);
  try {
    standIn.exec(`INSERT INTO MatchPlayer VALUES (3,1002,99,1,99,9999,9999);
      INSERT INTO MatchTeamPlayer VALUES (3,1002,103);`);
  } finally { standIn.close(); }
  assert.equal(resolveRegularPlayerMarkets({ seasonId: 7, ladsPath, bettingPath }).results
    .find(row => row.marketKey === 'regular:average_gpm').winningOutcomeKey, 'player:1001');
  const threshold = new Database(ladsPath);
  try {
    threshold.prepare('INSERT INTO MatchPlayer VALUES (2,1002,20,1,20,1000,1000)').run();
    threshold.exec('INSERT INTO MatchTeamPlayer VALUES (2,1002,102)');
  } finally { threshold.close(); }
  assert.equal(resolveRegularPlayerMarkets({ seasonId: 7, ladsPath, bettingPath }).results
    .find(row => row.marketKey === 'regular:average_gpm').winningOutcomeKey, 'player:1002');
  const incomplete = new Database(ladsPath);
  try { incomplete.prepare('DELETE FROM MatchTeam WHERE MatchId = 6').run(); }
  finally { incomplete.close(); }
  assert.throws(() => resolveRegularPlayerMarkets({ seasonId: 7, ladsPath, bettingPath }),
    /not complete/);
});
