import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { contentWindow } from './contentWindows.js';
import { seasonWatch } from './stageStories.js';

export function readLeagueDashboard(path, { leagueId = null, before = null, limit = 20,
  period = 'overnight', allowPreview = false, now = new Date() } = {}) {
  const window = contentWindow(period, now);
  const empty = { available: false, window, asOf: null, leagueName: null, seasonWatch: null, results: [], nextBefore: null,
    summary: { games: 0, teams: 0, averageDurationSeconds: null, undatedGames: 0 } };
  if (!existsSync(path)) return empty;
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 1000');
    return db.transaction(() => {
      const run = db.prepare(`SELECT r.RunId, r.AsOfUtc, r.Scope FROM AnalyticsState s
        JOIN AnalyticsRuns r ON r.RunId = s.PublishedRunId WHERE s.Id = 1 AND r.Status = 'complete'`).get();
      if (!run || (run.Scope === 'legacy_preview' && !allowPreview)) return empty;
      const filter = `m.RunId = ? AND (? IS NULL OR m.LeagueId = ?)
        AND (? IS NULL OR (m.StartedAtUtc >= ? AND m.StartedAtUtc <= ?))`;
      const args = [run.RunId, leagueId, leagueId, window.from, window.from, window.to];
      const summary = db.prepare(`SELECT COUNT(*) AS games, AVG(m.DurationSeconds) AS averageDurationSeconds
        FROM MatchFacts m WHERE ${filter}`).get(...args);
      summary.teams = db.prepare(`SELECT COUNT(DISTINCT g.TeamId) AS n FROM TeamGameFacts g
        JOIN MatchFacts m ON m.RunId = g.RunId AND m.MatchId = g.MatchId WHERE ${filter}`).get(...args).n;
      summary.undatedGames = db.prepare(`SELECT COUNT(*) AS n FROM MatchFacts
        WHERE RunId = ? AND (? IS NULL OR LeagueId = ?) AND StartedAtUtc IS NULL`).get(run.RunId, leagueId, leagueId).n;
      const seasons = db.prepare('SELECT LeagueName FROM SeasonFacts WHERE RunId = ? AND (? IS NULL OR LeagueId = ?)')
        .all(run.RunId, leagueId, leagueId);
      const rows = db.prepare(`SELECT m.MatchId, m.LeagueId, s.LeagueName, m.Stage, m.StartedAtUtc, m.DurationSeconds,
        w.TeamId AS WinnerId, wt.TeamName AS WinnerName, l.TeamId AS LoserId, lt.TeamName AS LoserName
        FROM MatchFacts m JOIN SeasonFacts s ON s.RunId = m.RunId AND s.SeasonId = m.SeasonId
        JOIN TeamGameFacts w ON w.RunId = m.RunId AND w.MatchId = m.MatchId AND w.Won = 1
        JOIN TeamGameFacts l ON l.RunId = m.RunId AND l.MatchId = m.MatchId AND l.Won = 0
        JOIN TeamFacts wt ON wt.RunId = w.RunId AND wt.TeamSubmissionId = w.TeamSubmissionId
        JOIN TeamFacts lt ON lt.RunId = l.RunId AND lt.TeamSubmissionId = l.TeamSubmissionId
        WHERE ${filter} AND (? IS NULL OR m.MatchId < ?) ORDER BY m.MatchId DESC LIMIT ?`)
        .all(...args, before, before, limit + 1);
      const watch = seasonWatch(db, run.RunId, leagueId);
      return { available: true, window, asOf: run.AsOfUtc, leagueName: seasons.length === 1 ? seasons[0].LeagueName : null,
        seasonWatch: watch ? { leagueId: watch.leagueId, leagueName: watch.leagueName, phase: watch.phase, stage: watch.stage,
          forms: watch.forms.map(f => ({ teamId: f.teamId, teamName: f.teamName, groupName: f.groupName,
            games: f.games, wins: f.wins, streak: f.streak, form: f.form, lastPlayedAt: f.lastPlayedAt,
            seasonRecord: f.seasonRecord, stageRecord: f.stageRecord, latestSeries: f.latestSeries })) } : null,
        summary, results: rows.slice(0, limit).map(row => ({ matchId: row.MatchId, leagueId: row.LeagueId,
          leagueName: row.LeagueName, stage: row.Stage, playedAt: row.StartedAtUtc, durationSeconds: row.DurationSeconds,
          winner: { teamId: row.WinnerId, teamName: row.WinnerName }, loser: { teamId: row.LoserId, teamName: row.LoserName } })),
        nextBefore: rows.length > limit ? rows[limit - 1].MatchId : null };
    })();
  } finally { db.close(); }
}
