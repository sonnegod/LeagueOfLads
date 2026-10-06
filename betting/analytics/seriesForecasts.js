import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureAnalyticsSchema } from '../../scripts/db/analyticsSchema.js';
import { PLAYER_STATS } from '../marketCatalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL_VERSION = 'series-bo2-v2-draft';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function probability(count, total) { return (count + 0.5) / (total + 1); }
function statValue(row, key) {
  const column = PLAYER_STATS.find(stat => stat.key === key).column;
  return Math.max(0, Number(row[column] || 0));
}

export function bo2TeamProbabilities(mapWinProbability) {
  if (!(mapWinProbability > 0 && mapWinProbability < 1)) throw new Error('Invalid map probability');
  const a20 = mapWinProbability ** 2;
  const b20 = (1 - mapWinProbability) ** 2;
  const draw = 2 * mapWinProbability * (1 - mapWinProbability);
  return { a20, draw, b20 };
}

export function buildSeriesForecasts({ seriesUid,
  ladsPath = path.join(root, 'db/LadsData.db'),
  publicPath = path.join(root, 'db/public.db'),
  analyticsPath = path.join(root, 'db/Analytics.db'),
  asOf = new Date().toISOString(), simulations = 2000,
} = {}) {
  if (!Number.isSafeInteger(seriesUid) || seriesUid <= 0) throw new Error('Pass a positive seriesUid');
  if (!Number.isSafeInteger(simulations) || simulations < 100 || simulations > 20000) {
    throw new Error('simulations must be between 100 and 20000');
  }
  const cutoff = new Date(asOf);
  if (Number.isNaN(cutoff.getTime())) throw new Error('asOf must be a valid date');
  const timestamp = cutoff.toISOString();
  const source = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let publicDb;
  let analytics;
  try {
    publicDb = new Database(publicPath, { readonly: true, fileMustExist: true });
    analytics = new Database(analyticsPath);
    ensureAnalyticsSchema(analytics);
    const series = source.prepare(`SELECT UID, Team1, Team2, Date
      FROM ScheduledSeries WHERE UID = ?`).get(seriesUid);
    if (!series || series.Date < timestamp.slice(0, 10) || series.Team1 === series.Team2) {
      throw new Error('Scheduled Bo2 series must be upcoming and have two distinct teams');
    }
    const season = source.prepare(`SELECT SeasonId FROM LeagueSeasons
      WHERE Status = 'active' ORDER BY SeasonId DESC LIMIT 1`).get();
    if (!season) throw new Error('No active season');
    const teams = source.prepare(`SELECT TeamSubmissionId, TeamName, ExternalTeamId,
      IsManual, ManualAverageMMR FROM SeasonTeams WHERE SeasonId = ?
      AND ExternalTeamId IN (?, ?) ORDER BY ExternalTeamId`).all(
      season.SeasonId, series.Team1, series.Team2);
    if (teams.length !== 2) throw new Error('Both scheduled teams must map to season submissions');
    const a = teams.find(team => team.ExternalTeamId === series.Team1);
    const b = teams.find(team => team.ExternalTeamId === series.Team2);
    if (!a || !b || a.TeamSubmissionId === b.TeamSubmissionId) {
      throw new Error('Scheduled teams do not map to two distinct season submissions');
    }
    const players = source.prepare(`SELECT p.TeamSubmissionId, p.PlayerId, p.MMR,
      COALESCE(CAST(i.PlayerName AS TEXT), 'Player ' || p.PlayerId) AS PlayerName
      FROM SeasonTeamPlayers p JOIN PlayerInfo i ON i.PlayerId = p.PlayerId
      WHERE p.TeamSubmissionId IN (?, ?) ORDER BY p.TeamSubmissionId, p.PlayerId`).all(
      a.TeamSubmissionId, b.TeamSubmissionId);
    for (const team of teams) {
      const roster = players.filter(player => player.TeamSubmissionId === team.TeamSubmissionId);
      if (team.IsManual ? roster.length || !(team.ManualAverageMMR > 0) : roster.length !== 5) {
        throw new Error(`Scheduled team ${team.TeamSubmissionId} has no valid roster or rating`);
      }
      team.averageMMR = team.IsManual ? Number(team.ManualAverageMMR)
        : mean(roster.map(player => player.MMR));
    }
    const since = new Date(cutoff.getTime() - 30 * 86400000).toISOString();
    const leagueRows = source.prepare(`SELECT mp.PlayerId, mp.MatchId, mp.Kills, mp.Deaths,
      mp.Assists, mp.GPM, mp.XPM FROM MatchPlayer mp
      JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
      WHERE ml.DatePlayed IS NULL OR ml.DatePlayed <= ?
      ORDER BY mp.PlayerId, mp.MatchId`).all(timestamp.slice(0, 10));
    const publicRows = publicDb.prepare(`SELECT PlayerId, MatchId, Kills, Deaths, Assists,
      DateCreated FROM PublicMatchPlayer WHERE DateCreated >= ? AND DateCreated <= ?
      ORDER BY PlayerId, MatchId`).all(since, timestamp);
    if (!leagueRows.length) throw new Error('No league sample for series player props');
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
    const fingerprint = createHash('sha256').update(JSON.stringify({ series, season, teams,
      players, leagueRows, publicRows, date: timestamp.slice(0, 10), simulations,
      version: MODEL_VERSION })).digest('hex');
    const runKey = `series:${seriesUid}:${MODEL_VERSION}:${fingerprint}`;
    const existing = analytics.prepare('SELECT RunId, Status FROM AnalyticsRuns WHERE RunKey = ?').get(runKey);
    if (existing) {
      if (existing.Status !== 'complete') throw new Error('Matching series run is incomplete');
      return { runId: existing.RunId, runKey, reused: true,
        forecasts: analytics.prepare('SELECT COUNT(*) AS n FROM ModelForecasts WHERE RunId = ?')
          .get(existing.RunId).n };
    }
    const random = seededRandom(Number.parseInt(fingerprint.slice(0, 8), 16));
    const pMap = 1 / (1 + Math.exp(-(a.averageMMR - b.averageMMR) / 500));
    const probabilities = bo2TeamProbabilities(pMap);
    const rows = [];
    const add = (marketKey, outcomeKey, teamId, fair, lineValue = null, confidence = 0.35) => {
      rows.push({ marketKey, outcomeKey, teamId, fair, lineValue, confidence });
    };
    const prefix = `series:${seriesUid}`;
    add(`${prefix}:exact_score`, `team_submission:${a.TeamSubmissionId}:2-0`,
      a.TeamSubmissionId, probabilities.a20);
    add(`${prefix}:exact_score`, 'draw:1-1', null, probabilities.draw);
    add(`${prefix}:exact_score`, `team_submission:${b.TeamSubmissionId}:2-0`,
      b.TeamSubmissionId, probabilities.b20);
    for (const player of players) for (const stat of PLAYER_STATS) {
      const league = leagueByPlayer.get(player.PlayerId) || leagueRows;
      const recent = publicByPlayer.get(player.PlayerId) || [];
      const publicWeight = ['kills', 'deaths', 'assists'].includes(stat.key)
        ? Math.min(0.25, recent.length / (recent.length + 20)) : 0;
      const values = [];
      for (let i = 0; i < simulations; i += 1) {
        let total = 0;
        for (let game = 0; game < 2; game += 1) {
          const pool = recent.length && random() < publicWeight ? recent : league;
          total += statValue(pool[Math.floor(random() * pool.length)], stat.key);
        }
        values.push(['gpm', 'xpm'].includes(stat.key) ? total / 2 : total);
      }
      values.sort((x, y) => x - y);
      const median = values[Math.floor(values.length / 2)];
      const lineValue = ['gpm', 'xpm'].includes(stat.key)
        ? Math.round(median / 25) * 25 + 0.25 : Math.floor(median) + 0.5;
      const over = probability(values.filter(value => value > lineValue).length, simulations);
      const key = `${prefix}:player:${player.PlayerId}:${stat.key}_${['gpm', 'xpm'].includes(stat.key) ? 'avg' : 'total'}`;
      add(key, 'over', player.TeamSubmissionId, over, lineValue, 0.3);
      add(key, 'under', player.TeamSubmissionId, 1 - over, lineValue, 0.3);
    }
    const create = analytics.transaction(() => {
      const runId = analytics.prepare(`INSERT INTO AnalyticsRuns
        (RunKey, SeasonId, CutoffAt, PublicDataCutoffAt, LeagueDataCutoffAt,
         ModelVersion, RosterFingerprint, CreatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(runKey, season.SeasonId, timestamp,
          publicRows.reduce((latest, row) => !latest || row.DateCreated > latest ? row.DateCreated : latest, null),
          source.prepare('SELECT MAX(DatePlayed) AS d FROM MatchLeague WHERE DatePlayed <= ?')
            .get(timestamp.slice(0, 10)).d,
          MODEL_VERSION, fingerprint, new Date().toISOString()).lastInsertRowid;
      const insertTeam = analytics.prepare(`INSERT INTO PreseasonTeamFeatures
        (RunId, TeamSubmissionId, TeamName, IsManual, RosterSize, MMRSource,
         AverageMMR, PriorLeagueGames, RecentPublicGames, Confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const team of teams) {
        const roster = players.filter(player => player.TeamSubmissionId === team.TeamSubmissionId);
        insertTeam.run(runId, team.TeamSubmissionId, team.TeamName, team.IsManual,
          roster.length, team.IsManual ? 'manual' : 'roster', team.averageMMR,
          roster.reduce((sum, player) => sum + (leagueByPlayer.get(player.PlayerId)?.length || 0), 0),
          roster.reduce((sum, player) => sum + (publicByPlayer.get(player.PlayerId)?.length || 0), 0),
          0.35);
      }
      const insertPlayer = analytics.prepare(`INSERT INTO PreseasonPlayerFeatures
        (RunId, TeamSubmissionId, PlayerId, PlayerName, SignupMMR,
         PriorLeagueGames, RecentPublicGames, Confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const player of players) {
        insertPlayer.run(runId, player.TeamSubmissionId, player.PlayerId,
          player.PlayerName, player.MMR, leagueByPlayer.get(player.PlayerId)?.length || 0,
          publicByPlayer.get(player.PlayerId)?.length || 0, 0.3);
      }
      const insert = analytics.prepare(`INSERT INTO ModelForecasts
        (RunId, MarketKey, OutcomeKey, TeamSubmissionId, LineValue,
         FairProbability, SuggestedDecimalOdds, Confidence, GeneratedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of rows) insert.run(runId, row.marketKey, row.outcomeKey,
        row.teamId, row.lineValue, row.fair, 1 / row.fair, row.confidence, timestamp);
      analytics.prepare(`UPDATE AnalyticsRuns SET Status = 'complete', CompletedAt = ?
        WHERE RunId = ?`).run(new Date().toISOString(), runId);
      return runId;
    });
    return { runId: create(), runKey, reused: false, seasonId: season.SeasonId,
      seriesUid, teamA: a.TeamName, teamB: b.TeamName, pMap, forecasts: rows.length };
  } finally {
    analytics?.close();
    publicDb?.close();
    source.close();
  }
}
