import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { historicalPricingInputs, historicalSourceFingerprint } from '../betting/historicalPricing.js';
import { teamProbability, statSampler, seededRandom } from '../betting/models.js';
import { readSeasonBettingInputs } from '../analytics/bettingInputs.js';
import { runBetting, seasonGuard, fixtureGuard } from '../betting/engine.js';
import { preseasonFixture } from './helpers/bettingFixture.js';

const now = new Date('2026-10-13T12:00:00.000Z');
function history({ reversed = false } = {}) {
  const rows = [];
  for (let season = 0; season < 2; season++) for (let game = 0; game < 30; game++) for (let player = 0; player < 10; player++) {
    const side = player < 5 ? 0 : 1;
    const won = reversed ? (season === 0 ? 1 - side : side) : (game + side) % 2;
    rows.push({ MatchId: 1000 + season * 100 + game, LeagueId: 300 + season,
      PlayerId: side === 0 ? 210 + player : 220 + player - 5, TeamSubmissionId: 500 + side,
      Stage: 'regular', StartedAtUtc: new Date(Date.parse('2026-09-01T00:00:00Z') + season * 30 * 86400000 + game * 3600000).toISOString(),
      SourceObservedAtUtc: '2026-10-12T00:00:00.000Z', DurationSeconds: 1800, Won: won,
      Kills: 10, Deaths: 5, Assists: 15, LastHits: 200, HeroDamage: 20000, TowerDamage: 1000, Healing: 100, GPM: 500, XPM: 600 });
  }
  return rows;
}
function coldStart() {
  const f = preseasonFixture([4, 4]);
  f.analytics.exec(`DELETE FROM PlayerGameFacts; DELETE FROM TeamGameFacts; DELETE FROM MatchFacts; DELETE FROM TeamSeasonStats;
    UPDATE SourceSnapshots SET LastSuccessAtUtc=NULL,LatestStatus='untracked';
    UPDATE PrivateTeamFeatures SET AverageSignupMMR=NULL;`);
  const builder = (inputs, at) => ({ ...historicalPricingInputs(inputs, { history: history() }, at),
    sourceFingerprint: historicalSourceFingerprint(f.league) });
  return { ...f, builder };
}

test('backfilled records validate through an explicit season holdout without inventing historical signup ratings or observations', () => {
  const f = coldStart();
  try {
    const inputs = readSeasonBettingInputs(f.analytics, 2, now), rows = history(), original = JSON.stringify(rows);
    const result = historicalPricingInputs(inputs, { history: rows }, now);
    assert.equal(result.validation.validated, true); assert.equal(result.validation.samples, 30);
    assert.equal(result.validation.method, 'retrospective_season_holdout');
    assert.equal(result.validation.historicalSignupMMRUsed, false);
    assert.equal(result.validation.statDistributions.kills.samples, 300);
    assert.equal(JSON.stringify(rows), original);
    assert.equal(result.metricHistory[0].SourceObservedAtUtc, '2026-10-12T00:00:00.000Z');
    assert.equal(inputs.history.length, 0); assert.equal(inputs.metricHistory.length, 0);
    const changedMMR = { ...inputs, teams: inputs.teams.map(team => ({ ...team, AverageSignupMMR: team.TeamSubmissionId * 100000 })) };
    assert.deepEqual(historicalPricingInputs(changedMMR, { history: rows }, now).preseasonTeamPriors, result.preseasonTeamPriors);
    assert.equal(teamProbability({ ...inputs, ...result }, 21, 22), .5);
    assert.equal(statSampler({ ...inputs, ...result }, 9999, 'kills', seededRandom(1)), null);
  } finally { f.close(); }
});

test('same-season results cannot train predictions and poor historical scores do not pass', () => {
  const f = coldStart();
  try {
    const inputs = readSeasonBettingInputs(f.analytics, 2, now);
    const single = historicalPricingInputs(inputs, { history: history().filter(row => row.LeagueId === 300) }, now);
    assert.equal(single.validation.samples, 0); assert.equal(single.validation.validated, false);
    assert.equal(single.validation.statDistributions.kills.samples, 0);
    const poor = historicalPricingInputs(inputs, { history: history({ reversed: true }) }, now);
    assert.equal(poor.validation.samples, 30); assert.ok(poor.validation.brier > .27);
    assert.equal(poor.validation.validated, false); assert.equal(poor.validation.reason, 'historical_pricing_validation_failed');
  } finally { f.close(); }
});

test('target season, unfinished/future/unobserved games, duplicate players and inconsistent sides are excluded as whole games', () => {
  const f = coldStart();
  try {
    const inputs = readSeasonBettingInputs(f.analytics, 2, now), rows = history().slice(0, 10);
    for (const mutate of [row => ({ ...row, LeagueId: 200 }), row => ({ ...row, StartedAtUtc: now.toISOString() }),
      row => ({ ...row, SourceObservedAtUtc: '2026-10-14T00:00:00Z' }), row => ({ ...row, SourceObservedAtUtc: null }),
      row => ({ ...row, DurationSeconds: 0 }), row => ({ ...row, PlayerId: 210 }),
      row => ({ ...row, Won: 1 }), row => ({ ...row, Stage: 'tiebreaker' })]) {
      const result = historicalPricingInputs(inputs, { history: rows.map(mutate) }, now);
      assert.equal(result.validation.games, 0); assert.equal(result.metricHistory.length, 0);
    }
    assert.equal(historicalPricingInputs(inputs, { history: [...rows, rows[0]] }, now).validation.games, 0);
    const overlapping = history().map(row => ({ ...row, StartedAtUtc: '2026-09-01T00:10:00.000Z' }));
    assert.equal(historicalPricingInputs(inputs, { history: overlapping }, now).validation.samples, 0);
  } finally { f.close(); }
});

