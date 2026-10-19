import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { ensureWarehouseSchema } from '../config/warehouseSchema.js';
import { migrateAnalytics } from '../analytics/store.js';
import { buildAnalytics } from '../analytics/build.js';
import { readSeasonPerformanceInputs } from '../analytics/bettingInputs.js';
import { warehouseMatchTime, WAREHOUSE_FACT_TABLES } from '../analytics/warehouseFeatures.js';
import { highlightDTO } from '../analytics/highlightFeed.js';
import { emitWarehouseHighlights } from '../analytics/warehouseHighlights.js';
import { warehouseRecap } from '../analytics/warehouseRecap.js';

const now = new Date('2026-10-18T12:00:00.000Z');
function fixture() {
  const league = new Database(':memory:'), analytics = new Database(':memory:');
  analytics.pragma('foreign_keys=ON'); migrateAnalytics(analytics);
  league.exec(`CREATE TABLE LeagueSeasons(SeasonId INTEGER PRIMARY KEY,ExternalLeagueId INTEGER,LeagueName TEXT,Status TEXT,SignupTitle TEXT);
    CREATE TABLE SeasonTeams(TeamSubmissionId INTEGER PRIMARY KEY,SeasonId INTEGER,ExternalTeamId INTEGER,TeamName TEXT,GroupId INTEGER,IsManual INTEGER);
    CREATE TABLE SeasonTeamPlayers(TeamSubmissionId INTEGER,PlayerId INTEGER,Slot INTEGER);
    CREATE TABLE TeamRosterPlayers(TeamSubmissionId INTEGER,PlayerId INTEGER,Slot INTEGER);
    CREATE TABLE TeamRosterPeriods(TeamSubmissionId INTEGER,EffectiveFrom TEXT,EffectiveTo TEXT,FromEstimated INTEGER);
    CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);
    CREATE TABLE MatchLeague(MatchId INTEGER PRIMARY KEY,LeagueId INTEGER,DatePlayed TEXT);
    CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER,Duration INTEGER,Rehost INTEGER);
    CREATE TABLE MatchPlayer(MatchId INTEGER,PlayerId INTEGER,HeroId INTEGER,Kills INTEGER,Deaths INTEGER,Assists INTEGER,
      Lasthits INTEGER,GPM INTEGER,XPM INTEGER,Networth INTEGER,HeroDamage INTEGER,TowerDamage INTEGER,Healing INTEGER);
    CREATE TABLE MatchTeamPlayer(MatchId INTEGER,PlayerId INTEGER,TeamId INTEGER);
    CREATE TABLE LeagueStageBoundaries(LeagueId INTEGER,GroupEndMatchId INTEGER,TieBreakerEndMatchId INTEGER);
    INSERT INTO LeagueSeasons VALUES(1,100,'Signup season','active','Sign up');
    INSERT INTO SeasonTeams VALUES(11,1,1001,'Radiant team',1,0),(12,1,1002,'Dire team',1,0);
    INSERT INTO TeamRosterPeriods VALUES(11,'2026-10-01T00:00:00.000Z',NULL,0),(12,'2026-10-01T00:00:00.000Z',NULL,0);
    INSERT INTO LeagueStageBoundaries VALUES(100,1000,1000);`);
  ensureWarehouseSchema(league);
  league.exec(`INSERT INTO Patches VALUES(1,'7.40','2026-10-01T05:00:00Z',1,'calendar','2026-10-01T05:00:00Z'),
    (2,'7.41','2026-10-16T05:00:00Z',1,'calendar','2026-10-16T05:00:00Z');`);
  for (let id = 1; id <= 10; id++) {
    const team = id <= 5 ? 11 : 12;
    league.prepare('INSERT INTO PlayerInfo VALUES(?,?)').run(id, `Player ${id}`);
    if (id !== 1) league.prepare('INSERT INTO TeamRosterPlayers VALUES(?,?,?)').run(team, id, (id - 1) % 5);
    league.prepare('INSERT INTO SeasonTeamPlayers VALUES(?,?,?)').run(team, id, (id - 1) % 5);
  }
  for (const matchId of [101, 102]) {
    const start = Date.parse(`2026-10-${matchId === 101 ? '15' : '16'}T23:00:00Z`) / 1000;
    league.prepare('INSERT INTO MatchLeague VALUES(?,100,?)').run(matchId, '2026-10-01'); // Deliberately wrong/date-only legacy value.
    league.prepare(`INSERT INTO MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,Duration,Rehost,StartTimeUtc,PatchId,RadiantScore,DireScore,FirstBloodTime)
      VALUES(?,1001,1002,1001,2400,0,?,?,30,10,70)`).run(matchId, start, matchId === 101 ? 1 : 2);
    league.prepare(`INSERT INTO MatchIngestionState(MatchId,Status,ImporterVersion,SectionsJson,AttemptedAt,LastSuccessAt)
      VALUES(?,'partial',1,?,'2026-10-17T10:00:00.000Z','2026-10-17T10:00:00.000Z')`)
      .run(matchId, JSON.stringify({ objectives: { available: matchId === 101 }, fights: { available: matchId === 101 } }));
    for (let id = 1; id <= 10; id++) {
      league.prepare('INSERT INTO MatchTeamPlayer VALUES(?,?,?)').run(matchId, id, id <= 5 ? 1001 : 1002);
      league.prepare(`INSERT INTO MatchPlayer(MatchId,PlayerId,HeroId,Kills,Deaths,Assists,Lasthits,GPM,XPM,Networth,HeroDamage,TowerDamage,Healing,
        LaneRole,IsRoaming,FinalLevel,Denies,ObserversPlaced,SentriesPlaced,ObserversKilled,SentriesKilled,CampsStacked,StunSeconds)
        VALUES(?,?,?,2,1,3,100,500,600,10000,?,500,0,?,0,20,0,0,0,?,?,15,120)`)
        .run(matchId, id, id, matchId === 101 && id === 5 ? null : 2000, matchId === 101 ? 1 : 3,
          matchId === 101 && id === 2 ? null : id === 1 ? 10 : 0, id === 1 ? 4 : 0);
      for (const minute of [10, 20, 30, 40]) league.prepare('INSERT INTO MatchPlayerTimeline VALUES(?,?,?,?,?,?)')
        .run(matchId, id, minute * 60, matchId === 101 && id === 5 && minute === 20 ? null : id * 1000 + minute * 10,
          id * 500 + minute * 10, id === 2 && minute === 10 ? 0 : id * 10 + minute);
      league.prepare('INSERT INTO MatchPlayerPurchases VALUES(?,?,0,600,\'blink\')').run(matchId, id);
      league.prepare('INSERT INTO MatchPlayerPurchases VALUES(?,?,1,1200,\'blink\')').run(matchId, id);
    }
    for (let time = 0; time <= 2400; time += 60) league.prepare('INSERT INTO MatchTeamTimeline VALUES(?,?,?,?)')
      .run(matchId, time, time === 600 ? -12000 : time >= 1800 ? 15000 : 0, 2000);
  }
  for (const [index, time, type, side, target] of [[0, 900, 'building_kill', 0, 'npc_dota_badguys_tower1_mid'],
    [1, 950, 'CHAT_MESSAGE_ROSHAN_KILL', 0, null], [2, 1200, 'building_kill', 0, 'npc_dota_badguys_melee_rax_mid']]) {
    league.prepare('INSERT INTO MatchObjectives VALUES(101,?,?,?,NULL,NULL,?,?,\'{}\')').run(index, time, type, side, target);
  }
  for (const [index, start, end] of [[0, 800, 840], [1, 920, 940]]) {
    league.prepare('INSERT INTO MatchTeamfights VALUES(101,?,?,?,\'{}\')').run(index, start, end);
    for (let id = 1; id <= (index === 0 ? 10 : 9); id++) league.prepare('INSERT INTO MatchTeamfightPlayers VALUES(101,?,?,?,?,?,?,?,?)')
      .run(index, id, id <= 5 ? id - 1 : id + 122, id <= 5 ? 0 : 1, 1000, id <= 5 ? 500 : -500, 100, '{"buybacks":0}');
  }
  return { league, analytics, now, close() { analytics.close(); league.close(); } };
}

