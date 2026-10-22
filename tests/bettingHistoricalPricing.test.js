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
import {readCachedHistoricalPricing} from '../betting/cachedPricing.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import Database from 'better-sqlite3';

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
    f.league.exec('DELETE FROM ScheduledEvents WHERE SeasonId=2');
    const result = runBetting({ ...f, now, seasonId: 2, simulations: 100, historicalInputBuilder: f.builder });
    assert.ok(result.marketsOpened > 100); assert.deepEqual(result.issues, []);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='BettingLocalTestMetadata'").get().n, 0);
    const forecast = f.betting.prepare('SELECT ModelVersion,ValidationJson FROM BettingForecasts ORDER BY ForecastId DESC LIMIT 1').get();
    assert.equal(forecast.ModelVersion, 'historical-roster-v1');
    assert.equal(JSON.parse(forecast.ValidationJson).validated, true);
    const market = f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_player' LIMIT 1").get();
    assert.ok(market); assert.equal(JSON.parse(market.RulesJson).localTesting, undefined);
    assert.equal(market.CloseAtUtc, '');
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

test('fixture source guards retain freshness checks while generated preseason prices keep their approved inputs', async () => {
  const f = coldStart(), scratch = mkdtempSync(join(tmpdir(), 'lads-historical-guards-'));
  try {
    runBetting({ ...f, now, seasonId: 2, simulations: 100, historicalInputBuilder: f.builder });
    const market = f.betting.prepare("SELECT * FROM BettingMarkets WHERE MarketType='season_team' LIMIT 1").get();
    const fixture = f.betting.prepare("SELECT * FROM BettingMarkets WHERE MarketType='series_winner' LIMIT 1").get();
    const path = join(scratch, 'Analytics.db'); await f.analytics.backup(path);
    const shared = {};
    assert.equal(seasonGuard(f.league, path, 2, market, now, shared), null);
    const ordinary = { ...fixture, RulesJson: JSON.stringify({ ...JSON.parse(fixture.RulesJson), historicalPricing: undefined }) };
    assert.match(seasonGuard(f.league, path, 2, ordinary, now, shared), /source data needs refreshing/);
    f.league.exec("CREATE TABLE MatchSourceDetails(MatchId INTEGER PRIMARY KEY,ObservedAtUtc TEXT); INSERT INTO MatchSourceDetails VALUES(1,'2026-10-13T12:00:01Z');");
    assert.match(seasonGuard(f.league, path, 2, fixture, now), /historical inputs/);
    assert.equal(seasonGuard(f.league, path, 2, market, now),null);
    f.league.exec('DROP TABLE MatchSourceDetails; UPDATE SeasonTeams SET GroupId=5 WHERE TeamSubmissionId=21;');
    assert.match(seasonGuard(f.league, path, 2, market, now), /setup changed/);
    f.league.exec('UPDATE SeasonTeams SET GroupId=2 WHERE TeamSubmissionId=21;');
    const future = { ...fixture, UpdatedAtUtc: '2026-10-20T12:00:00Z' };
    f.league.prepare('UPDATE ScheduledEvents SET ScheduledStartUtc=?').run('2026-10-25T00:00:00Z');
    assert.match(seasonGuard(f.league, path, 2, future, new Date('2026-10-20T12:00:00Z')), /inputs need refreshing/);
    assert.equal(seasonGuard(f.league, path, 2, market, new Date('2026-10-20T12:00:00Z')),null);
  } finally {
    f.close(); if (dirname(resolve(scratch)) !== resolve(tmpdir())) throw Error('Unexpected cleanup target');
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('routine scheduling reuses approved historical inputs, recovers preseason locks and leaves its prices and accepted tickets unchanged',async()=>{
  const f=coldStart(),scratch=mkdtempSync(join(tmpdir(),'lads-fixed-preseason-'));
  try {
    runBetting({...f,now,seasonId:2,simulations:100,historicalInputBuilder:f.builder});
    const market=f.betting.prepare("SELECT * FROM BettingMarkets WHERE MarketType='season_team' LIMIT 1").get();
    const selection=f.betting.prepare('SELECT SelectionId FROM BettingSelections WHERE MarketId=? LIMIT 1').get(market.MarketId);
    f.book.accept('99',{seasonId:2,stake:100,requestKey:'fixed_preseason_before',legs:[{selectionId:selection.SelectionId,quoteVersion:market.QuoteVersion}]});
    const prices=()=>f.betting.prepare(`SELECT s.* FROM BettingSelections s JOIN BettingMarkets m USING(MarketId)
      WHERE m.SeasonId=2 AND m.EventId IS NULL ORDER BY SelectionId`).all();
    const originals=prices(),tickets=f.betting.prepare('SELECT * FROM BettingTicketLegs').all();
    const originalMarkets=f.betting.prepare('SELECT MarketId,Line,ForecastId,UpdatedAtUtc FROM BettingMarkets WHERE SeasonId=2 AND EventId IS NULL ORDER BY MarketId').all();
    f.betting.prepare("UPDATE BettingMarkets SET Status='locked' WHERE SeasonId=2 AND EventId IS NULL").run();
    const later=new Date(now.getTime()+60000);f.book.now=()=>later;
    f.analytics.prepare('UPDATE AnalyticsRuns SET AsOfUtc=?').run(later.toISOString());
    f.league.exec('UPDATE BettingRefreshState SET RequestedRevision=RequestedRevision+1');
    const event=f.schedules.save(2,{team1Key:23,team2Key:24,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-18T01:00:00Z'},'1',later);
    let cachedCalls=0;
    const builder=inputs=>{cachedCalls++;const value=readCachedHistoricalPricing(f.book,f.league,inputs.season.SeasonId,f.schedules.setup(2));assert.ok(value);return value;};
    runBetting({...f,now:later,seasonId:2,simulations:100,preservePreseason:true,historicalInputBuilder:builder});
    assert.equal(cachedCalls,1);
    assert.deepEqual(prices(),originals);
    assert.deepEqual(f.betting.prepare('SELECT * FROM BettingTicketLegs').all(),tickets);
    assert.deepEqual(f.betting.prepare('SELECT MarketId,Line,ForecastId,UpdatedAtUtc FROM BettingMarkets WHERE SeasonId=2 AND EventId IS NULL ORDER BY MarketId').all(),originalMarkets);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE SeasonId=2 AND EventId IS NULL AND Status!='open'").get().n,0);
    assert.ok(f.betting.prepare("SELECT 1 FROM BettingMarkets WHERE EventId=? AND Status='open'").get(event.EventId));
    const newest=f.betting.prepare('SELECT ForecastJson FROM BettingForecasts ORDER BY ForecastId DESC LIMIT 1').get();
    assert.ok(JSON.parse(newest.ForecastJson).markets.every(m=>m.definition.eventId));
    const path=join(scratch,'Analytics.db');await f.analytics.backup(path);
    const reopened=f.betting.prepare('SELECT * FROM BettingMarkets WHERE MarketId=?').get(market.MarketId);
    assert.equal(seasonGuard(f.league,path,2,reopened,later),null);
    f.book.seasonGuard=(sid,m)=>seasonGuard(f.league,path,sid,m,later);
    const placed=f.book.accept('99',{seasonId:2,stake:100,requestKey:'fixed_preseason_after',legs:[{selectionId:selection.SelectionId,quoteVersion:reopened.QuoteVersion}]});
    assert.ok(placed.ticketId);
    // Real play still closes the fixed book, even if its old locks were repaired.
    f.league.prepare("UPDATE ScheduledEvents SET Status='started' WHERE EventId=?").run(event.EventId);
    runBetting({...f,now:later,seasonId:2,simulations:100,preservePreseason:true,historicalInputBuilder:builder});
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE SeasonId=2 AND EventId IS NULL AND Status!='locked'").get().n,0);
    assert.match(seasonGuard(f.league,path,2,reopened,later),/Preseason betting is closed/);
  }finally{f.close();if(dirname(resolve(scratch))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');rmSync(scratch,{recursive:true,force:true});}
});

test('saved historical matchup inputs reject source, setup or validation changes without reconstructing history',()=>{
  const f=coldStart();
  try {
    runBetting({...f,now,seasonId:2,simulations:100,historicalInputBuilder:f.builder});
    const setup=f.schedules.setup(2);
    assert.ok(readCachedHistoricalPricing(f.book,f.league,2,setup));
    assert.equal(readCachedHistoricalPricing(f.book,f.league,2,{...setup,SetupJson:'{}'}),null);
    f.league.exec("CREATE TABLE MatchSourceDetails(MatchId INTEGER PRIMARY KEY,ObservedAtUtc TEXT); INSERT INTO MatchSourceDetails VALUES(1,'2026-10-13T12:00:01Z');");
    assert.equal(readCachedHistoricalPricing(f.book,f.league,2,setup),null);
    f.league.exec('DROP TABLE MatchSourceDetails');
    f.betting.exec("UPDATE BettingForecasts SET ValidationJson='{\"validated\":false}'");
    assert.equal(readCachedHistoricalPricing(f.book,f.league,2,setup),null);
  }finally{f.close();}
});

for(const withUpcoming of [true,false])test(`scheduled refresh saves reusable matchup inputs ${withUpcoming?'with':'without'} an upcoming fixture and preserves preseason prices`,()=>{
  const f=coldStart();
  try {
    if(!withUpcoming)f.league.exec('DELETE FROM ScheduledEvents WHERE SeasonId=2');
    runBetting({...f,now,seasonId:2,simulations:100,historicalInputBuilder:f.builder});
    const preseason=()=>f.betting.prepare(`SELECT MarketId,Line,ForecastId FROM BettingMarkets
      WHERE SeasonId=2 AND EventId IS NULL ORDER BY MarketId`).all();
    const prices=()=>f.betting.prepare(`SELECT s.* FROM BettingSelections s JOIN BettingMarkets m USING(MarketId)
      WHERE m.SeasonId=2 AND m.EventId IS NULL ORDER BY SelectionId`).all();
    const originalMarkets=preseason(),originalPrices=prices(),setup=f.schedules.setup(2);
    f.league.exec("CREATE TABLE MatchSourceDetails(MatchId INTEGER PRIMARY KEY,ObservedAtUtc TEXT); INSERT INTO MatchSourceDetails VALUES(1,'2026-10-13T12:00:01Z');");
    assert.equal(readCachedHistoricalPricing(f.book,f.league,2,setup),null);
    let builds=0;
    const refreshed=runBetting({...f,now,seasonId:2,simulations:100,preservePreseason:true,refreshSavedInputs:true,
      historicalInputBuilder:(inputs,at)=>{builds++;return f.builder(inputs,at);}});
    assert.equal(builds,1);
    assert.deepEqual(refreshed.issues,[]);
    const cached=readCachedHistoricalPricing(f.book,f.league,2,setup);
    assert.ok(cached,'The scheduled refresh must replace stale cached matchup inputs');
    assert.equal(cached.sourceFingerprint,historicalSourceFingerprint(f.league));
    assert.deepEqual(preseason(),originalMarkets);assert.deepEqual(prices(),originalPrices);
    if(!withUpcoming)assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingMarkets WHERE EventId IS NOT NULL').get().n,0);
    const event=f.schedules.save(2,{team1Key:23,team2Key:24,stage:'regular',bestOf:2,
      scheduledStartUtc:'2026-10-18T01:00:00Z'},'1',now);
    const routine=runBetting({...f,now,seasonId:2,simulations:100,preservePreseason:true,
      historicalInputBuilder:()=>{
        const saved=readCachedHistoricalPricing(f.book,f.league,2,setup);
        assert.ok(saved);return saved;
      }});
    assert.deepEqual(routine.issues,[]);
    assert.ok(f.betting.prepare("SELECT 1 FROM BettingMarkets WHERE EventId=? AND Status='open'").get(event.EventId));
    assert.deepEqual(preseason(),originalMarkets);assert.deepEqual(prices(),originalPrices);
  }finally{f.close();}
});

test('the routine CLI repairs the preseason book and prices a new matchup under a bounded heap without rebuilding Analytics',async t=>{
  const f=coldStart(),scratch=mkdtempSync(join(tmpdir(),'lads-cached-pricing-worker-'));let betting,analytics;
  try {
    runBetting({...f,now,seasonId:2,simulations:100,historicalInputBuilder:f.builder});
    f.league.exec("UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=1");
    const prices=f.betting.prepare(`SELECT s.* FROM BettingSelections s JOIN BettingMarkets m USING(MarketId)
      WHERE m.SeasonId=2 AND m.EventId IS NULL ORDER BY SelectionId`).all();
    const current=new Date();
    f.analytics.prepare('UPDATE AnalyticsRuns SET AsOfUtc=?').run(new Date(current.getTime()-1000).toISOString());
    f.league.prepare('UPDATE ScheduledEvents SET ScheduledStartUtc=?').run(new Date(current.getTime()+86400000).toISOString());
    const event=f.schedules.save(2,{team1Key:23,team2Key:24,stage:'regular',bestOf:2,
      scheduledStartUtc:new Date(current.getTime()+2*86400000).toISOString()},'1',current);
    f.betting.exec("UPDATE BettingMarkets SET Status='locked' WHERE SeasonId=2 AND EventId IS NULL");
    const paths={league:join(scratch,'LadsData.db'),analytics:join(scratch,'Analytics.db'),betting:join(scratch,'Betting.db')};
    await f.league.backup(paths.league);await f.analytics.backup(paths.analytics);await f.betting.backup(paths.betting);
    const {stdout}=await promisify(execFile)(process.execPath,['--max-old-space-size=256','scripts/betting/run.js',
      '--league-db',paths.league,'--analytics-db',paths.analytics,'--betting-db',paths.betting],
      {windowsHide:true,env:{...process.env,BETTING_LOCAL_TEST_MODE:'false'}});
    const result=JSON.parse(stdout);assert.deepEqual(result.issues,[]);
    betting=new Database(paths.betting,{readonly:true});analytics=new Database(paths.analytics,{readonly:true});
    assert.equal(analytics.prepare('SELECT COUNT(*) n FROM AnalyticsRuns').get().n,1);
    assert.equal(betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE SeasonId=2 AND EventId IS NULL AND Status!='open'").get().n,0);
    assert.ok(betting.prepare("SELECT 1 FROM BettingMarkets WHERE EventId=? AND Status='open'").get(event.EventId));
    assert.deepEqual(betting.prepare(`SELECT s.* FROM BettingSelections s JOIN BettingMarkets m USING(MarketId)
      WHERE m.SeasonId=2 AND m.EventId IS NULL ORDER BY SelectionId`).all(),prices);
    t.diagnostic(JSON.stringify({peakRssMB:Math.round(result.resources.peakRssBytes/1048576),heapMB:Math.round(result.resources.heapUsedBytes/1048576),
      elapsedMs:result.resources.elapsedMs,note:'Isolated saved-history fixture; not a production-host memory guarantee.'}));
  }finally{betting?.close();analytics?.close();f.close();if(dirname(resolve(scratch))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');rmSync(scratch,{recursive:true,force:true});}
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