test('cold-start production markets open from validated history, accept a ticket, and never use training records for settlement', async () => {
  const f = coldStart(), scratch = mkdtempSync(join(tmpdir(), 'lads-historical-'));
  try {
    const result = runBetting({ ...f, now, seasonId: 2, simulations: 100, historicalInputBuilder: f.builder });
    assert.ok(result.marketsOpened > 100); assert.deepEqual(result.issues, []);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='BettingLocalTestMetadata'").get().n, 0);
    const forecast = f.betting.prepare('SELECT ModelVersion,ValidationJson FROM BettingForecasts ORDER BY ForecastId DESC LIMIT 1').get();
    assert.equal(forecast.ModelVersion, 'historical-roster-v1');
    assert.equal(JSON.parse(forecast.ValidationJson).validated, true);
    const market = f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_player' LIMIT 1").get();
    assert.ok(market); assert.equal(JSON.parse(market.RulesJson).localTesting, undefined);
    assert.equal(JSON.parse(market.RulesJson).historicalPricing.version, 'historical-roster-v1');
    const path = join(scratch, 'Analytics.db'); await f.analytics.backup(path);
    f.book.eventGuard = (id, m) => fixtureGuard(f.league, id, m, now);
    f.book.seasonGuard = (id, m) => seasonGuard(f.league, path, id, m, now);
    assert.equal(f.book.seasonGuard(2, market), null);
    const q = f.betting.prepare('SELECT SelectionId FROM BettingSelections WHERE MarketId=? LIMIT 1').get(market.MarketId);
    const ticket = f.book.accept('99', { seasonId: 2, stake: 100, requestKey: 'historical_ticket_1',
      legs: [{ selectionId: q.SelectionId, quoteVersion: market.QuoteVersion }] });
    assert.ok(ticket.ticketId); assert.equal(f.book.wallet(2, '99').balance, 9900);
    const second = runBetting({ ...f, now, seasonId: 2, simulations: 100, historicalInputBuilder: f.builder });
    assert.equal(second.marketsOpened, 0); assert.equal(second.marketsSettled, 0);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) n FROM MatchFacts').get().n, 0);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE Status='settled'").get().n, 0);
  } finally {
    f.close(); if (dirname(resolve(scratch)) !== resolve(tmpdir())) throw Error('Unexpected cleanup target');
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('historical source guards do not authorize unrelated models; new imports, roster edits and stale Analytics hold quotes', async () => {
  const f = coldStart(), scratch = mkdtempSync(join(tmpdir(), 'lads-historical-guards-'));
  try {
    runBetting({ ...f, now, seasonId: 2, simulations: 100, historicalInputBuilder: f.builder });
    const market = f.betting.prepare("SELECT * FROM BettingMarkets WHERE MarketType='season_team' LIMIT 1").get();
    const path = join(scratch, 'Analytics.db'); await f.analytics.backup(path);
    const shared = {};
    assert.equal(seasonGuard(f.league, path, 2, market, now, shared), null);
    const ordinary = { ...market, RulesJson: JSON.stringify({ ...JSON.parse(market.RulesJson), historicalPricing: undefined }) };
    assert.match(seasonGuard(f.league, path, 2, ordinary, now, shared), /source data needs refreshing/);
    f.league.exec("CREATE TABLE MatchSourceDetails(MatchId INTEGER PRIMARY KEY,ObservedAtUtc TEXT); INSERT INTO MatchSourceDetails VALUES(1,'2026-10-13T12:00:01Z');");
    assert.match(seasonGuard(f.league, path, 2, market, now), /historical inputs/);
    f.league.exec('DROP TABLE MatchSourceDetails; UPDATE SeasonTeams SET GroupId=5 WHERE TeamSubmissionId=21;');
    assert.match(seasonGuard(f.league, path, 2, market, now), /setup changed/);
    f.league.exec('UPDATE SeasonTeams SET GroupId=2 WHERE TeamSubmissionId=21;');
    const future = { ...market, UpdatedAtUtc: '2026-10-20T12:00:00Z' };
    f.league.prepare('UPDATE ScheduledEvents SET ScheduledStartUtc=?').run('2026-10-25T00:00:00Z');
    assert.match(seasonGuard(f.league, path, 2, future, new Date('2026-10-20T12:00:00Z')), /inputs need refreshing/);
  } finally {
    f.close(); if (dirname(resolve(scratch)) !== resolve(tmpdir())) throw Error('Unexpected cleanup target');
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('failed retrospective validation keeps production markets closed', () => {
  const f = coldStart();
  try {
    const result = runBetting({ ...f, now, seasonId: 2, simulations: 100, historicalInputBuilder: inputs => ({
      ...historicalPricingInputs(inputs, { history: history({ reversed: true }) }, now), sourceFingerprint: historicalSourceFingerprint(f.league),
    }) });
    assert.equal(result.marketsOpened, 0); assert.ok(result.issues.includes('historical_pricing_validation_failed'));
    assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingMarkets').get().n, 0);
  } finally { f.close(); }
});