test('EDW UTC replaces date-only/older metadata times without backdating source availability', () => {
  const timing = warehouseMatchTime({ StartTimeUtc: Date.parse('2026-10-15T23:00:00Z') / 1000, DatePlayed: '2026-10-01' },
    { StartedAtUtc: '2026-10-14T00:00:00Z', ObservedAtUtc: '2026-10-16T00:00:00Z' },
    { LastSuccessAt: '2026-10-17T00:00:00Z', CollectedAt: '2026-10-17T01:00:00Z' });
  assert.deepEqual(timing, { startedAt: '2026-10-15T23:00:00.000Z', observedAt: '2026-10-17T01:00:00.000Z', timeSource: 'edw' });
  assert.equal(warehouseMatchTime({ DatePlayed: '2026-10-01' }).startedAt, null);
  assert.equal(warehouseMatchTime({ StartTimeUtc: -1 }, { StartedAtUtc: '2026-10-15T23:00:00-04:00' }).startedAt, '2026-10-16T03:00:00.000Z');
});

test('expanded facts retain metric-specific samples, complete team denominators, UTC and patch/role cohorts', () => {
  const f = fixture(); try {
    const { runId } = buildAnalytics(f);
    assert.equal(f.analytics.prepare('SELECT StartedAtUtc FROM MatchFacts WHERE MatchId=101').get().StartedAtUtc, '2026-10-15T23:00:00.000Z');
    assert.equal(f.analytics.prepare('SELECT SourceObservedAtUtc FROM MatchFacts WHERE MatchId=101').get().SourceObservedAtUtc, '2026-10-17T10:00:00.000Z');
    const p = f.analytics.prepare('SELECT * FROM PlayerPerformanceFacts WHERE MatchId=101 AND PlayerId=1').get();
    assert.equal(p.DewardsPer10Minutes, 3.5); assert.equal(p.DamageShare, null); assert.equal(p.HealingShare, null);
    assert.equal(p.NetWorthShare, 20); assert.equal(p.KillParticipation, 50); assert.equal(p.Denies, 0);
    assert.equal(f.analytics.prepare('SELECT DamageShare FROM PlayerPerformanceFacts WHERE MatchId=101 AND PlayerId=6').get().DamageShare, 20);
    assert.equal(f.analytics.prepare('SELECT DewardsPer10Minutes FROM PlayerPerformanceFacts WHERE MatchId=101 AND PlayerId=2').get().DewardsPer10Minutes, null);
    const checkpoint = f.analytics.prepare('SELECT * FROM TeamEconomyCheckpoints WHERE MatchId=101 AND TeamSubmissionId=11 AND Minute=20').get();
    assert.equal(checkpoint.GoldEarned, null); assert.equal(checkpoint.Experience, 8500);
    assert.equal(f.analytics.prepare('SELECT LastHits FROM PlayerEconomyCheckpoints WHERE MatchId=101 AND PlayerId=2 AND Minute=10').get().LastHits, 0);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) n FROM PlayerEconomyCheckpoints WHERE Minute=50').get().n, 0);
    assert.equal(f.analytics.prepare("SELECT Samples FROM PlayerPerformanceStats WHERE PlayerId=2 AND Metric='DewardsPer10Minutes'").get().Samples, 1);
    assert.equal(f.analytics.prepare("SELECT Samples FROM TeamPerformanceStats WHERE TeamSubmissionId=11 AND Metric='GoldEarnedAt20'").get().Samples, 1);
    assert.equal(f.analytics.prepare("SELECT Samples FROM TeamPerformanceStats WHERE TeamSubmissionId=11 AND Metric='ExperienceAt20'").get().Samples, 2);
    const contexts = f.analytics.prepare('SELECT PatchKey,LaneRole,MetricsJson FROM PlayerHeroPatchStats WHERE PlayerId=1 ORDER BY PatchKey').all();
    assert.deepEqual(contexts.map(c => [c.PatchKey, c.LaneRole]), [['7.40', 1], ['7.41', 3]]);
    assert.equal(JSON.parse(contexts[0].MetricsJson).DamageShare.samples, 0);
    assert.equal(JSON.parse(contexts[0].MetricsJson).GPM.total, null);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) n FROM PlayerItemTimings').get().n, 20);
    assert.equal(f.analytics.prepare("SELECT AverageFirstPurchaseSeconds FROM HeroItemStats WHERE HeroId=1 AND PatchKey='7.40'").get().AverageFirstPurchaseSeconds, 600);
    const contract = readSeasonPerformanceInputs(f.analytics, 1);
    assert.equal(contract.analyticsRunId, runId); assert.equal(contract.featureVersion, 1);
    assert.ok(contract.heroContexts.length > 0); assert.equal(JSON.stringify(contract).includes('Screenshot'), false);
  } finally { f.close(); }
});

