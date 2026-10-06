import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const analyticsPath = path.join(root, 'db/Analytics.db');
export const analyticsRoutes = express.Router();

const leaderMetrics = [
  { key: 'TotalKills', label: 'Most kills', unit: 'kills' },
  { key: 'TotalDeaths', label: 'Most deaths', unit: 'deaths' },
  { key: 'TotalAssists', label: 'Most assists', unit: 'assists' },
  { key: 'MaxKills', label: 'Highest kills in a game', unit: 'kills' },
  { key: 'MaxDeaths', label: 'Highest deaths in a game', unit: 'deaths' },
  { key: 'MaxGPM', label: 'Highest GPM in a game', unit: 'GPM' },
  { key: 'AvgGPM', label: 'Highest average GPM', unit: 'GPM' },
];

export function readHomeAnalytics(db, requestedLeagueId = null) {
  const latest = db.prepare(`SELECT LeagueId, MAX(PlayedDate) AS LatestDate
    FROM CompletedMatchFacts GROUP BY LeagueId
    ORDER BY LatestDate DESC, LeagueId DESC LIMIT 1`).get();
  const leagueId = requestedLeagueId || latest?.LeagueId || null;
  const lastMatch = leagueId ? db.prepare(`SELECT MAX(PlayedDate) AS PlayedDate
    FROM CompletedMatchFacts WHERE LeagueId = ?`).get(leagueId)?.PlayedDate : null;
  const feed = leagueId ? db.prepare(`SELECT FeedType AS type, EventDate AS date,
    Headline AS headline, Summary AS summary, MatchId AS matchId,
    TeamId AS teamId, PlayerId AS playerId
    FROM HomeFeedItems WHERE LeagueId = ? ORDER BY EventDate DESC, RankScore DESC,
      FeedItemId DESC LIMIT 12`).all(leagueId) : [];
  const leaders = leaderMetrics.map(metric => {
    const score = metric.key === 'AvgGPM'
      ? 'SUM(AvgGPM * Games) / SUM(Games)'
      : metric.key.startsWith('Max') ? `MAX(${metric.key})` : `SUM(${metric.key})`;
    const minimum = metric.key === 'AvgGPM' ? 'HAVING SUM(Games) >= 5' : '';
    const players = leagueId ? db.prepare(`SELECT PlayerId AS playerId, MAX(PlayerName) AS playerName,
      SUM(Games) AS games, ROUND(${score}, 1) AS value
      FROM PlayerLeagueStats WHERE LeagueId = ? GROUP BY PlayerId ${minimum}
      ORDER BY value DESC, games DESC, PlayerId LIMIT 5`).all(leagueId) : [];
    return { key: metric.key, label: metric.label, unit: metric.unit, players };
  });
  return { leagueId, lastMatchDate: lastMatch, scope: 'historical league matches',
    rosterForecastAvailable: false, feed, leaders };
}

analyticsRoutes.get('/homeAnalytics', (req, res) => {
  const raw = req.query.leagueId;
  const leagueId = raw === undefined ? null : Number(raw);
  if (raw !== undefined && (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(leagueId) || leagueId <= 0)) {
    return res.status(400).json({ error: 'Invalid league ID' });
  }
  let db;
  try {
    db = new Database(analyticsPath, { readonly: true, fileMustExist: true });
    return res.json(readHomeAnalytics(db, leagueId));
  } catch (error) {
    console.error('Failed to load home analytics:', error);
    return res.status(503).json({ error: 'Homepage analytics are not available yet' });
  } finally {
    db?.close();
  }
});
