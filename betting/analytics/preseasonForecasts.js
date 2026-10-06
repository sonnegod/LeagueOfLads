import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureAnalyticsSchema } from '../../scripts/db/analyticsSchema.js';
import { classifyStandings } from '../../config/leagueRules.js';
import { PLAYER_STATS, REGULAR_PLAYER_MARKETS, regularSchedule } from '../marketCatalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL_VERSION = 'preseason-regular-v1-draft';

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function average(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function stdev(values) {
  const mean = average(values);
  return Math.sqrt(average(values.map(value => (value - mean) ** 2)));
}
function normalizedCounts(counts, draws) {
  const smooth = 0.5;
  const denominator = draws + counts.length * smooth;
  return counts.map(count => (count + smooth) / denominator);
}
function perGame(row, key) {
  const column = PLAYER_STATS.find(stat => stat.key === key).column;
  return Math.max(0, Number(row[column] || 0));
}

function validateSeason(db, seasonId) {
  const season = db.prepare(`SELECT SeasonId, LeagueName, Status FROM LeagueSeasons
    WHERE SeasonId = ?`).get(seasonId);
  if (!season || season.Status !== 'signup_closed') {
    throw new Error('Close signups before generating preseason regular-season forecasts');
  }
  const groups = db.prepare(`SELECT GroupId, GroupName FROM SeasonGroups
    WHERE SeasonId = ? ORDER BY GroupId`).all(seasonId);
  const teams = db.prepare(`SELECT TeamSubmissionId, GroupId, TeamName, IsManual,
    ManualAverageMMR FROM SeasonTeams WHERE SeasonId = ? ORDER BY TeamSubmissionId`).all(seasonId);
  if (!groups.length || !teams.length || teams.some(team => !team.GroupId)) {
    throw new Error('Assign every team to a group before forecasting');
  }
  const groupIds = new Set(groups.map(group => group.GroupId));
  if (teams.some(team => !groupIds.has(team.GroupId))) throw new Error('Invalid team group assignment');
  for (const group of groups) regularSchedule(teams.filter(team => team.GroupId === group.GroupId).length);
  const players = db.prepare(`SELECT stp.TeamSubmissionId, stp.PlayerId, stp.MMR,
    COALESCE(CAST(pi.PlayerName AS TEXT), 'Player ' || stp.PlayerId) AS PlayerName
    FROM SeasonTeamPlayers stp JOIN SeasonTeams st ON st.TeamSubmissionId = stp.TeamSubmissionId
    LEFT JOIN PlayerInfo pi ON pi.PlayerId = stp.PlayerId
    WHERE st.SeasonId = ? ORDER BY stp.TeamSubmissionId, stp.PlayerId`).all(seasonId);
  const seen = new Set();
  for (const player of players) {
    if (seen.has(player.PlayerId)) throw new Error(`Player ${player.PlayerId} appears on multiple teams`);
    seen.add(player.PlayerId);
    if (!Number.isSafeInteger(player.MMR) || player.MMR <= 0) throw new Error('Invalid signup MMR');
  }
  for (const team of teams) {
    const roster = players.filter(player => player.TeamSubmissionId === team.TeamSubmissionId);
    if (team.IsManual ? roster.length || !(team.ManualAverageMMR > 0) : roster.length !== 5) {
      throw new Error(`Team ${team.TeamSubmissionId} has an invalid roster or MMR`);
    }
  }
  const rules = db.prepare('SELECT * FROM SeasonLeagueRules WHERE SeasonId = ?').get(seasonId)
    || { UpperBracketTeams: 2, LowerBracketTeams: 5, EliminatedTeams: 2,
      HasTiebreaker: 1, TiebreakerPosition: 3 };
  return { season, groups, teams, players, rules };
}

function prepareFeatures(source, publicDb, roster, cutoff) {
  const date = cutoff.slice(0, 10);
  const since = new Date(new Date(cutoff).getTime() - 30 * 86400000).toISOString();
  const leagueRows = source.prepare(`SELECT mp.PlayerId, mp.MatchId, mp.Kills, mp.Deaths,
    mp.Assists, mp.GPM, mp.XPM, mp.Lasthits, mp.Winner
    FROM MatchPlayer mp JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
    WHERE ml.DatePlayed IS NULL OR ml.DatePlayed <= ?
    ORDER BY mp.PlayerId, mp.MatchId`).all(date);
  if (!leagueRows.length) throw new Error('No prior league match stats are available');
  const publicRows = publicDb.prepare(`SELECT PlayerId, MatchId, Kills, Deaths,
    Assists, Won, HeroId, DateCreated FROM PublicMatchPlayer
    WHERE DateCreated >= ? AND DateCreated <= ? ORDER BY PlayerId, MatchId`).all(since, cutoff);
  const byLeague = new Map();
  const byPublic = new Map();
  for (const row of leagueRows) {
    if (!byLeague.has(row.PlayerId)) byLeague.set(row.PlayerId, []);
    byLeague.get(row.PlayerId).push(row);
  }
  for (const row of publicRows) {
    if (!byPublic.has(row.PlayerId)) byPublic.set(row.PlayerId, []);
    byPublic.get(row.PlayerId).push(row);
  }
  const features = roster.players.map(player => {
    const league = byLeague.get(player.PlayerId) || [];
    const recent = byPublic.get(player.PlayerId) || [];
    return { ...player, league, recent,
      priorWins: league.filter(row => row.Winner === 1).length,
      recentWins: recent.filter(row => row.Won === 1).length,
      confidence: clamp(0.25 + 0.45 * Math.min(league.length / 30, 1) +
        0.15 * Math.min(recent.length / 30, 1), 0.25, 0.85) };
  });
  return { features, leagueRows, publicRows, since };
}

function simulatePlayerMarkets(roster, features, priorPool, iterations, random) {
  const counts = new Map(REGULAR_PLAYER_MARKETS.map(market => [market.key,
    new Float64Array(features.length)]));
  const pools = features.map(feature => ({ league: feature.league.length ? feature.league : priorPool,
    recent: feature.recent, publicWeight: Math.min(0.25,
      feature.recent.length / (feature.recent.length + 20)) }));
  const teamById = new Map(roster.teams.map(team => [team.TeamSubmissionId, team]));
  const groupSizes = new Map(roster.groups.map(group => [group.GroupId,
    roster.teams.filter(team => team.GroupId === group.GroupId).length]));
  const maps = features.map(feature => regularSchedule(groupSizes.get(
    teamById.get(feature.TeamSubmissionId).GroupId)).maps);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const scores = new Map(REGULAR_PLAYER_MARKETS.map(market => [market.key,
      new Float64Array(features.length)]));
    for (let i = 0; i < features.length; i += 1) {
      const totals = Object.fromEntries(PLAYER_STATS.map(stat => [stat.key, 0]));
      const highs = Object.fromEntries(PLAYER_STATS.map(stat => [stat.key, 0]));
      const pool = pools[i];
      for (let game = 0; game < maps[i]; game += 1) {
        const league = pool.league[Math.floor(random() * pool.league.length)];
        const recent = pool.recent.length && random() < pool.publicWeight
          ? pool.recent[Math.floor(random() * pool.recent.length)] : null;
        for (const stat of PLAYER_STATS) {
          const value = perGame(recent && ['kills', 'deaths', 'assists'].includes(stat.key)
            ? recent : league, stat.key);
          totals[stat.key] += value;
          if (value > highs[stat.key]) highs[stat.key] = value;
        }
      }
      for (const market of REGULAR_PLAYER_MARKETS) {
        scores.get(market.key)[i] = market.aggregate === 'total' ? totals[market.stat]
          : market.aggregate === 'average' ? totals[market.stat] / maps[i] : highs[market.stat];
      }
    }
    for (const market of REGULAR_PLAYER_MARKETS) {
      const values = scores.get(market.key);
      const best = Math.max(...values);
      const tied = [];
      for (let i = 0; i < values.length; i += 1) if (Math.abs(values[i] - best) < 1e-9) tied.push(i);
      for (const i of tied) counts.get(market.key)[i] += 1 / tied.length;
    }
  }
  const forecasts = [];
  for (const market of REGULAR_PLAYER_MARKETS) {
    const probabilities = normalizedCounts(counts.get(market.key), iterations);
    for (let i = 0; i < features.length; i += 1) forecasts.push({
      marketKey: market.key, outcomeKey: `player:${features[i].PlayerId}`,
      teamId: features[i].TeamSubmissionId, probability: probabilities[i],
      confidence: features[i].confidence,
    });
  }
  return forecasts;
}

