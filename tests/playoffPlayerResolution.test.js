import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePlayoffBracket } from '../client/src/utils/playoffBracket.js';
import { PLAYOFF_PLAYER_MARKETS } from '../betting/marketCatalog.js';
import { resolvePlayoffPlayerMarkets } from '../betting/resolvePlayoffPlayerMarkets.js';

test('playoff player futures require all bracket maps and final champion', t => {
  const dir = mkdtempSync(join(tmpdir(), 'playoff-resolution-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ladsPath = join(dir, 'LadsData.db');
  const bettingPath = join(dir, 'Betting.db');
  const lads = new Database(ladsPath);
  const betting = new Database(bettingPath);
  try {
    lads.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER, Status TEXT,
        ExternalLeagueId INTEGER, ChampionTeamId INTEGER);
      CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER, TieBreakerEndMatchId INTEGER);
      CREATE TABLE PlayoffBracket (LeagueId INTEGER, PlayoffStructure TEXT);
      CREATE TABLE SeasonTeams (SeasonId INTEGER, TeamSubmissionId INTEGER,
        ExternalTeamId INTEGER);
      CREATE TABLE SeasonTeamPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER);
      CREATE TABLE MatchLeague (MatchId INTEGER, LeagueId INTEGER);
      CREATE TABLE MatchTeam (MatchId INTEGER, TeamRad INTEGER, TeamDire INTEGER,
        WinnerId INTEGER, Rehost INTEGER);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, Kills INTEGER,
        Deaths INTEGER, Assists INTEGER, GPM INTEGER, XPM INTEGER);
      CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);
      INSERT INTO LeagueSeasons VALUES (7,'ended',77,101);
      INSERT INTO LeagueStageBoundaries VALUES (77,100);
      INSERT INTO SeasonTeams VALUES (7,11,101),(7,12,102),(7,13,103),(7,14,104);
      INSERT INTO SeasonTeamPlayers VALUES (11,1001),(12,1002),(13,1003),(14,1004);`);
    const bracket = generatePlayoffBracket([
      { Bracket: 'upper' }, { Bracket: 'upper' },
      { Bracket: 'lower' }, { Bracket: 'lower' },
    ]);
    Object.assign(bracket.upperBracket[0].matches[0], {
      team1Id: '101', team2Id: '102', team1Score: 2, team2Score: 0,
    });
    Object.assign(bracket.lowerBracket[0].matches[0], {
      team1Id: '103', team2Id: '104', team1Score: 2, team2Score: 0,
    });
    Object.assign(bracket.lowerBracket[1].matches[0], {
      team1Id: '103', team2Id: '102', team1Score: 2, team2Score: 0,
    });
    Object.assign(bracket.grandFinals[0], {
      team1Id: '101', team2Id: '103', team1Score: 3, team2Score: 0,
    });
    lads.prepare('INSERT INTO PlayoffBracket VALUES (77,?)').run(JSON.stringify(bracket));
    const addLeague = lads.prepare('INSERT INTO MatchLeague VALUES (?,77)');
    const addTeam = lads.prepare('INSERT INTO MatchTeam VALUES (?, ?, ?, ?, 0)');
    const addPlayer = lads.prepare('INSERT INTO MatchPlayer VALUES (?, ?, ?, 2, 5, 400, 420)');
    const addTeamPlayer = lads.prepare('INSERT INTO MatchTeamPlayer VALUES (?, ?, ?)');
    const pairings = [
      [101, 102, 101], [101, 102, 101],
      [103, 104, 103], [103, 104, 103],
      [103, 102, 103], [103, 102, 103],
      [101, 103, 101], [101, 103, 101], [101, 103, 101],
    ];
    pairings.forEach(([a, b, winner], index) => {
      const id = 101 + index;
      addLeague.run(id);
      addTeam.run(id, a, b, winner);
      for (const team of [a, b]) {
        const player = 900 + team;
        addPlayer.run(id, player, team === 101 ? 10 : 5);
        addTeamPlayer.run(id, player, team);
      }
    });
    betting.exec(`CREATE TABLE BettingSchemaMeta (id INTEGER, version INTEGER);
      INSERT INTO BettingSchemaMeta VALUES (1,2);
      CREATE TABLE Markets (id INTEGER PRIMARY KEY, market_key TEXT);
      CREATE TABLE BettingOptions (market_id INTEGER, outcome_key TEXT);`);
    const addMarket = betting.prepare('INSERT INTO Markets (market_key) VALUES (?)');
    const addOption = betting.prepare('INSERT INTO BettingOptions VALUES (?, ?)');
    for (const market of PLAYOFF_PLAYER_MARKETS) {
      const id = addMarket.run(`7:${market.key}`).lastInsertRowid;
      for (const player of [1001, 1002, 1003, 1004]) addOption.run(id, `player:${player}`);
    }
  } finally { lads.close(); betting.close(); }
  const preview = resolvePlayoffPlayerMarkets({ seasonId: 7, ladsPath, bettingPath });
  assert.equal(preview.playoffMaps, 9);
  assert.equal(preview.results.length, 13);
  assert.equal(preview.results.find(row => row.marketKey === 'playoffs:season_kills')
    .winningOutcomeKey, 'player:1001');
  const missing = new Database(ladsPath);
  try { missing.exec('DELETE FROM MatchTeam WHERE MatchId = 109'); }
  finally { missing.close(); }
  assert.throws(() => resolvePlayoffPlayerMarkets({ seasonId: 7, ladsPath, bettingPath }),
    /do not match final bracket/);
});
