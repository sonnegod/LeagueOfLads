import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureAnalyticsSchema } from './analyticsSchema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = 'historical-bootstrap-v4-phases';
const phases = [
  { key: 'regular', stage: 'g', maxProjectedGames: 35 },
  { key: 'playoffs', stage: 'p', maxProjectedGames: 16 },
];
const metrics = [
  { key: 'season_kills', field: 'Kills', mode: 'sum', public: true },
  { key: 'season_deaths', field: 'Deaths', mode: 'sum', public: true },
  { key: 'season_assists', field: 'Assists', mode: 'sum', public: true },
  { key: 'game_kills', field: 'Kills', mode: 'max', public: true },
  { key: 'game_deaths', field: 'Deaths', mode: 'max', public: true },
  { key: 'game_assists', field: 'Assists', mode: 'max', public: true },
  { key: 'game_gpm', field: 'GPM', mode: 'max', public: false },
  { key: 'average_gpm', field: 'GPM', mode: 'average', public: false },
];

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function mean(rows, field) {
  return rows.length ? rows.reduce((sum, row) => sum + Number(row[field] || 0), 0) / rows.length : null;
}

function round(value, places = 3) {
  return Number(value.toFixed(places));
}

export function buildSamplePlayerModel({
  ladsPath = path.join(root, 'db/LadsData.db'),
  publicPath = path.join(root, 'db/public.db'),
  analyticsPath = path.join(root, 'db/Analytics.db'),
  sourceLeagueId = null,
  asOf = new Date().toISOString(),
  minimumLeagueGames = 5,
  minimumPlayoffGames = 2,
  simulations = 2000,
} = {}) {
  const cutoff = new Date(asOf);
  if (Number.isNaN(cutoff.getTime())) throw new Error('asOf must be a valid date');
  if (!Number.isSafeInteger(minimumLeagueGames) || minimumLeagueGames < 1) {
    throw new Error('minimumLeagueGames must be a positive integer');
  }
  if (!Number.isSafeInteger(minimumPlayoffGames) || minimumPlayoffGames < 1) {
    throw new Error('minimumPlayoffGames must be a positive integer');
  }
  if (!Number.isSafeInteger(simulations) || simulations < 1 || simulations > 20000) {
    throw new Error('simulations must be between 1 and 20000');
  }
  if (sourceLeagueId !== null && (!Number.isSafeInteger(sourceLeagueId) || sourceLeagueId < 1)) {
    throw new Error('sourceLeagueId must be a positive integer');
  }
  const timestamp = cutoff.toISOString();
  const since = new Date(cutoff.getTime() - 30 * 86400000).toISOString();
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let publicDb;
  let analytics;
  try {
    publicDb = new Database(publicPath, { readonly: true, fileMustExist: true });
    analytics = new Database(analyticsPath);
    ensureAnalyticsSchema(analytics);
    const league = sourceLeagueId === null
      ? lads.prepare(`SELECT li.LeagueId, li.LeagueName FROM LeagueInfo li
        JOIN MatchLeague ml ON ml.LeagueId = li.LeagueId
        WHERE li.Active = 0 AND ml.DatePlayed <= ?
        GROUP BY li.LeagueId ORDER BY MAX(ml.DatePlayed) DESC, li.LeagueId DESC LIMIT 1`)
        .get(timestamp.slice(0, 10))
      : lads.prepare('SELECT LeagueId, LeagueName FROM LeagueInfo WHERE LeagueId = ?')
        .get(sourceLeagueId);
    if (!league) throw new Error('No completed league with dated matches was found');
    const boundary = lads.prepare(`SELECT GroupEndMatchId, TieBreakerEndMatchId
      FROM LeagueStageBoundaries WHERE LeagueId = ?`).get(league.LeagueId);
    const leagueRows = lads.prepare(`SELECT mp.PlayerId,
      COALESCE(CAST(pi.PlayerName AS TEXT), 'Player ' || mp.PlayerId) AS PlayerName,
      mp.MatchId, mp.Kills, mp.Deaths, mp.Assists, mp.GPM,
      (SELECT si.Stage FROM SeriesMatch sm JOIN SeriesInfo si ON si.SeriesId = sm.SeriesId
        WHERE sm.MatchId = mp.MatchId LIMIT 1) AS Stage
      FROM MatchPlayer mp JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
      LEFT JOIN PlayerInfo pi ON pi.PlayerId = mp.PlayerId
      WHERE ml.LeagueId = ? AND (ml.DatePlayed IS NULL OR ml.DatePlayed <= ?)
        AND mp.PlayerId > 0 ORDER BY mp.PlayerId, mp.MatchId`)
      .all(league.LeagueId, timestamp.slice(0, 10));
    const byPlayer = new Map();
    const classifiedRows = [];
    for (const row of leagueRows) {
      const stage = row.Stage || (boundary?.GroupEndMatchId && row.MatchId <= boundary.GroupEndMatchId
        ? 'g' : boundary?.TieBreakerEndMatchId && row.MatchId <= boundary.TieBreakerEndMatchId
          ? 't' : (boundary?.TieBreakerEndMatchId || boundary?.GroupEndMatchId) &&
            row.MatchId > (boundary.TieBreakerEndMatchId || boundary.GroupEndMatchId) ? 'p' : null);
      if (stage !== 'g' && stage !== 'p') continue; // Tiebreakers are neither market.
      if (!byPlayer.has(row.PlayerId)) byPlayer.set(row.PlayerId, {
        id: row.PlayerId, name: row.PlayerName, regular: [], playoffs: [], public: [],
      });
      byPlayer.get(row.PlayerId)[stage === 'g' ? 'regular' : 'playoffs'].push(row);
      classifiedRows.push({ ...row, Stage: stage });
    }
    const playersByPhase = {
      regular: [...byPlayer.values()].filter(player => player.regular.length >= minimumLeagueGames)
        .sort((a, b) => a.id - b.id),
      playoffs: [...byPlayer.values()].filter(player => player.playoffs.length >= minimumPlayoffGames)
        .sort((a, b) => a.id - b.id),
    };
    if (!playersByPhase.regular.length && !playersByPhase.playoffs.length) {
      throw new Error('No players meet the phase-specific league-game samples');
    }
    const eligible = new Set([...playersByPhase.regular, ...playersByPhase.playoffs].map(player => player.id));
    const publicRows = publicDb.prepare(`SELECT PlayerId, MatchId, Kills, Deaths, Assists
      FROM PublicMatchPlayer WHERE DateCreated >= ? AND DateCreated <= ?
      ORDER BY PlayerId, MatchId`).all(since, timestamp);
    for (const row of publicRows) {
      if (eligible.has(row.PlayerId)) byPlayer.get(row.PlayerId).public.push(row);
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ league: league.LeagueId,
      date: timestamp.slice(0, 10), minimumLeagueGames, minimumPlayoffGames, simulations,
      leagueRows: classifiedRows, publicRows: publicRows.filter(row => eligible.has(row.PlayerId)) }))
      .digest('hex');
    const runKey = `sample:${version}:${league.LeagueId}:${fingerprint}`;
    const existing = analytics.prepare('SELECT SampleRunId FROM SampleModelRuns WHERE RunKey = ?').get(runKey);
    if (existing) return sampleSummary(analytics, existing.SampleRunId, true);

    const random = randomGenerator(Number.parseInt(fingerprint.slice(0, 8), 16));
    const forecasts = [];
    for (const phase of phases) {
      const players = playersByPhase[phase.key];
      if (!players.length) continue;
      for (const metric of metrics) {
        const wins = new Float64Array(players.length);
        const values = new Float64Array(players.length);
        const projectedGames = players.map(player => Math.min(phase.maxProjectedGames,
          player[phase.key].length));
        const usePublic = metric.public ? players.map(player => Math.min(0.25,
          player.public.length / (player.public.length + 20))) : [];
        for (let sim = 0; sim < simulations; sim += 1) {
          const scores = new Float64Array(players.length);
          let best = -Infinity;
          for (let i = 0; i < players.length; i += 1) {
            const player = players[i];
            let total = 0;
            let highest = 0;
            for (let game = 0; game < projectedGames[i]; game += 1) {
              const rows = metric.public && player.public.length && random() < usePublic[i]
                ? player.public : player[phase.key];
              const value = Number(rows[Math.floor(random() * rows.length)][metric.field] || 0);
              total += value;
              if (value > highest) highest = value;
            }
            const score = metric.mode === 'max' ? highest
              : metric.mode === 'average' ? total / projectedGames[i] : total;
            scores[i] = score;
            values[i] += score;
            if (score > best) best = score;
          }
          const tied = [];
          for (let i = 0; i < scores.length; i += 1) {
            if (Math.abs(scores[i] - best) < 1e-9) tied.push(i);
          }
          for (const i of tied) wins[i] += 1 / tied.length;
        }
        const ranked = players.map((player, i) => {
          const probability = wins[i] / simulations;
          return { Phase: phase.key, MetricKey: `${phase.key}:${metric.key}`,
            PlayerId: player.id, PlayerName: player.name,
            PriorLeagueGames: player[phase.key].length, RecentPublicGames: player.public.length,
            ProjectedGames: projectedGames[i],
            LeaguePerGame: round(mean(player[phase.key], metric.field)),
            PublicPerGame: metric.public && player.public.length
              ? round(mean(player.public, metric.field)) : null,
            ProjectedValue: round(values[i] / simulations, 2),
            WinProbability: round(probability, 6),
            IllustrativeFairOdds: probability > 0 ? round(1 / probability, 2) : null,
          };
        }).sort((a, b) => b.WinProbability - a.WinProbability ||
          b.ProjectedValue - a.ProjectedValue || a.PlayerId - b.PlayerId);
        ranked.forEach((row, index) => forecasts.push({ ...row, Rank: index + 1 }));
      }
    }

    const create = analytics.transaction(() => {
      const runId = analytics.prepare(`INSERT INTO SampleModelRuns
        (RunKey, SourceLeagueId, SourceLeagueName, AsOf, ModelVersion,
         MinimumLeagueGames, MinimumPlayoffGames, Simulations, EligiblePlayers,
         Assumption, CreatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(runKey, league.LeagueId, league.LeagueName, timestamp, version,
          minimumLeagueGames, minimumPlayoffGames, simulations, eligible.size,
          `Historical cohort only. Regular season uses group-stage games (minimum ${minimumLeagueGames}, up to 35 projected); playoffs use playoff games (minimum ${minimumPlayoffGames}, up to 16 projected). Tiebreakers excluded. Recent public KDA weighted at most 25%. No signup roster or calibrated participation model.`,
          new Date().toISOString()).lastInsertRowid;
      const insert = analytics.prepare(`INSERT INTO SamplePlayerForecasts
        (SampleRunId, Phase, MetricKey, PlayerId, PlayerName, PriorLeagueGames,
         RecentPublicGames, ProjectedGames, LeaguePerGame, PublicPerGame,
         ProjectedValue, WinProbability, IllustrativeFairOdds, Rank)
        VALUES (@SampleRunId, @Phase, @MetricKey, @PlayerId, @PlayerName, @PriorLeagueGames,
         @RecentPublicGames, @ProjectedGames, @LeaguePerGame, @PublicPerGame,
         @ProjectedValue, @WinProbability, @IllustrativeFairOdds, @Rank)`);
      for (const row of forecasts) insert.run({ ...row, SampleRunId: runId });
      return runId;
    });
    return sampleSummary(analytics, create(), false);
  } finally {
    analytics?.close();
    publicDb?.close();
    lads.close();
  }
}

function sampleSummary(db, runId, reused) {
  const run = db.prepare(`SELECT SampleRunId AS sampleRunId, SourceLeagueId AS sourceLeagueId,
    SourceLeagueName AS sourceLeagueName, AsOf AS asOf, ModelVersion AS modelVersion,
    EligiblePlayers AS eligiblePlayers, Simulations AS simulations,
    MinimumLeagueGames AS minimumRegularGames,
    MinimumPlayoffGames AS minimumPlayoffGames,
    Assumption AS assumption FROM SampleModelRuns WHERE SampleRunId = ?`).get(runId);
  const top = {};
  const eligibleByPhase = {};
  for (const phase of phases) {
    top[phase.key] = {};
    eligibleByPhase[phase.key] = db.prepare(`SELECT COUNT(*) AS n FROM SamplePlayerForecasts
      WHERE SampleRunId = ? AND Phase = ? AND MetricKey = ?`).get(
      runId, phase.key, `${phase.key}:${metrics[0].key}`).n;
    for (const metric of metrics) {
      top[phase.key][metric.key] = db.prepare(`SELECT PlayerId AS playerId,
        PlayerName AS playerName, PriorLeagueGames AS priorLeagueGames,
        RecentPublicGames AS recentPublicGames, ProjectedGames AS projectedGames,
        ProjectedValue AS projectedValue, WinProbability AS winProbability,
        IllustrativeFairOdds AS illustrativeFairOdds
        FROM SamplePlayerForecasts WHERE SampleRunId = ? AND Phase = ? AND MetricKey = ?
        ORDER BY Rank LIMIT 5`).all(runId, phase.key, `${phase.key}:${metric.key}`);
    }
  }
  return { ...run, reused, eligibleByPhase, top };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sourceLeagueId = process.argv[2] ? Number(process.argv[2]) : null;
    console.log(JSON.stringify(buildSamplePlayerModel({ sourceLeagueId }), null, 2));
  } catch (error) {
    console.error('Sample player model failed:', error);
    process.exitCode = 1;
  }
}
