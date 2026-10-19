import test from 'node:test';
import assert from 'node:assert/strict';
import { preseasonFixture } from './helpers/bettingFixture.js';
import { runBetting, settleSeason, settleOperationalChanges } from '../betting/engine.js';
import { readSeasonBettingInputs } from '../analytics/bettingInputs.js';
import { seededRandom, simulateSeason, seasonWinsForecast } from '../betting/models.js';
const now = new Date('2026-10-13T12:00:00Z'), endedAt = new Date('2026-10-22T12:00:00Z');
const winMarket = (f, team = 21) => f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_team' AND TeamKey=? ORDER BY MarketId DESC LIMIT 1").get(team);
function accept(f, market, key = 'team_wins') {
  const q = f.betting.prepare("SELECT SelectionId,OfferedMicros FROM BettingSelections WHERE MarketId=? AND OutcomeKey='over'").get(market.MarketId);
  return { ...f.book.accept('99', { seasonId: 2, stake: 100, requestKey: key,
    legs: [{ selectionId: q.SelectionId, quoteVersion: market.QuoteVersion }] }), quote: q.OfferedMicros };
}
function complete(f) {
  const teams = f.schedules.teams(2); let match = 1000;
  for (const group of [...new Set(teams.map(t => t.GroupId))]) {
    const entries = teams.filter(t => t.GroupId === group);
    for (let a = 0; a < entries.length; a++) for (let b = a + 1; b < entries.length; b++) for (let game = 0; game < 2; game++, match++) {
      const left = entries[a], right = entries[b], started = new Date(Date.parse('2026-10-17T01:00:00Z') + (match - 1000) * 3600000).toISOString();
      f.analytics.prepare(`INSERT INTO MatchFacts(RunId,MatchId,SeasonId,LeagueId,Stage,StartedAtUtc,RecordedDate,TimeSource,DurationSeconds,WinnerTeamId,SourceObservedAtUtc)
        VALUES(1,?,2,200,'regular',?,?,'api',2000,?,?)`).run(match, started, started, left.ExternalTeamId, started);
      f.analytics.prepare("INSERT INTO TeamGameFacts VALUES(1,?,?,?,?,1,'radiant')").run(match, left.TeamSubmissionId, right.TeamSubmissionId, left.ExternalTeamId);
      f.analytics.prepare("INSERT INTO TeamGameFacts VALUES(1,?,?,?,?,0,'dire')").run(match, right.TeamSubmissionId, left.TeamSubmissionId, right.ExternalTeamId);
    }
  }
  f.analytics.exec(`INSERT INTO TeamSeasonStats SELECT 1,2,TeamSubmissionId,'regular',COUNT(*),SUM(Won),COUNT(*)-SUM(Won)
    FROM TeamGameFacts WHERE MatchId>=1000 GROUP BY TeamSubmissionId;
    INSERT INTO TeamSeasonStats VALUES(1,2,21,'playoff',20,20,0);`);
  f.book.now = () => endedAt;
  f.schedules.completion(2, { completion: 'normal', regularSeasonComplete: true }, '1', endedAt);
  f.analytics.prepare('UPDATE AnalyticsRuns SET AsOfUtc=?').run(endedAt.toISOString());
}

test('season-win distributions conserve group game wins and price tails from the same simulations', () => {
  const f = preseasonFixture([4, 5]); try {
    const inputs = readSeasonBettingInputs(f.analytics, 2, now);
    const sim = simulateSeason(inputs, f.schedules.setup(2), seededRandom(123), 200);
    let expectedTotal = 0;
    for (const team of inputs.teams) {
      const counts = sim.regularWins[team.TeamSubmissionId], forecast = seasonWinsForecast(sim, team.TeamSubmissionId);
      assert.equal(counts.reduce((s, n) => s + n, 0), 200);
      assert.equal(forecast.games, team.GroupId === 2 ? 6 : 8);
      assert.ok(forecast.line > 0 && forecast.line < forecast.games);
      assert.equal(forecast.line % 1, .5); assert.equal(forecast.over + forecast.under, 1);
      expectedTotal += forecast.expected;
    }
    assert.ok(Math.abs(expectedTotal - (12 + 20)) < 1e-10);
    const exact = seasonWinsForecast({ samples: 6, regularWins: { 1: [0, 0, 1, 3, 2] } }, 1);
    assert.equal(exact.line, 3.5); assert.equal(exact.over, 3 / 8);
    assert.equal(seasonWinsForecast({ samples: 6, regularWins: { 1: [1] } }, 1), null);
    inputs.season.RulesJson = JSON.stringify({ UpperBracketTeams: 1, LowerBracketTeams: 1, EliminatedTeams: 1, HasTiebreaker: true, TiebreakerPosition: 2 });
    const tied = simulateSeason(inputs, f.schedules.setup(2), seededRandom(123), 100);
    assert.ok(seasonWinsForecast(tied, 21)); assert.equal(tied.champion, null); assert.equal(tied.placement, null);
  } finally { f.close(); }
});

