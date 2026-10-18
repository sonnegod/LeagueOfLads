import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateAnalytics, safeAnalyticsStatus } from '../analytics/store.js';
import { buildAnalytics } from '../analytics/build.js';
import { readSeasonBettingInputs } from '../analytics/bettingInputs.js';
import { startSourceLoad, finishSourceLoad, ensurePublicAvailability, recordMatchStart } from '../analytics/sourceMetadata.js';
import { ScheduleStore } from '../betting/scheduleStore.js';

const at = new Date('2026-10-13T12:00:00.000Z');

test('effective roster replacements retain earlier membership and classify later appearances against the new roster',()=>{
  const f=fixture();try {
    f.league.exec("ALTER TABLE TeamRosterPlayers ADD COLUMN FinalizedAt TEXT;UPDATE LeagueSeasons SET Status='active' WHERE SeasonId=3;UPDATE TeamRosterPeriods SET EffectiveTo=NULL;");
    const schedules=new ScheduleStore(f.league);
    schedules.changeRoster(3,{playerId:1,fromTeamKey:11,replacementPlayerId:11,effectiveAtUtc:'2026-10-06T00:00:00.000Z',reason:'Permanent replacement',kind:'permanent'},'50',at);
    buildAnalytics({...f,now:at});const run=f.analytics.prepare('SELECT PublishedRunId FROM AnalyticsState').get().PublishedRunId;
    assert.equal(f.analytics.prepare('SELECT Membership FROM PlayerGameFacts WHERE RunId=? AND MatchId=105 AND PlayerId=1').get(run).Membership,'rostered');
    assert.equal(f.analytics.prepare('SELECT Membership FROM PlayerGameFacts WHERE RunId=? AND MatchId=106 AND PlayerId=11').get(run).Membership,'rostered');
    assert.equal(f.analytics.prepare('SELECT EffectiveToUtc FROM RosterMembership WHERE RunId=? AND TeamSubmissionId=11 AND PlayerId=1').get(run).EffectiveToUtc,'2026-10-06T00:00:00.000Z');
    assert.ok(f.analytics.prepare('SELECT COUNT(*) AS n FROM RosterMembershipIntervals WHERE RunId=?').get(run).n>=11);
  }finally{f.league.close();f.analytics.close();f.publicDb.close();}
});

test('authoritative remake classifications exclude superseded attempts and allow verified official rehost records',()=>{
  const f=fixture();try {
    const schedules=new ScheduleStore(f.league);f.league.exec('UPDATE MatchTeam SET Rehost=1 WHERE MatchId=101');
    schedules.classifyMatch(3,{matchId:101,status:'official',reason:'Verified full game'},'50',at);
    buildAnalytics({...f,now:at});let run=f.analytics.prepare('SELECT PublishedRunId FROM AnalyticsState').get().PublishedRunId;
    assert.ok(f.analytics.prepare('SELECT 1 FROM MatchFacts WHERE RunId=? AND MatchId=101').get(run));
    schedules.classifyMatch(3,{matchId:101,status:'superseded',replacementMatchId:102,reason:'Official replay replaces this attempt'},'50',at);
    buildAnalytics({...f,now:at});run=f.analytics.prepare('SELECT PublishedRunId FROM AnalyticsState').get().PublishedRunId;
    assert.equal(f.analytics.prepare('SELECT 1 FROM MatchFacts WHERE RunId=? AND MatchId=101').get(run),undefined);
    assert.ok(f.analytics.prepare('SELECT 1 FROM MatchFacts WHERE RunId=? AND MatchId=102').get(run));
    assert.throws(()=>schedules.classifyMatch(3,{matchId:102,status:'superseded',replacementMatchId:101,reason:'Invalid circular replay'},'50',at));
  }finally{f.league.close();f.analytics.close();f.publicDb.close();}
});