test('10k comebacks, known-zero objectives, incomplete fights and objective follow-up use explicit coverage', () => {
  const f = fixture(); try {
    buildAnalytics(f);
    const t = f.analytics.prepare('SELECT * FROM TeamPerformanceFacts WHERE MatchId=101 AND TeamSubmissionId=11').get();
    assert.equal(t.Comeback10k, 1); assert.equal(t.MaximumGoldDeficit, 12000); assert.equal(t.GoldTimelineComplete, 1);
    assert.equal(t.Roshans, 1); assert.equal(t.FirstTower, 1); assert.equal(t.RecordedFights, 2); assert.equal(t.KnownFights, 1);
    const dire = f.analytics.prepare('SELECT * FROM TeamPerformanceFacts WHERE MatchId=101 AND TeamSubmissionId=12').get();
    assert.equal(dire.Lost10kLead, 1); assert.equal(dire.Towers, 0);
    assert.equal(f.analytics.prepare('SELECT Roshans FROM TeamPerformanceFacts WHERE MatchId=102 LIMIT 1').get().Roshans, null);
    const fight = f.analytics.prepare('SELECT * FROM TeamfightFacts WHERE MatchId=101 AND FightIndex=0 AND TeamSubmissionId=11').get();
    assert.equal(fight.Kills, 5); assert.equal(fight.Deaths, 0); assert.equal(fight.Outcome, 'win'); assert.equal(fight.Buybacks, 0);
    assert.equal(fight.TowersAfter, 1); assert.equal(fight.RoshansAfter, 0, 'next fight prevents duplicate objective attribution');
    assert.equal(f.analytics.prepare('SELECT Outcome FROM TeamfightFacts WHERE FightIndex=1 LIMIT 1').get().Outcome, 'unknown');
    assert.equal(f.analytics.prepare('SELECT COUNT(*) n FROM HighlightEvents WHERE Category=\'comeback\'').get().n, 2);
    const support = f.analytics.prepare("SELECT * FROM HighlightEvents WHERE Fingerprint='edw:player:1:101:1:Dewards'").get();
    assert.match(support.Body, /Stand-in appearance/); assert.equal(highlightDTO(support).stat.value, 14);
    const fightStory = f.analytics.prepare("SELECT EvidenceJson FROM HighlightEvents WHERE Category='teamfight'").get();
    assert.equal(JSON.parse(fightStory.EvidenceJson).roshansAfter, 0);
    f.league.exec('UPDATE MatchTeamfights SET StartSeconds=-30,EndSeconds=0 WHERE FightIndex=0');
    const prehorn = buildAnalytics(f).runId;
    assert.equal(f.analytics.prepare('SELECT StartSeconds FROM TeamfightFacts WHERE RunId=? AND FightIndex=0 LIMIT 1').get(prehorn).StartSeconds, -30);
    f.league.exec("UPDATE MatchObjectives SET TeamSide=NULL WHERE Type='CHAT_MESSAGE_ROSHAN_KILL'");
    const next = buildAnalytics(f).runId;
    assert.equal(f.analytics.prepare('SELECT Roshans FROM TeamPerformanceFacts WHERE RunId=? AND MatchId=101 LIMIT 1').get(next).Roshans, null);
  } finally { f.close(); }
});

