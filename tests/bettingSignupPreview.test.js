import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { buildSignupPreseasonPreview, signupPreviewPath } from '../betting/signupPreseasonPreview.js';
import { saveHistoricalPreview, readHistoricalPreview } from '../betting/historicalPreview.js';
import { teamProbability, seededRandom, simulateSeason } from '../betting/models.js';
import { BettingStore } from '../betting/store.js';
import { createBettingRoutes } from '../routes/bettingRoutes.js';
import { EventEmitter } from 'node:events';
import { createPreviewRebuilder } from '../betting/previewRefresh.js';

const now = new Date('2026-10-18T12:00:00.000Z');
function fixture() {
  const teams = Array.from({ length: 4 }, (_, i) => ({ TeamSubmissionId: i + 11, TeamId: null,
    TeamName: `Signup team ${i + 1}`, GroupId: 1, AverageSignupMMR: 5800 + i * 300 }));
  const roster = teams.flatMap((t, i) => Array.from({ length: 5 }, (_, slot) => ({
    TeamSubmissionId: t.TeamSubmissionId, PlayerId: i * 5 + slot + 1, PlayerName: `Player ${i * 5 + slot + 1}`,
    Slot: slot, SignupMMR: t.AverageSignupMMR })));
  const inputs = { season: { SeasonId: 3, LeagueId: 22, LeagueName: 'Upcoming season', Status: 'signup_closed',
    RulesJson: JSON.stringify({ UpperBracketTeams: 2, LowerBracketTeams: 2, EliminatedTeams: 0, HasTiebreaker: 0 }) }, teams, roster, games: [] };
  const history = Array.from({ length: 8 }, (_, g) => roster.map(p => ({
    MatchId: g + 1, LeagueId: 21, Stage: 'regular', PlayerId: p.PlayerId, Won: p.PlayerId <= 10 ? 1 : 0,
    StartedAtUtc: `2026-09-${String(g + 1).padStart(2, '0')}T12:00:00.000Z`, SourceObservedAtUtc: '2026-10-17T00:00:00.000Z',
    DurationSeconds: 2400, LaneRole: p.Slot < 2 ? 1 : 3, PatchKey: '7.40',
    Kills: p.PlayerId + g % 3, Deaths: 4, Assists: 10, LastHits: 100 + p.PlayerId,
    GPM: 400 + p.PlayerId * 10, XPM: 600 + p.PlayerId * 5, HeroDamage: 20000 + p.PlayerId * 100,
    TowerDamage: 2000, Healing: p.PlayerId === 2 && g < 4 ? null : 100,
  }))).flat();
  return { inputs, history, historyReports: [{ leagueId: 21, name: 'Previous league', games: 8 }], now, simulations: 100 };
}

test('signup preview prices actual rosters, distinguishes team strength and holds only missing metric histories', () => {
  const f = fixture(), sourceBefore = JSON.stringify(f.inputs), preview = buildSignupPreseasonPreview(f);
  assert.equal(preview.previewKind, 'signup'); assert.equal(preview.rosterSource, 'website_signups');
  assert.equal(preview.rosterTeams.length, 4); assert.ok(preview.rosterTeams.every(t => t.regularGames === 6));
  assert.ok(preview.markets.some(m => m.type === 'champion')); assert.equal(preview.seriesMarkets, 0);
  const wins=preview.markets.filter(m=>m.type==='season_team');assert.equal(wins.length,4);
  assert.ok(wins.every(m=>m.stat==='wins'&&m.regularGames===6&&m.line%1===.5&&m.selections.length===2));
  const data = preview.privateInputs.inputs;
  assert.ok(teamProbability(data, 11, 14) < .5);
  assert.ok(preview.markets.some(m => m.type === 'season_player' && m.playerId === 2 && m.stat === 'kills'));
  assert.equal(preview.markets.some(m => m.type === 'season_player' && m.playerId === 2 && m.stat === 'healing'), false);
  assert.ok(preview.held.some(h => h.playerId === 2 && h.stat === 'healing'));
  assert.equal(preview.markets.some(m => ['gpm', 'xpm'].includes(m.stat) && m.aggregation === 'total'), false);
  assert.ok(preview.markets.every(m => m.selections.every(s => Number.isFinite(s.odds) && s.odds >= 1.01)));
  assert.equal(JSON.stringify(f.inputs), sourceBefore);
  assert.equal(buildSignupPreseasonPreview(f).inputDigest, preview.inputDigest);
  assert.deepEqual(buildSignupPreseasonPreview(f).markets, preview.markets);
});