function simulateTeamMarkets(roster, iterations, random) {
  const teamIndex = new Map(roster.teams.map((team, index) => [team.TeamSubmissionId, index]));
  const groupWins = new Float64Array(roster.teams.length);
  const qualified = new Float64Array(roster.teams.length);
  const champions = new Float64Array(roster.teams.length);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const qualifiers = [];
    for (const group of roster.groups) {
      const teams = roster.teams.filter(team => team.GroupId === group.GroupId);
      const wins = new Map(teams.map(team => [team.TeamSubmissionId, 0]));
      for (let i = 0; i < teams.length; i += 1) for (let j = i + 1; j < teams.length; j += 1) {
        const p = 1 / (1 + Math.exp(-(teams[i].averageMMR - teams[j].averageMMR) / 500));
        for (let game = 0; game < 2; game += 1) {
          const winner = random() < p ? teams[i] : teams[j];
          wins.set(winner.TeamSubmissionId, wins.get(winner.TeamSubmissionId) + 1);
        }
      }
      const ranked = teams.map(team => ({ ...team, wins: wins.get(team.TeamSubmissionId), tie: random() }))
        .sort((a, b) => b.wins - a.wins || a.tie - b.tie);
      groupWins[teamIndex.get(ranked[0].TeamSubmissionId)] += 1;
      for (const team of classifyStandings(ranked, roster.rules)) {
        if (team.Qualification === 'eliminated') continue;
        qualified[teamIndex.get(team.TeamSubmissionId)] += 1;
        qualifiers.push(team);
      }
    }
    if (!qualifiers.length) throw new Error('Rules eliminate every team');
    const weights = qualifiers.map(team => Math.exp(clamp((team.averageMMR - 6500) / 500, -8, 8)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let target = random() * total;
    for (let i = 0; i < qualifiers.length; i += 1) {
      target -= weights[i];
      if (target <= 0 || i === qualifiers.length - 1) {
        champions[teamIndex.get(qualifiers[i].TeamSubmissionId)] += 1;
        break;
      }
    }
  }
  const forecasts = [];
  for (const group of roster.groups) {
    const teams = roster.teams.filter(team => team.GroupId === group.GroupId);
    const probabilities = normalizedCounts(teams.map(team =>
      groupWins[teamIndex.get(team.TeamSubmissionId)]), iterations);
    teams.forEach((team, i) => forecasts.push({
      marketKey: `regular:group_winner:${group.GroupId}`,
      outcomeKey: `team_submission:${team.TeamSubmissionId}`, teamId: team.TeamSubmissionId,
      probability: probabilities[i], confidence: 0.45,
    }));
  }
  roster.teams.forEach((team, i) => {
    const p = (qualified[i] + 0.5) / (iterations + 1);
    for (const [outcomeKey, probability] of [['qualify', p], ['eliminated', 1 - p]]) {
      forecasts.push({ marketKey: `regular:playoffs_vs_eliminated:${team.TeamSubmissionId}`,
        outcomeKey, teamId: team.TeamSubmissionId, probability, confidence: 0.4 });
    }
  });
  const championProbabilities = normalizedCounts([...champions], iterations);
  roster.teams.forEach((team, i) => forecasts.push({
    marketKey: 'season:champion', outcomeKey: `team_submission:${team.TeamSubmissionId}`,
    teamId: team.TeamSubmissionId, probability: championProbabilities[i], confidence: 0.25,
  }));
  return forecasts;
}

export function buildPreseasonForecasts({
  seasonId, ladsPath = path.join(root, 'db/LadsData.db'),
  publicPath = path.join(root, 'db/public.db'),
  analyticsPath = path.join(root, 'db/Analytics.db'),
  asOf = new Date().toISOString(), simulations = 2000,
} = {}) {
  if (!Number.isSafeInteger(seasonId) || seasonId <= 0) throw new Error('Pass a positive seasonId');
  if (!Number.isSafeInteger(simulations) || simulations < 100 || simulations > 20000) {
    throw new Error('simulations must be between 100 and 20000');
  }
  const cutoff = new Date(asOf);
  if (Number.isNaN(cutoff.getTime())) throw new Error('asOf must be a valid date');
  const timestamp = cutoff.toISOString();
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let publicDb;
  let analytics;
  try {
    publicDb = new Database(publicPath, { readonly: true, fileMustExist: true });
    analytics = new Database(analyticsPath);
    ensureAnalyticsSchema(analytics);
    const roster = validateSeason(lads, seasonId);
    const source = prepareFeatures(lads, publicDb, roster, timestamp);
    for (const team of roster.teams) {
      const mmrs = source.features.filter(player => player.TeamSubmissionId === team.TeamSubmissionId)
        .map(player => player.MMR);
      team.averageMMR = team.IsManual ? Number(team.ManualAverageMMR) : average(mmrs);
      team.mmrStdDev = team.IsManual ? null : stdev(mmrs);
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ seasonId, roster,
      leagueRows: source.leagueRows, publicRows: source.publicRows, date: timestamp.slice(0, 10),
      simulations, version: MODEL_VERSION })).digest('hex');
    const runKey = `preseason:${seasonId}:${MODEL_VERSION}:${fingerprint}`;
    const existing = analytics.prepare('SELECT RunId, Status FROM AnalyticsRuns WHERE RunKey = ?').get(runKey);
    if (existing) {
      if (existing.Status !== 'complete') throw new Error('Matching analytics run is incomplete');
      return { runId: existing.RunId, runKey, reused: true,
        forecasts: analytics.prepare('SELECT COUNT(*) AS n FROM ModelForecasts WHERE RunId = ?')
          .get(existing.RunId).n };
    }
    const random = makeRandom(Number.parseInt(fingerprint.slice(0, 8), 16));
    const playerForecasts = simulatePlayerMarkets(roster, source.features, source.leagueRows,
      simulations, random);
    const teamForecasts = simulateTeamMarkets(roster, simulations, random);
    const forecasts = [...playerForecasts, ...teamForecasts];
    const dataCutoff = source.leagueRows.length
      ? lads.prepare('SELECT MAX(DatePlayed) AS LastDate FROM MatchLeague WHERE DatePlayed <= ?')
        .get(timestamp.slice(0, 10)).LastDate : null;
    const publicCutoff = source.publicRows.reduce((latest, row) =>
      !latest || row.DateCreated > latest ? row.DateCreated : latest, null);
    const create = analytics.transaction(() => {
      const runId = analytics.prepare(`INSERT INTO AnalyticsRuns
        (RunKey, SeasonId, CutoffAt, PublicDataCutoffAt, LeagueDataCutoffAt,
         ModelVersion, RosterFingerprint, CreatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(runKey, seasonId, timestamp, publicCutoff, dataCutoff,
          MODEL_VERSION, fingerprint, new Date().toISOString()).lastInsertRowid;
      const insertTeam = analytics.prepare(`INSERT INTO PreseasonTeamFeatures
        (RunId, TeamSubmissionId, TeamName, IsManual, RosterSize, MMRSource,
         AverageMMR, MMRStdDev, PriorLeagueGames, RecentPublicGames, StrengthScore, Confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const team of roster.teams) {
        const players = source.features.filter(player => player.TeamSubmissionId === team.TeamSubmissionId);
        insertTeam.run(runId, team.TeamSubmissionId, team.TeamName, team.IsManual,
          players.length, team.IsManual ? 'manual' : 'roster', team.averageMMR,
          team.mmrStdDev, players.reduce((sum, player) => sum + player.league.length, 0),
          players.reduce((sum, player) => sum + player.recent.length, 0),
          team.averageMMR, players.length ? average(players.map(player => player.confidence)) : 0.25);
      }
      const insertPlayer = analytics.prepare(`INSERT INTO PreseasonPlayerFeatures
        (RunId, TeamSubmissionId, PlayerId, PlayerName, SignupMMR, PriorLeagueGames,
         PriorLeagueWins, PriorLeagueAvgGPM, PriorLeagueAvgLastHits,
         RecentPublicGames, RecentPublicWins, RecentPublicKills,
         RecentPublicDeaths, RecentPublicAssists, RecentPublicHeroCount, Confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const player of source.features) insertPlayer.run(runId, player.TeamSubmissionId,
        player.PlayerId, player.PlayerName, player.MMR, player.league.length, player.priorWins,
        player.league.length ? average(player.league.map(row => Number(row.GPM || 0))) : null,
        player.league.length ? average(player.league.map(row => Number(row.Lasthits || 0))) : null,
        player.recent.length, player.recentWins,
        player.recent.reduce((sum, row) => sum + Number(row.Kills || 0), 0),
        player.recent.reduce((sum, row) => sum + Number(row.Deaths || 0), 0),
        player.recent.reduce((sum, row) => sum + Number(row.Assists || 0), 0),
        new Set(player.recent.map(row => row.HeroId).filter(Boolean)).size, player.confidence);
      const insertForecast = analytics.prepare(`INSERT INTO ModelForecasts
        (RunId, MarketKey, OutcomeKey, TeamSubmissionId, FairProbability,
         SuggestedDecimalOdds, Confidence, GeneratedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const forecast of forecasts) insertForecast.run(runId, forecast.marketKey,
        forecast.outcomeKey, forecast.teamId, forecast.probability,
        1 / forecast.probability, forecast.confidence, timestamp);
      analytics.prepare(`UPDATE AnalyticsRuns SET Status = 'complete', CompletedAt = ?
        WHERE RunId = ?`).run(new Date().toISOString(), runId);
      return runId;
    });
    return { runId: create(), runKey, reused: false, seasonId,
      teams: roster.teams.length, players: source.features.length,
      groupSchedule: roster.groups.map(group => ({ groupId: group.GroupId,
        ...regularSchedule(groupSizesFor(roster, group.GroupId)) })),
      forecasts: forecasts.length };
  } finally {
    analytics?.close();
    publicDb?.close();
    lads.close();
  }
}

function groupSizesFor(roster, groupId) {
  return roster.teams.filter(team => team.GroupId === groupId).length;
}