test('backfilled observations cannot enter an earlier pricing snapshot, nor can unfinished games', () => {
  const f = fixture(); try {
    f.league.exec("UPDATE MatchIngestionState SET LastSuccessAt='2026-10-19T00:00:00Z' WHERE MatchId=101");
    const { runId } = buildAnalytics(f);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) n FROM MatchFacts WHERE RunId=?').get(runId).n, 1);
    assert.ok(f.analytics.prepare("SELECT 1 FROM DataQualityIssues WHERE Code='match_not_available_as_of'").get());
    f.league.prepare('UPDATE MatchTeam SET StartTimeUtc=? WHERE MatchId=102').run((now.getTime() - 1000) / 1000);
    assert.equal(f.analytics.prepare('SELECT COUNT(*) n FROM MatchFacts WHERE RunId=?').get(buildAnalytics(f).runId).n, 0);
  } finally { f.close(); }
});

test('expanded stories use exact checkpoints, complete contribution denominators and positive first purchases', () => {
  const f = fixture(); try {
    f.league.exec(`UPDATE MatchPlayerTimeline SET LastHits=95 WHERE PlayerId=1 AND TimeSeconds=600;
      UPDATE MatchPlayer SET HeroDamage=60000,Kills=20,Assists=0,Healing=15000 WHERE PlayerId=1;
      UPDATE MatchPlayer SET Kills=0 WHERE PlayerId BETWEEN 2 AND 5;
      UPDATE MatchPlayer SET Kills=NULL WHERE PlayerId=5 AND MatchId=101;
      UPDATE MatchPlayerPurchases SET TimeSeconds=-1 WHERE PlayerId=1 AND MatchId=101 AND EventIndex=0;`);
    const { runId } = buildAnalytics(f);
    const stories = []; emitWarehouseHighlights(f.analytics, runId, story => stories.push(story));
    const player = stories.filter(s => s.playerId === 1);
    const farming = player.find(s => s.evidence.minute === 10);
    assert.equal(farming.evidence.value, 95); assert.match(farming.body, /cumulative gold earned/);
    assert.match(farming.body, /Stand-in appearance/);
    assert.ok(player.some(s => s.evidence.metric === 'DamageShare' && s.evidence.matchIds[0] === 102));
    assert.equal(player.some(s => s.evidence.metric === 'DamageShare' && s.evidence.matchIds[0] === 101), false);
    assert.ok(player.some(s => s.evidence.metric === 'KillParticipation' && s.evidence.matchIds[0] === 102));
    assert.equal(player.some(s => s.evidence.metric === 'KillParticipation' && s.evidence.matchIds[0] === 101), false);
    assert.ok(player.some(s => s.evidence.metric === 'HealingShare'));
    assert.equal(player.some(s => s.category === 'items' && s.evidence.matchIds[0] === 101), false);
    assert.ok(player.some(s => s.category === 'items' && s.evidence.purchaseSeconds === 600));
    const summary = warehouseRecap(f.analytics, runId, [101]);
    assert.equal(summary.comeback.value, 12000); assert.equal(summary.support.value, 14);
    const published = f.analytics.prepare('SELECT * FROM HighlightEvents WHERE FirstPublishedAtUtc IS NOT NULL').all();
    assert.ok(published.filter(s => s.PlayerId !== null).length >= 2);
    assert.ok(new Set(published.filter(s => s.PlayerId !== null).map(s => s.Category)).size >= 2);
    assert.ok(published.filter(s => s.Period === 'daily').length <= 5);
    const dto = highlightDTO({ ...published.find(s => s.PlayerId !== null), EvidenceJson: JSON.stringify({
      ...farming.evidence, PrivatePlayerFeatures: 'secret', SignupMMR: 999999 }) });
    assert.equal(dto.heroId, 1); assert.ok(dto.details.some(d => d.label === 'Checkpoint' && d.value === '10 minutes'));
    assert.equal(JSON.stringify(dto).includes('secret'), false); assert.equal(JSON.stringify(dto).includes('999999'), false);
    f.league.exec('UPDATE MatchPlayerTimeline SET LastHits=0 WHERE PlayerId=1 AND TimeSeconds=600');
    buildAnalytics(f);
    assert.equal(f.analytics.prepare("SELECT Status FROM HighlightEvents WHERE Fingerprint='edw:farming:1:101:1:10'").get().Status, 'withdrawn');
  } finally { f.close(); }
});