test('target results, future games, tiebreakers and source observations after the cutoff never enter preseason prices', () => {
  const f = fixture(), first = buildSignupPreseasonPreview(f);
  const poison = f.history.map(g => ({ ...g, Kills: 999999, GPM: 999999, Won: 1 }));
  const blocked = [...poison.map(g => ({ ...g, LeagueId: 22 })),
    ...poison.map(g => ({ ...g, SourceObservedAtUtc: '2026-10-19T00:00:00Z' })),
    ...poison.map(g => ({ ...g, StartedAtUtc: '2026-10-19T00:00:00Z' })),
    ...poison.map(g => ({ ...g, Stage: 'tiebreaker' }))];
  const second = buildSignupPreseasonPreview({ ...f, history: [...f.history, ...blocked] });
  assert.equal(second.inputDigest, first.inputDigest); assert.deepEqual(second.markets, first.markets);
  assert.ok(second.privateInputs.inputs.metricHistory.every(g => g.LeagueId !== 22 && g.Kills < 999999));
});

test('team strength uses signup MMR and softened player win records without performance or resource penalties', () => {
  const f = fixture(), preview = buildSignupPreseasonPreview(f);
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const inputs = preview.privateInputs.inputs;
  const average = f.inputs.teams.reduce((sum, t) => sum + t.AverageSignupMMR, 0) / f.inputs.teams.length;
  // First team has eight wins per player: posterior win chance is 18/28.
  const playerLogit = Math.log((18 / 28) / (1 - 18 / 28));
  assert.ok(Math.abs(inputs.preseasonTeamPriors[11] - sigmoid((5800 - average) / 1000 + .35 * Math.min(.6, playerLogit))) < 1e-12);
  assert.equal(inputs.performanceStrength, undefined);
  const changed = buildSignupPreseasonPreview({ ...f, history: f.history.map(g => ({ ...g,
    Gold10: 9999999, NetWorthShare: 99, KillParticipation: 100, GPM: 9999, HeroDamage: 999999 })) });
  assert.deepEqual(changed.privateInputs.inputs.preseasonTeamPriors, inputs.preseasonTeamPriors);
  assert.equal(preview.strengthModel, undefined);
});

test('matchup diagnostics count the actual season draws without changing simulated outcomes', () => {
  const preview = buildSignupPreseasonPreview(fixture()), report = preview.matchupSimulation;
  assert.equal(report.samples, 100); assert.equal(report.matchups.length, 6);
  for (const matchup of report.matchups) {
    assert.equal(matchup.scores.reduce((n, s) => n + s.count, 0), report.samples);
    assert.ok(Math.abs(matchup.scores.reduce((n, s) => n + s.probability, 0) - 1) < 1e-12);
    assert.equal(matchup.scores[0].probability, matchup.gameWinProbability ** 2);
    assert.ok(matchup.scores.every(s => Number.isInteger(s.count) && s.count >= 0));
  }
  assert.ok(report.matchups.find(m => m.team1Key === 11 && m.team2Key === 14).gameWinProbability < .5);
  const inputs = preview.privateInputs.inputs, setup = { RegularGamesPerTeam: preview.privateInputs.gameCounts };
  const plain = simulateSeason(inputs, setup, seededRandom(123), 100);
  const { matchups, ...traced } = simulateSeason(inputs, setup, seededRandom(123), 100, { includeMatchups: true });
  assert.deepEqual(traced, plain); assert.equal(matchups.length, 6);
});