test('published season-win lines remain frozen across repricing and follow each group schedule', () => {
  const f = preseasonFixture([4, 5]); try {
    runBetting({ ...f, seasonId: 2, now, simulations: 100 });
    const first = winMarket(f), larger = winMarket(f, 25);
    assert.equal(JSON.parse(first.RulesJson).regularGames, 6); assert.equal(JSON.parse(larger.RulesJson).regularGames, 8);
    assert.equal(JSON.parse(first.RulesJson).participation, null);
    const ticket = accept(f, first);
    f.analytics.exec('UPDATE PrivateTeamFeatures SET AverageSignupMMR=6800 WHERE TeamSubmissionId=21');
    runBetting({ ...f, seasonId: 2, now, simulations: 100 });
    const repriced = winMarket(f); assert.equal(repriced.MarketId, first.MarketId); assert.equal(repriced.Line, first.Line);
    assert.equal(f.betting.prepare('SELECT AcceptedMicros FROM BettingTicketLegs WHERE TicketId=?').get(ticket.ticketId).AcceptedMicros, ticket.quote);
  } finally { f.close(); }
});

test('regular-season wins settle without player participation, exclude playoffs, and correct idempotently', () => {
  const f = preseasonFixture(); try {
    runBetting({ ...f, seasonId: 2, now, simulations: 100 }); const market = winMarket(f), ticket = accept(f, market);
    complete(f);
    const settle = () => settleSeason(f.book, f.league, readSeasonBettingInputs(f.analytics, 2, endedAt), f.schedules.setup(2), f.schedules.list(2));
    f.analytics.exec("UPDATE TeamSeasonStats SET GamesPlayed=5,Wins=5,Losses=0 WHERE SeasonId=2 AND TeamSubmissionId=21 AND Stage='regular'");
    settle(); assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status, 'pending');
    f.analytics.exec("UPDATE TeamSeasonStats SET GamesPlayed=6,Wins=6,Losses=0 WHERE SeasonId=2 AND TeamSubmissionId=21 AND Stage='regular'");
    settle(); assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status, 'won');
    const evidence = JSON.parse(f.betting.prepare('SELECT EvidenceJson FROM BettingMarketSettlements WHERE MarketId=? ORDER BY Revision DESC LIMIT 1').get(market.MarketId).EvidenceJson);
    assert.equal(evidence.value, 6); assert.equal(evidence.games, 6);
    f.analytics.exec("UPDATE TeamSeasonStats SET Wins=0,Losses=6 WHERE SeasonId=2 AND TeamSubmissionId=21 AND Stage='regular'");
    settle(); assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status, 'lost');
    assert.equal(f.book.wallet(2, '99').balance, 9900);
    const count = f.betting.prepare('SELECT COUNT(*) n FROM BettingLedger').get().n;
    settle(); assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingLedger').get().n, count);
  } finally { f.close(); }
});

test('shortened, canceled and forfeited team schedules refund unresolved season-win tickets', () => {
  for (const kind of ['shortened', 'canceled', 'forfeit']) {
    const f = preseasonFixture(); try {
      runBetting({ ...f, seasonId: 2, now, simulations: 100 }); const market = winMarket(f), ticket = accept(f, market);
      if (kind === 'forfeit') {
        const event = f.schedules.list(2)[0];
        f.schedules.save(2, { eventId: event.EventId, revision: event.Revision, team1Key: event.Team1Key, team2Key: event.Team2Key,
          stage: 'regular', bestOf: 2, scheduledStartUtc: event.ScheduledStartUtc, status: 'forfeit' }, '1', now);
      } else f.schedules.completion(2, { completion: kind, regularSeasonComplete: false }, '1', now);
      settleOperationalChanges(f.book, f.league, 2);
      assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status, 'refunded', kind);
      assert.equal(f.book.wallet(2, '99').balance, 10000);
      assert.equal(f.betting.prepare('SELECT AcceptedMicros FROM BettingTicketLegs WHERE TicketId=?').get(ticket.ticketId).AcceptedMicros, ticket.quote);
    } finally { f.close(); }
  }
});