test('clean fights need no objective follow-up and Roshan control only uses recorded objective coverage', () => {
  const f = fixture(); try {
    f.league.exec(`UPDATE MatchObjectives SET TimeSeconds=1800;
      INSERT INTO MatchObjectives(MatchId,EventIndex,TimeSeconds,Type,TeamSide,SourceJson)
      VALUES(101,10,2000,'CHAT_MESSAGE_ROSHAN_KILL',0,'{}'),(101,11,2100,'CHAT_MESSAGE_ROSHAN_KILL',0,'{}');`);
    const { runId } = buildAnalytics(f);
    const stories = []; emitWarehouseHighlights(f.analytics, runId, story => stories.push(story));
    const fight = stories.find(s => s.category === 'teamfight');
    assert.match(fight.title, /sweep the fight/); assert.match(fight.body, /No tower, barracks or Roshan/);
    assert.equal(fight.evidence.kills, 5); assert.equal(fight.evidence.deaths, 0);
    assert.equal(stories.find(s => s.category === 'objectives').evidence.value, 3);
    assert.equal(stories.some(s => s.category === 'objectives' && s.evidence.matchIds[0] === 102), false);
    const recap = f.analytics.prepare("SELECT Body FROM HighlightEvents WHERE Fingerprint='daily:1:2026-10-15'").get();
    assert.match(recap.Body, /12,000-gold deficit/); assert.match(recap.Body, /14 enemy wards/);
  } finally { f.close(); }
});