test('uneven groups get different planned game counts and unsupported playoffs do not invent champion odds', () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) {
    const key = 20 + i;
    f.inputs.teams.push({ TeamSubmissionId: key, TeamId: null, TeamName: `Extra ${key}`, GroupId: 2, AverageSignupMMR: 6000 });
    for (let slot = 0; slot < 5; slot++) f.inputs.roster.push({ PlayerId: 100 + i * 5 + slot, Slot: slot,
      TeamSubmissionId: key, PlayerName: `Extra player ${i * 5 + slot}` });
  }
  f.inputs.season.RulesJson = JSON.stringify({ UpperBracketTeams: 2, LowerBracketTeams: 1, EliminatedTeams: 2, HasTiebreaker: 0 });
  const preview = buildSignupPreseasonPreview(f);
  assert.ok(preview.rosterTeams.filter(t => t.teamId < 20).every(t => t.regularGames === 6));
  assert.ok(preview.rosterTeams.filter(t => t.teamId >= 20).every(t => t.regularGames === 8));
  assert.equal(preview.markets.some(m => m.type === 'champion'), false);
  assert.ok(preview.markets.some(m => m.type === 'placement'));
  assert.ok(preview.held.some(h => h.reason === 'group_or_bracket_format_not_supported'));
  assert.equal(preview.markets.some(m => m.type === 'player_leader'), false);
});

test('signup preview validates incomplete rosters, duplicates, stages and existing regular-season games', () => {
  const f = fixture();
  assert.throws(() => buildSignupPreseasonPreview({ ...f, simulations: 0 }), /simulations/);
  f.inputs.season.Status = 'signup_open'; assert.throws(() => buildSignupPreseasonPreview(f), /Close signups/);
  f.inputs.season.Status = 'signup_closed'; f.inputs.games = [{ Stage: 'regular' }];
  assert.throws(() => buildSignupPreseasonPreview(f), /without regular-season games/); f.inputs.games = [];
  f.inputs.roster[1].PlayerId = f.inputs.roster[0].PlayerId;
  assert.throws(() => buildSignupPreseasonPreview(f), /distinct players/);
});

