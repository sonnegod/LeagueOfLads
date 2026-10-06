import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureAnalyticsSchema } from '../../scripts/db/analyticsSchema.js';
import { PLAYER_STATS, PLAYOFF_PLAYER_MARKETS } from '../marketCatalog.js';
import { preparePlayoffBracket, simulatePlayoffBracket } from './playoffBracketModel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VERSION = 'playoff-bracket-v1-draft';
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function randomFrom(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function probability(count, trials, choices) { return (count + 0.5) / (trials + choices * 0.5); }

export function buildPlayoffForecasts({ seasonId,
  ladsPath = path.join(root, 'db/LadsData.db'),
  publicPath = path.join(root, 'db/public.db'),
  analyticsPath = path.join(root, 'db/Analytics.db'),
  asOf = new Date().toISOString(), simulations = 2000,
} = {}) {
  if (!Number.isSafeInteger(seasonId) || seasonId <= 0 ||
    !Number.isSafeInteger(simulations) || simulations < 100 || simulations > 20000) {
    throw new Error('Pass a season ID and 100-20000 simulations');
  }
  const date = new Date(asOf);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid forecast cutoff');
  const cutoff = date.toISOString();
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let publicDb;
  let analytics;
  try {
    publicDb = new Database(publicPath, { readonly: true, fileMustExist: true });
    analytics = new Database(analyticsPath);
    ensureAnalyticsSchema(analytics);
    const season = lads.prepare(`SELECT Status, ExternalLeagueId FROM LeagueSeasons
      WHERE SeasonId = ?`).get(seasonId);
    if (season?.Status !== 'active' || !season.ExternalLeagueId) {
      throw new Error('Playoff forecasts require an active league season');
    }
    const boundary = lads.prepare(`SELECT GroupEndMatchId, TieBreakerEndMatchId
      FROM LeagueStageBoundaries WHERE LeagueId = ?`).get(season.ExternalLeagueId);
    if (!Number.isSafeInteger(boundary?.GroupEndMatchId) ||
      !Number.isSafeInteger(boundary?.TieBreakerEndMatchId) ||
      boundary.TieBreakerEndMatchId < boundary.GroupEndMatchId) {
      throw new Error('Playoff stage boundaries are not final');
    }
    const seededRows = lads.prepare(`SELECT TeamId, Seed, Bracket FROM PlayoffSeeding
      WHERE LeagueId = ? ORDER BY TeamId, Seed, Bracket`).all(season.ExternalLeagueId);
    const seeded = new Map();
    for (const seed of seededRows) {
      if (!['upper', 'lower'].includes(seed.Bracket) || !Number.isSafeInteger(seed.Seed) || seed.Seed < 1) {
        throw new Error('Invalid playoff seed');
      }
      const old = seeded.get(seed.TeamId);
      if (old && (old.Seed !== seed.Seed || old.Bracket !== seed.Bracket)) {
        throw new Error(`Conflicting playoff seed for team ${seed.TeamId}`);
      }
      seeded.set(seed.TeamId, seed);
    }
    if (seeded.size < 4) throw new Error('At least four playoff teams are required');
    const teams = lads.prepare(`SELECT TeamSubmissionId, TeamName, ExternalTeamId,
      IsManual, ManualAverageMMR FROM SeasonTeams WHERE SeasonId = ?
      ORDER BY TeamSubmissionId`).all(seasonId).filter(team => seeded.has(team.ExternalTeamId));
    if (teams.length !== seeded.size || teams.some(team => team.IsManual)) {
      throw new Error('Every seeded team needs one mapped five-player season roster');
    }
    const players = lads.prepare(`SELECT p.TeamSubmissionId, p.PlayerId, p.MMR,
      COALESCE(CAST(i.PlayerName AS TEXT), 'Player ' || p.PlayerId) AS PlayerName
      FROM SeasonTeamPlayers p JOIN SeasonTeams st ON st.TeamSubmissionId = p.TeamSubmissionId
      LEFT JOIN PlayerInfo i ON i.PlayerId = p.PlayerId
      WHERE st.SeasonId = ? ORDER BY p.TeamSubmissionId, p.PlayerId`).all(seasonId)
      .filter(player => teams.some(team => team.TeamSubmissionId === player.TeamSubmissionId));
    if (new Set(players.map(player => player.PlayerId)).size !== players.length ||
      teams.some(team => players.filter(player => player.TeamSubmissionId === team.TeamSubmissionId)
        .length !== 5) || players.some(player => !Number.isSafeInteger(player.MMR) || player.MMR <= 0)) {
      throw new Error('Playoff roster has missing or duplicate players or ratings');
    }
    const bracketJson = lads.prepare(`SELECT PlayoffStructure FROM PlayoffBracket
      WHERE LeagueId = ?`).get(season.ExternalLeagueId)?.PlayoffStructure;
    const nodes = preparePlayoffBracket(bracketJson, [...seeded.keys()]);
    const bracketFingerprint = createHash('sha256').update(JSON.stringify({
      boundary, seededRows, bracketJson })).digest('hex');
    const groupMaps = lads.prepare(`SELECT mt.TeamRad, mt.TeamDire, mt.WinnerId
      FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
      WHERE ml.LeagueId = ? AND mt.MatchId <= ? AND mt.Rehost = 0`)
      .all(season.ExternalLeagueId, boundary.GroupEndMatchId);
    const wins = new Map([...seeded.keys()].map(id => [id, 0]));
    const games = new Map([...seeded.keys()].map(id => [id, 0]));
    for (const match of groupMaps) {
      for (const id of [match.TeamRad, match.TeamDire]) {
        if (games.has(id)) games.set(id, games.get(id) + 1);
      }
      if (wins.has(match.WinnerId)) wins.set(match.WinnerId, wins.get(match.WinnerId) + 1);
    }
    for (const team of teams) {
      const roster = players.filter(player => player.TeamSubmissionId === team.TeamSubmissionId);
      team.averageMMR = mean(roster.map(player => player.MMR));
      // Shrunk group-stage performance keeps an undefeated small sample from
      // overwhelming the roster rating. This is a draft heuristic, not calibrated odds.
      const played = games.get(team.ExternalTeamId);
      const margin = 2 * wins.get(team.ExternalTeamId) - played;
      team.strength = team.averageMMR + 80 * margin / Math.max(played, 4);
    }
    const leagueRows = lads.prepare(`SELECT mp.PlayerId, mp.MatchId, mp.Kills, mp.Deaths,
      mp.Assists, mp.GPM, mp.XPM, ml.DatePlayed FROM MatchPlayer mp
      JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
      WHERE (ml.DatePlayed IS NULL OR ml.DatePlayed <= ?)
        AND (ml.LeagueId <> ? OR mp.MatchId <= ?)
      ORDER BY mp.PlayerId, mp.MatchId`).all(cutoff.slice(0, 10),
      season.ExternalLeagueId, boundary.TieBreakerEndMatchId);
    if (!leagueRows.length) throw new Error('No league player history for playoff props');
    const since = new Date(date.getTime() - 30 * 86400000).toISOString();
    const publicRows = publicDb.prepare(`SELECT PlayerId, MatchId, Kills, Deaths,
      Assists, DateCreated FROM PublicMatchPlayer
      WHERE DateCreated >= ? AND DateCreated <= ? ORDER BY PlayerId, MatchId`)
      .all(since, cutoff);
    const leagueByPlayer = new Map();
    const publicByPlayer = new Map();
    for (const row of leagueRows) {
      if (!leagueByPlayer.has(row.PlayerId)) leagueByPlayer.set(row.PlayerId, []);
      leagueByPlayer.get(row.PlayerId).push(row);
    }
    for (const row of publicRows) {
      if (!publicByPlayer.has(row.PlayerId)) publicByPlayer.set(row.PlayerId, []);
      publicByPlayer.get(row.PlayerId).push(row);
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ seasonId, cutoff,
      boundary, seededRows, teams, players, bracketJson, groupMaps, leagueRows,
      publicRows, simulations, version: VERSION })).digest('hex');
    const runKey = `playoffs:${seasonId}:${VERSION}:${bracketFingerprint}:${fingerprint}`;
    const existing = analytics.prepare('SELECT RunId, Status FROM AnalyticsRuns WHERE RunKey = ?')
      .get(runKey);
    if (existing) {
      if (existing.Status !== 'complete') throw new Error('Matching playoff run is incomplete');
      return { runId: existing.RunId, runKey, reused: true,
        forecasts: analytics.prepare('SELECT COUNT(*) AS n FROM ModelForecasts WHERE RunId = ?')
          .get(existing.RunId).n };
    }
    const random = randomFrom(Number.parseInt(fingerprint.slice(0, 8), 16));
    const strengths = new Map(teams.map(team => [String(team.ExternalTeamId), team.strength]));
    const championCounts = new Map(teams.map(team => [team.TeamSubmissionId, 0]));
    const counts = new Map(PLAYOFF_PLAYER_MARKETS.map(market => [market.key,
      new Float64Array(players.length)]));
    const teamBySubmission = new Map(teams.map(team => [team.TeamSubmissionId, team]));
    const pools = players.map(player => ({
      league: leagueByPlayer.get(player.PlayerId) || leagueRows,
      recent: publicByPlayer.get(player.PlayerId) || [],
    }));
    for (let iteration = 0; iteration < simulations; iteration += 1) {
      const simulated = simulatePlayoffBracket(nodes, strengths, random);
      const winningTeam = teams.find(team => String(team.ExternalTeamId) === simulated.champion);
      championCounts.set(winningTeam.TeamSubmissionId,
        championCounts.get(winningTeam.TeamSubmissionId) + 1);
      const scores = new Map(PLAYOFF_PLAYER_MARKETS.map(market => [market.key,
        new Float64Array(players.length)]));
      for (let i = 0; i < players.length; i += 1) {
        const player = players[i];
        const team = teamBySubmission.get(player.TeamSubmissionId);
        const maps = simulated.mapsByTeam.get(String(team.ExternalTeamId));
        const totals = Object.fromEntries(PLAYER_STATS.map(stat => [stat.key, 0]));
        const highs = Object.fromEntries(PLAYER_STATS.map(stat => [stat.key, 0]));
        const pool = pools[i];
        const publicWeight = Math.min(0.25, pool.recent.length / (pool.recent.length + 20));
        for (let game = 0; game < maps; game += 1) {
          const league = pool.league[Math.floor(random() * pool.league.length)];
          const recent = pool.recent.length && random() < publicWeight
            ? pool.recent[Math.floor(random() * pool.recent.length)] : null;
          for (const stat of PLAYER_STATS) {
            const source = recent && ['kills', 'deaths', 'assists'].includes(stat.key)
              ? recent : league;
            const value = Math.max(0, Number(source[stat.column] || 0));
            totals[stat.key] += value;
            highs[stat.key] = Math.max(highs[stat.key], value);
          }
        }
        for (const market of PLAYOFF_PLAYER_MARKETS) {
          scores.get(market.key)[i] = market.aggregate === 'total' ? totals[market.stat]
            : market.aggregate === 'average' ? totals[market.stat] / maps : highs[market.stat];
        }
      }
      for (const market of PLAYOFF_PLAYER_MARKETS) {
        const values = scores.get(market.key);
        const best = Math.max(...values);
        const tied = [];
        for (let i = 0; i < values.length; i += 1) {
          if (Math.abs(values[i] - best) < 1e-9) tied.push(i);
        }
        for (const i of tied) counts.get(market.key)[i] += 1 / tied.length;
      }
    }
    const forecasts = [];
    for (const market of PLAYOFF_PLAYER_MARKETS) {
      for (let i = 0; i < players.length; i += 1) forecasts.push({
        marketKey: market.key, outcomeKey: `player:${players[i].PlayerId}`,
        teamId: players[i].TeamSubmissionId,
        probability: probability(counts.get(market.key)[i], simulations, players.length),
        confidence: 0.25,
      });
    }
    for (const team of teams) forecasts.push({ marketKey: 'playoffs:champion',
      outcomeKey: `team_submission:${team.TeamSubmissionId}`, teamId: team.TeamSubmissionId,
      probability: probability(championCounts.get(team.TeamSubmissionId),
        simulations, teams.length), confidence: 0.2 });
    const create = analytics.transaction(() => {
      const runId = analytics.prepare(`INSERT INTO AnalyticsRuns
        (RunKey, SeasonId, CutoffAt, PublicDataCutoffAt, LeagueDataCutoffAt,
         ModelVersion, RosterFingerprint, CreatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(runKey, seasonId, cutoff,
          publicRows.reduce((latest, row) => !latest || row.DateCreated > latest ? row.DateCreated : latest, null),
          leagueRows.reduce((latest, row) => !latest || row.DatePlayed > latest ? row.DatePlayed : latest, null),
          VERSION, fingerprint, new Date().toISOString()).lastInsertRowid;
      const addTeam = analytics.prepare(`INSERT INTO PreseasonTeamFeatures
        (RunId, TeamSubmissionId, TeamName, IsManual, RosterSize, MMRSource,
         AverageMMR, PriorLeagueGames, RecentPublicGames, StrengthScore, Confidence)
        VALUES (?, ?, ?, 0, 5, 'roster', ?, ?, ?, ?, ?)`);
      for (const team of teams) {
        const roster = players.filter(player => player.TeamSubmissionId === team.TeamSubmissionId);
        addTeam.run(runId, team.TeamSubmissionId, team.TeamName, team.averageMMR,
          roster.reduce((n, player) => n + (leagueByPlayer.get(player.PlayerId)?.length || 0), 0),
          roster.reduce((n, player) => n + (publicByPlayer.get(player.PlayerId)?.length || 0), 0),
          team.strength, 0.25);
      }
      const addPlayer = analytics.prepare(`INSERT INTO PreseasonPlayerFeatures
        (RunId, TeamSubmissionId, PlayerId, PlayerName, SignupMMR,
         PriorLeagueGames, RecentPublicGames, Confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const player of players) addPlayer.run(runId, player.TeamSubmissionId,
        player.PlayerId, player.PlayerName, player.MMR,
        leagueByPlayer.get(player.PlayerId)?.length || 0,
        publicByPlayer.get(player.PlayerId)?.length || 0, 0.25);
      const addForecast = analytics.prepare(`INSERT INTO ModelForecasts
        (RunId, MarketKey, OutcomeKey, TeamSubmissionId, FairProbability,
         SuggestedDecimalOdds, Confidence, GeneratedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of forecasts) addForecast.run(runId, row.marketKey, row.outcomeKey,
        row.teamId, row.probability, 1 / row.probability, row.confidence, cutoff);
      analytics.prepare(`UPDATE AnalyticsRuns SET Status = 'complete', CompletedAt = ?
        WHERE RunId = ?`).run(new Date().toISOString(), runId);
      return runId;
    });
    return { runId: create(), runKey, reused: false, seasonId,
      seededTeams: teams.length, players: players.length, bracketMatches: nodes.length,
      forecasts: forecasts.length, modelVersion: VERSION };
  } finally { analytics?.close(); publicDb?.close(); lads.close(); }
}