test('version 6 migrates additively, failed builds roll back features, corrections withdraw highlights and generations stay bounded', () => {
  const old = new Database(':memory:'); try {
    old.exec(readFileSync(new URL('../scripts/db/analytics.schema.sql', import.meta.url), 'utf8'));
    old.exec("INSERT INTO AnalyticsMigrations VALUES(6,'2026-10-01T00:00:00Z');UPDATE HighlightSettings SET Paused=1 WHERE Id=1");
    migrateAnalytics(old);
    assert.equal(old.prepare('SELECT MAX(Version) v FROM AnalyticsMigrations').get().v, 8);
    assert.equal(old.prepare('SELECT Paused FROM HighlightSettings WHERE Id=1').get().Paused, 1);
  } finally { old.close(); }
  const f = fixture(); try {
    const first = buildAnalytics(f).runId;
    assert.throws(() => buildAnalytics({ ...f, beforePublish() { throw Error('rollback'); } }), /rollback/);
    assert.equal(f.analytics.prepare('SELECT PublishedRunId FROM AnalyticsState').get().PublishedRunId, first);
    assert.equal(f.analytics.prepare('SELECT COUNT(DISTINCT RunId) n FROM MatchContextFacts').get().n, 1);
    f.league.exec('UPDATE MatchPlayer SET ObserversKilled=0,SentriesKilled=0');
    buildAnalytics(f); buildAnalytics(f); buildAnalytics(f);
    assert.equal(f.analytics.prepare("SELECT Status FROM HighlightEvents WHERE Fingerprint='edw:player:1:101:1:Dewards'").get().Status, 'withdrawn');
    for (const table of WAREHOUSE_FACT_TABLES) assert.ok(f.analytics.prepare(`SELECT COUNT(DISTINCT RunId) n FROM ${table}`).get().n <= 2, table);
    assert.deepEqual(f.analytics.pragma('foreign_key_check'), []);
  } finally { f.close(); }
});