function fixture() {
  const league = new Database(':memory:');
  const analytics = new Database(':memory:');
  analytics.pragma('foreign_keys = ON');
  migrateAnalytics(analytics);
  const publicDb = new Database(':memory:');
  league.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER PRIMARY KEY, ExternalLeagueId INTEGER, LeagueName TEXT,
      Status TEXT, SignupTitle TEXT);
    CREATE TABLE SeasonTeams (TeamSubmissionId INTEGER PRIMARY KEY, SeasonId INTEGER, ExternalTeamId INTEGER,
      TeamName TEXT, GroupId INTEGER, IsManual INTEGER);
    CREATE TABLE SeasonTeamPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER, Slot INTEGER, ScreenshotData BLOB);
    CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY, PlayerName TEXT);
    CREATE TABLE TeamRosterPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER, Slot INTEGER);
    CREATE TABLE TeamRosterPeriods (TeamSubmissionId INTEGER, EffectiveFrom TEXT, EffectiveTo TEXT, FromEstimated INTEGER);
    CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY, LeagueId INTEGER, DatePlayed TEXT);
    CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY, TeamRad INTEGER, TeamDire INTEGER,
      WinnerId INTEGER, Duration INTEGER, Rehost INTEGER DEFAULT 0);
    CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);
    CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, HeroId INTEGER, Kills INTEGER, Deaths INTEGER,
      Assists INTEGER, Lasthits INTEGER, GPM INTEGER, XPM INTEGER, Networth INTEGER, HeroDamage INTEGER,
      TowerDamage INTEGER, Healing INTEGER);
    CREATE TABLE SeriesInfo (SeriesId INTEGER, Stage TEXT, Team1 INTEGER, Team2 INTEGER, LeagueId INTEGER);
    CREATE TABLE SeriesMatch (SeriesId INTEGER, MatchId INTEGER);
    CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER, GroupEndMatchId INTEGER, TieBreakerEndMatchId INTEGER);
    INSERT INTO LeagueSeasons VALUES (1, 99, 'Imported legacy', 'ended', NULL), (3, 100, 'Signup era', 'ended', 'Signups');
    INSERT INTO SeasonTeams VALUES (11, 3, 1001, 'Team A', 1, 0), (12, 3, 1002, 'Team B', 1, 0);
    INSERT INTO TeamRosterPeriods VALUES (11, '2026-10-01T00:00:00.000Z', '2026-10-13T00:00:00.000Z', 0),
      (12, '2026-10-01T00:00:00.000Z', '2026-10-13T00:00:00.000Z', 0);
    INSERT INTO LeagueStageBoundaries VALUES (100, 110, 110);
    INSERT INTO MatchLeague VALUES (1, 99, '2026-09-01');
    INSERT INTO MatchTeam VALUES (1, 1001, 1002, 1001, 2000, 0);`);
  for (let id = 1; id <= 12; id += 1) {
    league.prepare('INSERT INTO PlayerInfo VALUES (?, ?)').run(id, `Player ${id}`);
    if (id <= 10) {
      const team = id <= 5 ? 11 : 12;
      const slot = (id - 1) % 5;
      league.prepare('INSERT INTO TeamRosterPlayers VALUES (?, ?, ?)').run(team, id, slot);
      league.prepare('INSERT INTO SeasonTeamPlayers VALUES (?, ?, ?, ?)').run(team, id, slot, Buffer.from('PRIVATE_SCREENSHOT'));
    }
  }
  for (let game = 1; game <= 12; game += 1) {
    const match = 100 + game;
    const day = `2026-10-${String(game).padStart(2, '0')}T12:00:00.000Z`;
    league.prepare('INSERT INTO MatchLeague VALUES (?, 100, ?)').run(match, day);
    league.prepare('INSERT INTO MatchTeam VALUES (?, 1001, 1002, 1001, 2400, 0)').run(match);
    league.prepare('INSERT INTO SeriesInfo VALUES (?, ?, 1001, 1002, 100)').run(game, game <= 10 ? 'g' : 'p');
    league.prepare('INSERT INTO SeriesMatch VALUES (?, ?)').run(game, match);
    const players = [game <= 5 ? 1 : 11, game <= 4 ? 2 : 12, 3, 4, 5, 6, 7, 8, 9, 10];
    for (let index = 0; index < players.length; index += 1) {
      const id = players[index];
      league.prepare('INSERT INTO MatchTeamPlayer VALUES (?, ?, ?)').run(match, id, index < 5 ? 1001 : 1002);
      league.prepare('INSERT INTO MatchPlayer VALUES (?, ?, 1, ?, 2, 5, 200, ?, 600, 10000, 20000, 1000, ?)')
        .run(match, id, game, 400 + game, id === 3 && game === 1 ? null : 100);
    }
  }
  // Identical duplicate assignment/stat rows must not double count games.
  league.exec(`INSERT INTO MatchTeamPlayer SELECT * FROM MatchTeamPlayer WHERE MatchId = 101 AND PlayerId = 3;
    INSERT INTO MatchPlayer SELECT * FROM MatchPlayer WHERE MatchId = 101 AND PlayerId = 3;`);
  for (const source of ['match_history', 'match_details']) {
    finishSourceLoad(league, startSourceLoad(league, source, '2026-10-13T10:00:00.000Z'), { at: '2026-10-13T10:01:00.000Z' });
  }
  publicDb.exec(`CREATE TABLE PublicMatchPlayer (MatchId INTEGER, PlayerId INTEGER, Won INTEGER,
    Kills INTEGER, Deaths INTEGER, Assists INTEGER, DateCreated TEXT);`);
  ensurePublicAvailability(publicDb);
  for (let match = 1; match <= 6; match += 1) {
    publicDb.prepare('INSERT INTO PublicMatchPlayer VALUES (?, 3, 1, 777, 2, 3, ?)').run(match, '2026-10-01T12:00:00.000Z');
    publicDb.prepare('INSERT INTO PublicMatchAvailability VALUES (?, 3, ?)').run(match, '2026-10-02T12:00:00.000Z');
  }
  publicDb.exec(`INSERT INTO PublicMatchPlayer VALUES
    (7, 3, 1, 777, 2, 3, '2026-01-01T12:00:00.000Z'),
    (8, 3, 1, 777, 2, 3, '2026-10-14T12:00:00.000Z'),
    (9, 3, 1, 777, 2, 3, '2026-10-01T12:00:00.000Z'),
    (10, 3, 1, 777, 2, 3, '2026-10-01T12:00:00.000Z');
    INSERT INTO PublicMatchAvailability VALUES
    (7, 3, '2026-10-02T12:00:00.000Z'), (8, 3, '2026-10-02T12:00:00.000Z'),
    (9, 3, '2026-10-14T12:00:00.000Z');`);
  finishSourceLoad(publicDb, startSourceLoad(publicDb, 'public_matches', '2026-10-13T10:00:00.000Z'), { at: '2026-10-13T10:01:00.000Z' });
  return { analytics, league, publicDb, now: at, close() { analytics.close(); league.close(); publicDb.close(); } };
}

test('signup-era facts partition roster/stand-in/stage, deduplicate joins, and preserve metric denominators', () => {
  const f = fixture();
  try {
    const { runId } = buildAnalytics(f);
    assert.equal(f.analytics.prepare('SELECT FirstSeasonId FROM AnalyticsRuns').get().FirstSeasonId, 3);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM MatchFacts').get().n, 12);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM PlayerGameFacts').get().n, 120);
    assert.equal(f.analytics.prepare("SELECT COUNT(*) AS n FROM MatchFacts WHERE Stage = 'playoff'").get().n, 2);
    const stat = f.analytics.prepare(`SELECT * FROM PlayerTeamSeasonStats
      WHERE RunId = ? AND PlayerId = ? AND Stage = 'regular'`);
    assert.equal(stat.get(runId, 1).MarketEligible, 0); // 5 games but exactly 50%.
    assert.equal(stat.get(runId, 2).MarketEligible, 0); // Fewer than 5.
    assert.equal(stat.get(runId, 3).MarketEligible, 1);
    assert.equal(stat.get(runId, 11).Membership, 'stand_in');
    assert.equal(stat.get(runId, 11).MarketEligible, 0);
    const healing = f.analytics.prepare("SELECT Samples, Total, Average FROM PlayerMetricStats WHERE PlayerId = 3 AND Stage = 'regular' AND Metric = 'Healing'").get();
    assert.deepEqual(healing, { Samples: 9, Total: 900, Average: 100 });
    assert.equal(f.analytics.prepare("SELECT Total FROM PlayerMetricStats WHERE PlayerId = 3 AND Stage = 'regular' AND Metric = 'Kills'").get().Total, 55);
  } finally { f.close(); }
});

test('only time-available public samples within 90 days enter private features, never safe status', () => {
  const f = fixture();
  try {
    buildAnalytics(f);
    const features = f.analytics.prepare('SELECT * FROM PrivatePlayerFeatures WHERE PlayerId = 3').get();
    assert.equal(features.SampleCount, 6);
    assert.equal(features.AverageKills, 777);
    assert.equal(features.QualityStatus, 'ready');
    const payload = JSON.stringify(safeAnalyticsStatus(f.analytics, at));
    for (const forbidden of ['AverageKills', 'ScreenshotData', 'PRIVATE_SCREENSHOT', 'PrivatePlayerFeatures', 'Elo', 'SignupMMR']) {
      assert.equal(payload.includes(forbidden), false);
    }
    assert.equal(f.analytics.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('Markets', 'ForecastRuns', 'BettingOptions')").get().n, 0);
  } finally { f.close(); }
});

test('failure leaves previous publication intact and stores no private exception text', () => {
  const f = fixture();
  try {
    const first = buildAnalytics(f).runId;
    assert.throws(() => buildAnalytics({ ...f, beforePublish() { throw new Error('PRIVATE_DETAILS'); } }), /PRIVATE_DETAILS/);
    assert.equal(f.analytics.prepare('SELECT PublishedRunId FROM AnalyticsState').get().PublishedRunId, first);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM MatchFacts').get().n, 12);
    const status = safeAnalyticsStatus(f.analytics, at);
    assert.equal(status.latest.status, 'failed');
    assert.equal(JSON.stringify(status).includes('PRIVATE_DETAILS'), false);
    assert.equal(status.running, false);
  } finally { f.close(); }
});

test('reruns retain two generations and source freshness does not advance with rebuilds', () => {
  const f = fixture();
  try {
    buildAnalytics(f); buildAnalytics(f); buildAnalytics(f);
    assert.equal(f.analytics.prepare('SELECT COUNT(DISTINCT RunId) AS n FROM MatchFacts').get().n, 2);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM MatchFacts').get().n, 24);
    assert.equal(safeAnalyticsStatus(f.analytics, new Date('2026-10-16T12:00:00.000Z')).sources.every(s => s.stale), true);
    const later = buildAnalytics({ ...f, now: new Date('2026-10-16T12:00:00.000Z') });
    assert.equal(f.analytics.prepare('SELECT QualityStatus FROM PrivatePlayerFeatures WHERE RunId = ? AND PlayerId = 3').get(later.runId).QualityStatus, 'stale');
  } finally { f.close(); }
});

test('an active build lock prevents overlapping publication', () => {
  const f = fixture();
  try {
    f.analytics.prepare('INSERT INTO AnalyticsBuildLock VALUES (1, ?, ?)').run('another-job', '2026-10-14T12:00:00.000Z');
    assert.throws(() => buildAnalytics(f), { code: 'ANALYTICS_BUILD_BUSY' });
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM AnalyticsRuns').get().n, 0);
  } finally { f.close(); }
});

test('unmapped teams, conflicting assignments, and uncertain effective periods stay out of eligible stats', () => {
  const f = fixture();
  try {
    f.league.prepare('UPDATE MatchTeam SET TeamDire = 9999 WHERE MatchId = 101').run();
    f.league.prepare('INSERT INTO MatchTeamPlayer VALUES (102, 3, 1002)').run();
    f.league.prepare('UPDATE TeamRosterPeriods SET FromEstimated = 1 WHERE TeamSubmissionId = 11').run();
    buildAnalytics(f);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM MatchFacts').get().n, 10);
    assert.equal(f.analytics.prepare("SELECT COUNT(*) AS n FROM PlayerGameFacts WHERE TeamSubmissionId = 11 AND Membership != 'unknown'").get().n, 0);
    const codes = safeAnalyticsStatus(f.analytics, at).issues.map(i => i.code);
    assert.ok(codes.includes('unmapped_match_team'));
    assert.ok(codes.includes('invalid_player_assignments'));
  } finally { f.close(); }
});

test('partial source loads preserve last successful watermark and API match times persist without host timezone assumptions', () => {
  const f = fixture();
  try {
    finishSourceLoad(f.publicDb, startSourceLoad(f.publicDb, 'public_matches', '2026-10-13T11:00:00.000Z'),
      { failures: 1, at: '2026-10-13T11:01:00.000Z' });
    assert.equal(recordMatchStart(f.league, 101, null, 'test'), false);
    const expected = '2026-10-01T12:00:00.000Z';
    assert.equal(recordMatchStart(f.league, 101, Date.parse(expected) / 1000, 'test'), true);
    assert.equal(f.league.prepare('SELECT DatePlayed FROM MatchLeague WHERE MatchId = 101').get().DatePlayed, expected);
    buildAnalytics(f);
    const source = safeAnalyticsStatus(f.analytics, at).sources.find(s => s.name === 'public_matches');
    assert.equal(source.status, 'partial');
    assert.equal(source.lastSuccessAt, '2026-10-13T10:01:00.000Z');
    assert.equal(f.analytics.prepare('SELECT QualityStatus FROM PrivatePlayerFeatures WHERE PlayerId = 3').get().QualityStatus, 'partial_source');
  } finally { f.close(); }
});

test('private roster/team inputs use frozen signup MMR and supplied manual averages, without exposing them', () => {
  const f = fixture();
  try {
    f.league.exec(`ALTER TABLE SeasonTeamPlayers ADD COLUMN MMR INTEGER;
      UPDATE SeasonTeamPlayers SET MMR = 9999;
      ALTER TABLE SeasonTeams ADD COLUMN ManualAverageMMR INTEGER;
      INSERT INTO SeasonTeams VALUES (13, 3, NULL, 'Manual', 1, 1, 9801);
      CREATE TABLE SignupMMRs (TeamSubmissionId INTEGER, PlayerId INTEGER, SignupMMR INTEGER);`);
    for (let id = 1; id <= 10; id += 1) {
      f.league.prepare('INSERT INTO SignupMMRs VALUES (?, ?, ?)').run(id <= 5 ? 11 : 12, id, 6000 + ((id - 1) % 5) * 100);
    }
    buildAnalytics(f);
    assert.equal(f.analytics.prepare('SELECT SignupMMR FROM PrivateRosterInputs WHERE PlayerId = 1').get().SignupMMR, 6000);
    assert.equal(f.analytics.prepare('SELECT AverageSignupMMR FROM PrivateTeamFeatures WHERE TeamSubmissionId = 11').get().AverageSignupMMR, 6200);
    assert.deepEqual(f.analytics.prepare('SELECT AverageSignupMMR, QualityStatus FROM PrivateTeamFeatures WHERE TeamSubmissionId = 13').get(),
      { AverageSignupMMR: 9801, QualityStatus: 'manual_input' });
    const payload = JSON.stringify(safeAnalyticsStatus(f.analytics, at));
    assert.equal(payload.includes('AverageSignupMMR'), false);
    assert.equal(payload.includes('SignupMMR'), false);
  } finally { f.close(); }
});

test('server-only Betting contract pins a generation and distinguishes participation from metric completeness', () => {
  const f = fixture();
  try {
    assert.equal(readSeasonBettingInputs(f.analytics, 3), null);
    const first = buildAnalytics(f).runId;
    const input = readSeasonBettingInputs(f.analytics, 3, at);
    assert.equal(input.analyticsRunId, first);
    assert.equal(input.privatePlayerFeatures.find(p => p.PlayerId === 3).AverageKills, 777);
    const metric = input.playerStats.find(p => p.PlayerId === 3 && p.Stage === 'regular' && p.Metric === 'Healing');
    assert.equal(metric.MarketEligible, 1);
    assert.equal(metric.MetricComplete, 0); // A missing game stat must hold this metric's settlement.
    assert.equal(input.playerStats.find(p => p.Metric === 'GPM').AllowsSeasonTotal, 0);
    assert.equal(input.playerStats.find(p => p.Metric === 'NetWorth').AllowsSeasonAverage, 0);
    assert.equal(readSeasonBettingInputs(f.analytics, 1), null); // Imported legacy league.
    assert.throws(() => readSeasonBettingInputs(f.analytics, '3 OR 1=1'), /Invalid season/);
  } finally { f.close(); }
});

test('active group alignment and live league rules override stale signup setup', () => {
  const f = fixture();
  try {
    f.league.exec(`CREATE TABLE LeagueRosterEntries (EntryId INTEGER PRIMARY KEY, LeagueId INTEGER,
      TeamSubmissionId INTEGER, TeamId INTEGER, GroupId INTEGER, DisplayName TEXT);
      INSERT INTO LeagueRosterEntries VALUES (1, 100, 12, 1002, 1, 'Team B');
      CREATE TABLE LeagueRules (LeagueId INTEGER, UpperBracketTeams INTEGER, LowerBracketTeams INTEGER,
        EliminatedTeams INTEGER, HasTiebreaker INTEGER, TiebreakerPosition INTEGER);
      INSERT INTO LeagueRules VALUES (100, 1, 1, 0, 0, NULL);`);
    const runId = buildAnalytics(f).runId;
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM MatchFacts').get().n, 0);
    assert.equal(JSON.parse(f.analytics.prepare('SELECT RulesJson FROM SeasonFacts WHERE RunId = ?').get(runId).RulesJson).UpperBracketTeams, 1);
    assert.ok(safeAnalyticsStatus(f.analytics, at).issues.some(i => i.code === 'unmapped_match_team'));
  } finally { f.close(); }
});

test('legacy seasons imported after the signup cutoff stay outside the normal dataset', () => {
  const f = fixture();
  try {
    f.league.exec("INSERT INTO LeagueSeasons VALUES(4,98,'Late imported legacy','ended',NULL)");
    buildAnalytics(f);
    assert.deepEqual(f.analytics.prepare('SELECT SeasonId FROM SeasonFacts').all(), [{ SeasonId: 3 }]);
  } finally { f.close(); }
});

test('league matches observed after the build cutoff are excluded even when their game time is earlier', () => {
  const f = fixture();
  try {
    recordMatchStart(f.league, 101, Date.parse('2026-10-01T12:00:00Z') / 1000,
      'test', '2026-10-14T00:00:00.000Z');
    buildAnalytics(f);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM MatchFacts').get().n, 11);
    assert.ok(safeAnalyticsStatus(f.analytics, at).issues.some(issue => issue.code === 'match_not_available_as_of'));
  } finally { f.close(); }
});

test('duplicate signup membership remains unresolved instead of making two actual team records eligible', () => {
  const f = fixture();
  try {
    f.league.prepare('INSERT INTO TeamRosterPlayers VALUES (12, 3, 5)').run();
    buildAnalytics(f);
    assert.equal(f.analytics.prepare(`SELECT COUNT(*) AS n FROM PlayerGameFacts
      WHERE PlayerId = 3 AND Membership != 'unknown'`).get().n, 0);
    assert.equal(f.analytics.prepare(`SELECT COUNT(*) AS n FROM PrivateTeamFeatures
      WHERE QualityStatus = 'conflicting_roster'`).get().n, 2);
    assert.ok(safeAnalyticsStatus(f.analytics, at).issues.some(issue => issue.code === 'ambiguous_player_roster'));
  } finally { f.close(); }
});

test('an ended signup season can be selected while another season is active', () => {
  const f = fixture();
  try {
    f.league.exec("INSERT INTO LeagueSeasons VALUES (4, 999, 'Active test', 'active', 'Test signup')");
    buildAnalytics({ ...f, seasonId: 3 });
    assert.deepEqual(f.analytics.prepare('SELECT SeasonId FROM SeasonFacts').all(), [{ SeasonId: 3 }]);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM MatchFacts').get().n, 12);
    assert.equal(f.league.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId = 4').get().Status, 'active');
    assert.deepEqual(safeAnalyticsStatus(f.analytics, at).scope, { mode: 'season', seasonId: 3, leagueId: null });
    assert.throws(() => buildAnalytics({ ...f, seasonId: 1 }), /predates signups/);
  } finally { f.close(); }
});

test('historical preview uses real league games with unknown membership and cannot feed Betting', () => {
  const f = fixture();
  try {
    f.league.exec(`CREATE TABLE LeagueInfo (LeagueId INTEGER, LeagueName TEXT, Active INTEGER);
      INSERT INTO LeagueInfo VALUES (100, 'Real completed league', 0), (20285, 'Active test', 1);
      CREATE TABLE LeagueGroups (LeagueId INTEGER, TeamId INTEGER, GroupId INTEGER);
      INSERT INTO LeagueGroups VALUES (100, 1001, 1), (100, 1002, 1);
      CREATE TABLE LeagueRosterEntries (EntryId INTEGER, LeagueId INTEGER, TeamId INTEGER,
        GroupId INTEGER, DisplayName TEXT);
      INSERT INTO LeagueRosterEntries VALUES (1, 100, 1001, 1, 'Updated team name');`);
    const source = f.league.prepare('SELECT * FROM LeagueInfo ORDER BY LeagueId').all();
    buildAnalytics({ ...f, previewLeagueId: 100 });
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM MatchFacts').get().n, 12);
    assert.equal(f.analytics.prepare("SELECT COUNT(*) AS n FROM PlayerGameFacts WHERE Membership != 'unknown'").get().n, 0);
    assert.equal(f.analytics.prepare('SELECT SUM(MarketEligible) AS n FROM PlayerTeamSeasonStats').get().n, 0);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) AS n FROM RosterMembership').get().n, 0);
    assert.equal(readSeasonBettingInputs(f.analytics, 3, at), null);
    assert.deepEqual(safeAnalyticsStatus(f.analytics, at).scope, { mode: 'legacy_preview', seasonId: null, leagueId: 100 });
    assert.deepEqual(f.league.prepare('SELECT * FROM LeagueInfo ORDER BY LeagueId').all(), source);
    assert.throws(() => buildAnalytics({ ...f, previewLeagueId: 100, seasonId: 3 }), /cannot be combined/);
  } finally { f.close(); }
});

test('league build captures authoritative group/bracket context and publishes a verified reverse sweep', () => {
  const f = fixture();
  try {
    f.league.exec(`CREATE TABLE GroupNames (LeagueId INTEGER, GroupId INTEGER, GroupName TEXT);
      INSERT INTO GroupNames VALUES (100, 1, 'North group');
      CREATE TABLE PlayoffBracket (LeagueId INTEGER PRIMARY KEY, PlayoffStructure TEXT);
      UPDATE LeagueStageBoundaries SET GroupEndMatchId = 109, TieBreakerEndMatchId = 109;
      DELETE FROM SeriesMatch WHERE MatchId >= 110;
      INSERT INTO SeriesMatch VALUES (11, 110), (11, 111), (11, 112);
      UPDATE MatchTeam SET WinnerId = 1002 WHERE MatchId = 110;`);
    f.league.prepare('INSERT INTO PlayoffBracket VALUES (100, ?)').run(JSON.stringify({
      upperBracket: [{ round: 1, matches: [{ seriesId: 11, team1Id: 1001, team2Id: 1002 }] }],
    }));
    const run = buildAnalytics(f).runId;
    assert.equal(f.analytics.prepare('SELECT GroupName FROM GroupFacts WHERE RunId = ?').get(run).GroupName, 'North group');
    const series = f.analytics.prepare('SELECT * FROM SeriesFacts WHERE RunId = ? AND SeriesId = 11').get(run);
    assert.equal(series.BestOf, 3);
    assert.equal(series.SourceMatchCount, 3);
    assert.equal(series.RoundLabel, 'Upper bracket round 1');
    const story = f.analytics.prepare("SELECT * FROM HighlightEvents WHERE Category = 'reverse_sweep'").get();
    assert.equal(story.Status, 'published');
    assert.match(story.Title, /Team A/);
    assert.deepEqual(JSON.parse(story.EvidenceJson).matchIds, [110, 111, 112]);
  } finally { f.close(); }
});
