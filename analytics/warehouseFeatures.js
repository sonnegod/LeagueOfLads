import { describeObjective } from '../config/warehouseReporting.js';

export const WAREHOUSE_FEATURE_VERSION = 1;
export const CHECKPOINT_MINUTES = [10, 20, 30, 40, 50, 60];
export const WAREHOUSE_FACT_TABLES = ['TeamfightFacts', 'PlayerItemTimings', 'PlayerEconomyCheckpoints',
  'TeamEconomyCheckpoints', 'PlayerPerformanceFacts', 'TeamPerformanceFacts', 'MatchContextFacts',
  'PlayerPerformanceStats', 'TeamPerformanceStats', 'PlayerHeroPatchStats', 'HeroItemStats'];
const playerColumns = ['LaneRole', 'IsRoaming', 'FinalLevel', 'Denies', 'ObserversPlaced', 'SentriesPlaced',
  'ObserversKilled', 'SentriesKilled', 'CampsStacked', 'StunSeconds', 'NeutralKills', 'AncientKills',
  'TowerKills', 'RoshanKills', 'CourierKills'];
export const PLAYER_PERFORMANCE_METRICS = [...playerColumns.filter(k => !['LaneRole', 'IsRoaming'].includes(k)),
  'DewardsPer10Minutes', 'DamageShare', 'HealingShare', 'NetWorthShare', 'KillParticipation'];
export const TEAM_PERFORMANCE_METRICS = ['MaximumGoldLead', 'MaximumGoldDeficit', 'Comeback10k', 'Lost10kLead',
  'Towers', 'Barracks', 'Roshans', 'FirstTower', 'FirstRoshan', 'RecordedFights', 'KnownFights', 'FightsWon', 'FightsLost', 'FightsDrawn'];