test('admin preview preserves grouping without false team links, hides private model inputs and cannot create wallets', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'lads-signup-preview-'));
  const source = new Database(':memory:'), betting = new Database(join(scratch, 'Betting.db')); let server, previewDb;
  try {
    source.exec(`CREATE TABLE SeasonGroups(SeasonId INTEGER,GroupId INTEGER,GroupName TEXT);INSERT INTO SeasonGroups VALUES(3,1,'Saved group');
      CREATE TABLE LeagueSeasons(SeasonId INTEGER PRIMARY KEY,Status TEXT);INSERT INTO LeagueSeasons VALUES(3,'signup_closed');`);
    const preview = buildSignupPreseasonPreview(fixture()); preview.privateInputs.privateSentinel = 'PRIVATE_MODEL_SENTINEL';
    preview.matchupSimulation.matchups[0].privateSentinel = 'PRIVATE_DIAGNOSTIC_SENTINEL';
    preview.strengthModel = { privateSentinel: 'PRIVATE_STRENGTH_SENTINEL' };
    const path = signupPreviewPath(betting.name, 3); saveHistoricalPreview(path, preview, []);
    const grouped = readHistoricalPreview(path, { preseasonGroup: 'team', groupTeams: true });
    assert.ok(grouped.teamGroups[0].teams.every(t => t.teamId === null && t.teamKey > 0));
    const book = new BettingStore(betting);
    let rebuilds = 0;
    const routes = createBettingRoutes({ book, league: source, schedules: {}, analyticsPath: 'unused',
      rebuildPreview: async options => { assert.equal(options.seasonId, 3); rebuilds++; return { rebuilt: true }; } }), app = express();
    app.use('/api/betting', routes.publicRoutes);
    app.use('/api/admin/betting', (req, res, next) => req.headers['x-test-admin'] === 'yes' ? next() : res.sendStatus(403), routes.adminRoutes);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`, headers = { 'x-test-admin': 'yes' };
    assert.equal((await fetch(`${base}/api/admin/betting/preview?seasonId=3`)).status, 403);
    assert.equal((await fetch(`${base}/api/admin/betting/seasons/3/preview`, { method: 'POST' })).status, 403);
    assert.equal(rebuilds, 0);
    const rebuilt = await fetch(`${base}/api/admin/betting/seasons/3/preview`, { method: 'POST', headers });
    assert.equal(rebuilt.status, 200); assert.equal((await rebuilt.json()).rebuilt, true); assert.equal(rebuilds, 1);
    source.exec("UPDATE LeagueSeasons SET Status='signup_open'");
    assert.equal((await fetch(`${base}/api/admin/betting/seasons/3/preview`, { method: 'POST', headers })).status, 409);
    assert.equal(rebuilds, 1);
    assert.equal((await fetch(`${base}/api/betting/preview?seasonId=3`, { headers })).status, 404);
    const response = await fetch(`${base}/api/admin/betting/preview?seasonId=3&preseasonGroup=team&groupTeams=1`, { headers });
    assert.equal(response.status, 200); const text = await response.text(), body = JSON.parse(text);
    assert.equal(body.previewKind, 'signup'); assert.equal(body.teamGroups[0].name, 'Saved group');
    assert.ok(body.teamGroups[0].teams.every(t=>t.wins?.line%1===.5&&t.wins.selections.length===2));
    assert.equal(body.matchupSimulation.samples, 100); assert.equal(body.matchupSimulation.matchups.length, 6);
    assert.equal(body.matchupSimulation.matchups[0].groupName, 'Saved group');
    assert.equal(body.strengthModel, undefined);
    for (const secret of ['PRIVATE_MODEL_SENTINEL', 'PRIVATE_DIAGNOSTIC_SENTINEL', 'PRIVATE_STRENGTH_SENTINEL', 'AverageSignupMMR', 'SignupMMR', 'preseasonDistributions', 'preseasonTeamPriors', 'coefficients']) assert.equal(text.includes(secret), false);
    const playerResponse = await fetch(`${base}/api/admin/betting/preview?seasonId=3&preseasonGroup=player&groupPlayers=1`, { headers });
    assert.equal((await playerResponse.json()).matchupSimulation, null);
    assert.equal((await fetch(`${base}/api/admin/betting/preview?seasonId=3&leagueId=22`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/api/admin/betting/preview?seasonId=3&scope=series`, { headers })).status, 400);
    previewDb = new Database(path); assert.throws(() => new BettingStore(previewDb), /cannot be used as a live betting database/);
    assert.equal(previewDb.prepare("SELECT 1 FROM sqlite_master WHERE name='BettingWallets'").get(), undefined);
    assert.throws(() => signupPreviewPath(betting.name, '../3'), /Invalid/);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); previewDb?.close(); betting.close(); source.close();
    if (dirname(resolve(scratch)) !== resolve(tmpdir()) || !scratch.split(/[\\/]/).at(-1).startsWith('lads-signup-preview-')) throw Error('Unexpected cleanup target');
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('preview rebuild requests share a worker, reject parallel seasons, recover after failure and hide child errors', async () => {
  const children = [];
  const rebuild = createPreviewRebuilder({ launch: () => {
    const child = new EventEmitter(); child.kill = () => {}; children.push(child); return child;
  } });
  const options = { seasonId: 3, leaguePath: 'source.db', bettingPath: 'Betting.db', analyticsPath: 'Analytics.db' };
  const first = rebuild(options), duplicate = rebuild(options);
  assert.equal(children.length, 1);
  await assert.rejects(rebuild({ ...options, seasonId: 4 }), error => error.status === 409);
  children[0].emit('close', 0);
  assert.deepEqual(await Promise.all([first, duplicate]), [{ rebuilt: true }, { rebuilt: true }]);
  const failed = rebuild(options);
  children[1].emit('error', Error('PRIVATE_CHILD_DETAILS'));
  await assert.rejects(failed, error => error.status === 503 && !error.message.includes('PRIVATE_CHILD_DETAILS'));
  const recovery = rebuild(options); children[2].emit('close', 0);
  assert.deepEqual(await recovery, { rebuilt: true });
});