const basicMetrics = ['Kills', 'Deaths', 'Assists', 'LastHits', 'GPM', 'XPM', 'NetWorth', 'HeroDamage', 'TowerDamage', 'Healing'];
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const signed = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const parse = value => { try { const parsed = JSON.parse(value || '{}');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
} catch { return {}; } };
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
export function utcInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
export function warehouseMatchTime(match, detail, metadata) {
  const millis = Number.isSafeInteger(match.StartTimeUtc) && match.StartTimeUtc > 0 ? match.StartTimeUtc * 1000 : NaN;
  const edwTime = Number.isFinite(millis) && Number.isFinite(new Date(millis).getTime()) ? new Date(millis).toISOString() : null;
  const startedAt = edwTime || utcInstant(detail?.StartedAtUtc) || utcInstant(match.DatePlayed);
  // Observation time is never inferred from kickoff. Conservatively retain the latest
  // source observation because repairs may change the values used by a historical model.
  const observed = [detail?.ObservedAtUtc, metadata?.LastSuccessAt, metadata?.CollectedAt].map(utcInstant).filter(Boolean).sort();
  return { startedAt, observedAt: observed.at(-1) || null,
    timeSource: edwTime ? 'edw' : utcInstant(detail?.StartedAtUtc) ? 'api' : startedAt ? 'warehouse' : 'unknown' };
}
function insert(db, table, keys) {
  const statement = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(k => `@${k}`).join(',')})`);
  return row => statement.run(Object.fromEntries(keys.map(k => [k, row[k] ?? null])));
}
function completeSum(rows, field, validate = nonnegative) {
  if (rows.length !== 5 || rows.some(row => validate(row[field]) === null)) return null;
  return rows.reduce((total, row) => total + row[field], 0);
}

export function createWarehouseFeatures({ league, analytics, runId, flag }) {
  const optional = new Map();
  const rows = (table, matchId, order = '') => {
    const key = `${table}:${order}`;
    if (!optional.has(key)) optional.set(key, hasTable(league, table)
      ? league.prepare(`SELECT * FROM ${table} WHERE MatchId=? ${order}`) : null);
    return optional.get(key)?.all(matchId) || [];
  };
  const patches = new Map(hasTable(league, 'Patches') ? league.prepare('SELECT PatchId,PatchKey FROM Patches').all().map(p => [p.PatchId, p.PatchKey]) : []);
  const sourceObservation = hasTable(league, 'MatchSourceResponses')
    ? league.prepare('SELECT CollectedAt FROM MatchSourceResponses WHERE MatchId=?') : null;
  const writeContext = insert(analytics, 'MatchContextFacts', ['RunId', 'MatchId', 'PatchId', 'PatchKey',
    'RadiantScore', 'DireScore', 'FirstBloodTime', 'EnrichmentStatus', 'SourceObservedAtUtc', 'SectionsJson', 'FeatureVersion']);
  const writePlayer = insert(analytics, 'PlayerPerformanceFacts', ['RunId', 'MatchId', 'PlayerId', ...playerColumns,
    'DewardsPer10Minutes', 'DamageShare', 'HealingShare', 'NetWorthShare', 'KillParticipation']);
  const writeTeam = insert(analytics, 'TeamPerformanceFacts', ['RunId', 'MatchId', 'TeamSubmissionId',
    'GoldSamples', 'XpSamples', 'GoldTimelineComplete', ...TEAM_PERFORMANCE_METRICS.slice(0, 4),
    'ObjectivesAvailable', 'Towers', 'Barracks', 'Roshans', 'FirstTower', 'FirstRoshan', 'TeamfightsAvailable',
    'RecordedFights', 'KnownFights', 'FightsWon', 'FightsLost', 'FightsDrawn']);
  const playerCheckpoint = insert(analytics, 'PlayerEconomyCheckpoints', ['RunId', 'MatchId', 'PlayerId', 'Minute', 'GoldEarned', 'Experience', 'LastHits']);
  const teamCheckpoint = insert(analytics, 'TeamEconomyCheckpoints', ['RunId', 'MatchId', 'TeamSubmissionId', 'Minute',
    'GoldAdvantage', 'XpAdvantage', 'GoldEarned', 'Experience', 'LastHits']);
  const writeFight = insert(analytics, 'TeamfightFacts', ['RunId', 'MatchId', 'FightIndex', 'TeamSubmissionId',
    'StartSeconds', 'EndSeconds', 'Kills', 'Deaths', 'Damage', 'GoldDelta', 'XpDelta', 'Buybacks', 'Outcome',
    'TowersAfter', 'RoshansAfter', 'BarracksAfter']);
  const writeItem = insert(analytics, 'PlayerItemTimings', ['RunId', 'MatchId', 'PlayerId', 'ItemKey', 'FirstPurchaseSeconds']);
  return {
    metadata(matchId) {
      return { ...rows('MatchIngestionState', matchId)[0], ...sourceObservation?.get(matchId) };
    },
    write({ match, metadata, stats, assignments, radiant, dire }) {
      const MatchId = match.MatchId, base = { RunId: runId, MatchId };
      const sections = parse(metadata.SectionsJson);
      writeContext({ ...base, PatchId: match.PatchId, PatchKey: patches.get(match.PatchId),
        RadiantScore: nonnegative(match.RadiantScore), DireScore: nonnegative(match.DireScore),
        FirstBloodTime: nonnegative(match.FirstBloodTime), EnrichmentStatus: metadata.Status || 'not_imported',
        SourceObservedAtUtc: [metadata.LastSuccessAt, metadata.CollectedAt].map(utcInstant).filter(Boolean).sort().at(-1),
        SectionsJson: JSON.stringify(sections), FeatureVersion: WAREHOUSE_FEATURE_VERSION });
      const players = [...stats.values()];
      const sides = [match.TeamRad, match.TeamDire].map(id => players.filter(p => assignments.get(p.PlayerId) === id));
      const summaries = sides.map(team => ({ damage: completeSum(team, 'HeroDamage'), healing: completeSum(team, 'Healing'),
        netWorth: completeSum(team, 'Networth'), kills: completeSum(team, 'Kills') }));
      for (const p of players) {
        const side = assignments.get(p.PlayerId) === match.TeamRad ? 0 : 1, totals = summaries[side];
        const share = (value, total) => nonnegative(value) !== null && total > 0 ? value / total * 100 : null;
        const dewards = nonnegative(p.ObserversKilled) !== null && nonnegative(p.SentriesKilled) !== null
          ? (p.ObserversKilled + p.SentriesKilled) * 600 / match.Duration : null;
        const row = { ...base, PlayerId: p.PlayerId, ...Object.fromEntries(playerColumns.map(k => [k, nonnegative(p[k])])),
          DewardsPer10Minutes: dewards, DamageShare: share(p.HeroDamage, totals.damage), HealingShare: share(p.Healing, totals.healing),
          NetWorthShare: share(p.Networth, totals.netWorth), KillParticipation: totals.kills > 0
            && nonnegative(p.Kills) !== null && nonnegative(p.Assists) !== null ? Math.min(100, (p.Kills + p.Assists) / totals.kills * 100) : null };
        if (![1, 2, 3, 4].includes(row.LaneRole)) row.LaneRole = null;
        if (![0, 1].includes(row.IsRoaming)) row.IsRoaming = null;
        writePlayer(row);
      }
      // Exact checkpoints only. Gold_t is cumulative gold earned, not net worth.
      const playerTimeline = rows('MatchPlayerTimeline', MatchId).filter(r => nonnegative(r.TimeSeconds) !== null && r.TimeSeconds <= match.Duration);
      const timelineByPlayerTime = new Map(playerTimeline.map(r => [`${r.PlayerId}:${r.TimeSeconds}`, r]));
      const teamTimeline = rows('MatchTeamTimeline', MatchId, 'ORDER BY TimeSeconds').filter(r => Number.isInteger(r.TimeSeconds) && r.TimeSeconds >= 0 && r.TimeSeconds <= match.Duration);
      const timelineByTime = new Map(teamTimeline.map(r => [r.TimeSeconds, r]));
      for (const Minute of CHECKPOINT_MINUTES.filter(minute => minute * 60 <= match.Duration)) {
        const TimeSeconds = Minute * 60;
        for (const p of players) {
          const point = timelineByPlayerTime.get(`${p.PlayerId}:${TimeSeconds}`);
          playerCheckpoint({ ...base, PlayerId: p.PlayerId, Minute, GoldEarned: nonnegative(point?.Gold),
            Experience: nonnegative(point?.Experience), LastHits: nonnegative(point?.LastHits) });
        }
        for (const side of [0, 1]) {
          const team = sides[side].map(p => timelineByPlayerTime.get(`${p.PlayerId}:${TimeSeconds}`) || {});
          const point = timelineByTime.get(TimeSeconds), sign = side === 0 ? 1 : -1;
          teamCheckpoint({ ...base, TeamSubmissionId: side === 0 ? radiant : dire, Minute,
            GoldAdvantage: signed(point?.RadiantGoldAdvantage) === null ? null : sign * point.RadiantGoldAdvantage,
            XpAdvantage: signed(point?.RadiantXpAdvantage) === null ? null : sign * point.RadiantXpAdvantage,
            GoldEarned: completeSum(team, 'Gold'), Experience: completeSum(team, 'Experience'), LastHits: completeSum(team, 'LastHits') });
        }
      }
      const rawObjectives = rows('MatchObjectives', MatchId, 'ORDER BY TimeSeconds,EventIndex').map(describeObjective);
      const objectives = rawObjectives.filter(e => !e.denied && nonnegative(e.time) !== null && e.time <= match.Duration);
      const objectiveCount = (kind, side, events = objectives) => {
        if (sections.objectives?.available !== true || rawObjectives.some(e => e.category === kind
          && !e.denied && (nonnegative(e.time) === null || e.time > match.Duration || ![0, 1].includes(e.teamSide)))) return null;
        return events.filter(e => e.category === kind && e.teamSide === side).length;
      };
      const firstObjective = (kind, side) => {
        if (objectiveCount(kind, side) === null) return null;
        const first = objectives.find(e => e.category === kind);
        return first ? Number(first.teamSide === side) : null;
      };
      const fights = rows('MatchTeamfights', MatchId, 'ORDER BY StartSeconds,FightIndex');
      const fightPlayers = rows('MatchTeamfightPlayers', MatchId);
      const fightCounts = [0, 1].map(() => ({ RecordedFights: sections.fights?.available === true ? 0 : null,
        KnownFights: sections.fights?.available === true ? 0 : null, FightsWon: sections.fights?.available === true ? 0 : null,
        FightsLost: sections.fights?.available === true ? 0 : null, FightsDrawn: sections.fights?.available === true ? 0 : null }));
      if (sections.fights?.available === true) for (const [index, fight] of fights.entries()) {
        // OpenDota records real pre-horn fights with negative times. Its last
        // fight window can also end just after the official finish; retain it.
        if (!Number.isInteger(fight.StartSeconds) || !Number.isInteger(fight.EndSeconds)
          || fight.EndSeconds < fight.StartSeconds || fight.StartSeconds > match.Duration) {
          flag('match', MatchId, 'invalid_teamfight_window'); continue;
        }
        const participants = fightPlayers.filter(p => p.FightIndex === fight.FightIndex);
        const complete = participants.length === 10 && new Set(participants.map(p => p.PlayerId)).size === 10
          && participants.every(p => assignments.has(p.PlayerId));
        if (!complete) flag('match', MatchId, 'incomplete_teamfight_players');
        const totals = [match.TeamRad, match.TeamDire].map(teamId => {
          const team = complete ? participants.filter(p => assignments.get(p.PlayerId) === teamId)
            .map(p => ({ ...p, Buybacks: parse(p.SourceJson).buybacks })) : [];
          return Object.fromEntries(['Deaths', 'Damage', 'GoldDelta', 'XpDelta', 'Buybacks']
            .map(k => [k, completeSum(team, k, ['GoldDelta', 'XpDelta'].includes(k) ? signed : nonnegative)]));
        });
        const after = objectives.filter(e => e.time > fight.EndSeconds && e.time <= fight.EndSeconds + 90
          && e.time < (fights[index + 1]?.StartSeconds ?? Infinity));
        for (const side of [0, 1]) {
          const own = totals[side], other = totals[1 - side];
          const edge = own.Deaths === null || other.Deaths === null ? null : other.Deaths - own.Deaths;
          const goldEdge = own.GoldDelta === null || other.GoldDelta === null ? null : own.GoldDelta - other.GoldDelta;
          const result = edge === null ? null : edge || goldEdge;
          const Outcome = result === null ? 'unknown' : result > 0 ? 'win' : result < 0 ? 'loss' : 'draw';
          const counts = fightCounts[side]; counts.RecordedFights++;
          if (Outcome !== 'unknown') { counts.KnownFights++; counts[{ win: 'FightsWon', loss: 'FightsLost', draw: 'FightsDrawn' }[Outcome]]++; }
          writeFight({ ...base, FightIndex: fight.FightIndex, TeamSubmissionId: side === 0 ? radiant : dire,
            StartSeconds: fight.StartSeconds, EndSeconds: fight.EndSeconds, ...own, Kills: other.Deaths, Outcome,
            TowersAfter: objectiveCount('tower', side, after), RoshansAfter: objectiveCount('roshan', side, after),
            BarracksAfter: objectiveCount('barracks', side, after) });
        }
      }
      for (const side of [0, 1]) {
        const gold = teamTimeline.filter(p => signed(p.RadiantGoldAdvantage) !== null).map(p => p.RadiantGoldAdvantage * (side === 0 ? 1 : -1));
        const maximum = gold.length ? Math.max(0, ...gold) : null, deficit = gold.length ? Math.max(0, ...gold.map(v => -v)) : null;
        const won = Number(match.WinnerId === (side === 0 ? match.TeamRad : match.TeamDire));
        writeTeam({ ...base, TeamSubmissionId: side === 0 ? radiant : dire, GoldSamples: gold.length,
          XpSamples: teamTimeline.filter(p => signed(p.RadiantXpAdvantage) !== null).length,
          GoldTimelineComplete: Number(Array.from({ length: Math.floor(match.Duration / 60) + 1 }, (_, i) => i * 60)
            .every(time => signed(timelineByTime.get(time)?.RadiantGoldAdvantage) !== null)),
          MaximumGoldLead: maximum, MaximumGoldDeficit: deficit,
          Comeback10k: deficit >= 10000 ? won : null, Lost10kLead: maximum >= 10000 ? 1 - won : null,
          ObjectivesAvailable: Number(sections.objectives?.available === true), Towers: objectiveCount('tower', side),
          Barracks: objectiveCount('barracks', side), Roshans: objectiveCount('roshan', side),
          FirstTower: firstObjective('tower', side), FirstRoshan: firstObjective('roshan', side),
          TeamfightsAvailable: Number(sections.fights?.available === true), ...fightCounts[side] });
      }
      const firstPurchases = new Map();
      for (const item of rows('MatchPlayerPurchases', MatchId)) if (assignments.has(item.PlayerId)
        && signed(item.TimeSeconds) !== null && item.TimeSeconds <= match.Duration && typeof item.ItemKey === 'string' && item.ItemKey) {
        const key = `${item.PlayerId}:${item.ItemKey}`, old = firstPurchases.get(key);
        if (!old || item.TimeSeconds < old.TimeSeconds) firstPurchases.set(key, item);
      }
      for (const item of firstPurchases.values()) writeItem({ ...base, PlayerId: item.PlayerId, ItemKey: item.ItemKey, FirstPurchaseSeconds: item.TimeSeconds });
    },
  };
}

export function summarizeWarehouseFeatures(db, runId) {
  for (const [table, fact, metrics, isPlayer] of [
    ['PlayerPerformanceStats', 'PlayerPerformanceFacts', PLAYER_PERFORMANCE_METRICS, true],
    ['TeamPerformanceStats', 'TeamPerformanceFacts', TEAM_PERFORMANCE_METRICS, false],
  ]) for (const metric of metrics) {
    db.prepare(`INSERT INTO ${table} SELECT ?,m.SeasonId,g.TeamSubmissionId,${isPlayer ? 'g.PlayerId,' : ''}
      m.Stage,${isPlayer ? 'g.Membership,' : ''}?,COUNT(e.${metric}),
      ${['DewardsPer10Minutes','DamageShare','HealingShare','NetWorthShare','KillParticipation','FinalLevel','MaximumGoldLead','MaximumGoldDeficit'].includes(metric) ? 'NULL' : `SUM(e.${metric})`},
      AVG(e.${metric}),MIN(e.${metric}),MAX(e.${metric}),
      MAX(0,AVG(e.${metric}*e.${metric})-AVG(e.${metric})*AVG(e.${metric})) FROM ${fact} e
      JOIN ${isPlayer ? 'PlayerGameFacts' : 'TeamGameFacts'} g ON g.RunId=e.RunId AND g.MatchId=e.MatchId
        AND g.${isPlayer ? 'PlayerId' : 'TeamSubmissionId'}=e.${isPlayer ? 'PlayerId' : 'TeamSubmissionId'}
      JOIN MatchFacts m ON m.RunId=e.RunId AND m.MatchId=e.MatchId WHERE e.RunId=?
      GROUP BY m.SeasonId,g.TeamSubmissionId,${isPlayer ? 'g.PlayerId,g.Membership,' : ''}m.Stage`).run(runId, metric, runId);
  }
  for (const isPlayer of [true, false]) for (const minute of CHECKPOINT_MINUTES) {
    const source = isPlayer ? 'PlayerEconomyCheckpoints' : 'TeamEconomyCheckpoints';
    const fields = isPlayer ? ['GoldEarned', 'Experience', 'LastHits'] : ['GoldAdvantage', 'XpAdvantage', 'GoldEarned', 'Experience', 'LastHits'];
    for (const field of fields) db.prepare(`INSERT INTO ${isPlayer ? 'PlayerPerformanceStats' : 'TeamPerformanceStats'}
      SELECT ?,m.SeasonId,g.TeamSubmissionId,${isPlayer ? 'g.PlayerId,' : ''}m.Stage,${isPlayer ? 'g.Membership,' : ''}?,
      COUNT(c.${field}),NULL,AVG(c.${field}),MIN(c.${field}),MAX(c.${field}),
      MAX(0,AVG(c.${field}*c.${field})-AVG(c.${field})*AVG(c.${field})) FROM ${source} c
      JOIN ${isPlayer ? 'PlayerGameFacts' : 'TeamGameFacts'} g ON g.RunId=c.RunId AND g.MatchId=c.MatchId
        AND g.${isPlayer ? 'PlayerId' : 'TeamSubmissionId'}=c.${isPlayer ? 'PlayerId' : 'TeamSubmissionId'}
      JOIN MatchFacts m ON m.RunId=c.RunId AND m.MatchId=c.MatchId WHERE c.RunId=? AND c.Minute=?
      GROUP BY m.SeasonId,g.TeamSubmissionId,${isPlayer ? 'g.PlayerId,g.Membership,' : ''}m.Stage`)
      .run(runId, `${field}At${minute}`, runId, minute);
  }
  // Bounded cohorts: one player's hero/patch/role at a time, not the whole EDW in JS.
  const cohorts = db.prepare(`SELECT m.SeasonId,g.TeamSubmissionId,g.PlayerId,g.HeroId,COALESCE(c.PatchKey,'unknown') PatchKey,
    COALESCE(e.LaneRole,0) LaneRole,m.Stage,g.Membership,COUNT(*) GamesPlayed,SUM(g.Won) Wins
    FROM PlayerGameFacts g JOIN MatchFacts m USING(RunId,MatchId)
    JOIN MatchContextFacts c USING(RunId,MatchId) JOIN PlayerPerformanceFacts e USING(RunId,MatchId,PlayerId)
    WHERE g.RunId=? GROUP BY m.SeasonId,g.TeamSubmissionId,g.PlayerId,g.HeroId,c.PatchKey,e.LaneRole,m.Stage,g.Membership`).all(runId);
  const games = db.prepare(`SELECT g.*,e.* FROM PlayerGameFacts g JOIN PlayerPerformanceFacts e USING(RunId,MatchId,PlayerId)
    JOIN MatchFacts m USING(RunId,MatchId) JOIN MatchContextFacts c USING(RunId,MatchId)
    WHERE g.RunId=? AND m.SeasonId=? AND g.TeamSubmissionId=? AND g.PlayerId=? AND g.HeroId=?
      AND COALESCE(c.PatchKey,'unknown')=? AND COALESCE(e.LaneRole,0)=? AND m.Stage=? AND g.Membership=?`);
  const add = insert(db, 'PlayerHeroPatchStats', ['RunId', 'SeasonId', 'TeamSubmissionId', 'PlayerId', 'HeroId', 'PatchKey', 'LaneRole',
    'Stage', 'Membership', 'GamesPlayed', 'Wins', 'MetricsJson']);
  for (const cohort of cohorts) {
    const rows = games.all(runId, cohort.SeasonId, cohort.TeamSubmissionId, cohort.PlayerId, cohort.HeroId,
      cohort.PatchKey, cohort.LaneRole, cohort.Stage, cohort.Membership);
    const metrics = {};
    for (const metric of [...basicMetrics, ...PLAYER_PERFORMANCE_METRICS]) {
      const values = rows.map(row => nonnegative(row[metric])).filter(value => value !== null), n = values.length;
      const total = n ? values.reduce((sum, value) => sum + value, 0) : null, average = n ? total / n : null;
      metrics[metric] = { samples: n, total: ['GPM','XPM','NetWorth','FinalLevel','DewardsPer10Minutes',
        'DamageShare','HealingShare','NetWorthShare','KillParticipation'].includes(metric) ? null : total,
        average, minimum: n ? Math.min(...values) : null, maximum: n ? Math.max(...values) : null,
        variance: n ? Math.max(0, values.reduce((sum, value) => sum + value * value, 0) / n - average * average) : null };
    }
    add({ RunId: runId, ...cohort, MetricsJson: JSON.stringify(metrics) });
  }
  db.prepare(`INSERT INTO HeroItemStats SELECT ?,m.SeasonId,g.HeroId,COALESCE(c.PatchKey,'unknown'),COALESCE(e.LaneRole,0),
    m.Stage,i.ItemKey,COUNT(*),AVG(i.FirstPurchaseSeconds) FROM PlayerItemTimings i
    JOIN PlayerGameFacts g USING(RunId,MatchId,PlayerId) JOIN PlayerPerformanceFacts e USING(RunId,MatchId,PlayerId)
    JOIN MatchFacts m USING(RunId,MatchId) JOIN MatchContextFacts c USING(RunId,MatchId) WHERE i.RunId=?
    GROUP BY m.SeasonId,g.HeroId,c.PatchKey,e.LaneRole,m.Stage,i.ItemKey`).run(runId, runId);
}

// Private server-to-server contract. These inputs do not activate a pricing model.
export function readWarehouseBettingInputs(db, runId, seasonId) {
  if (!hasTable(db, 'MatchContextFacts') || db.prepare('SELECT Version FROM AnalyticsRuns WHERE RunId=?').get(runId)?.Version < 7)
    return { available: false, featureVersion: WAREHOUSE_FEATURE_VERSION, reason: 'refresh_required' };
  const result = { available: true, featureVersion: WAREHOUSE_FEATURE_VERSION,
    coverage: db.prepare(`SELECT c.EnrichmentStatus,COUNT(*) Matches FROM MatchContextFacts c JOIN MatchFacts m USING(RunId,MatchId)
      WHERE c.RunId=? AND m.SeasonId=? GROUP BY c.EnrichmentStatus`).all(runId, seasonId) };
  for (const [key, table] of [['players', 'PlayerPerformanceStats'], ['teams', 'TeamPerformanceStats'], ['heroContexts', 'PlayerHeroPatchStats']]) {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE RunId=? AND SeasonId=? LIMIT 20001`).all(runId, seasonId);
    if (rows.length > 20000) return { available: false, featureVersion: WAREHOUSE_FEATURE_VERSION, reason: 'input_bound_exceeded' };
    result[key] = rows;
  }
  return result;
}
