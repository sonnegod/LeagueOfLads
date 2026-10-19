import { verifiedSeriesOutcome } from './seriesStories.js';

// Choose recent fixtures in the window, then read their full recorded scores.
// A paginated/windowed subset of games must never look like a completed series.
export function dashboardSeries(db, runId, leagueId, window) {
  const recent = db.prepare(`SELECT m.SeriesId,m.MatchId
    FROM MatchFacts m WHERE m.RunId=? AND (? IS NULL OR m.LeagueId=?)
      AND (? IS NULL OR (m.StartedAtUtc>=? AND m.StartedAtUtc<=?))
    GROUP BY CASE WHEN m.SeriesId IS NULL THEN 'match:'||m.MatchId ELSE 'series:'||m.SeriesId END
    ORDER BY MAX(m.MatchId) DESC LIMIT 10`).all(runId, leagueId, leagueId, window.from, window.from, window.to);
  const gamesQuery = db.prepare(`SELECT m.*,w.TeamId AS WinnerTeamId,l.TeamId AS LoserTeamId,
    wt.TeamName AS WinnerName,lt.TeamName AS LoserName
    FROM MatchFacts m JOIN TeamGameFacts w ON w.RunId=m.RunId AND w.MatchId=m.MatchId AND w.Won=1
    JOIN TeamGameFacts l ON l.RunId=m.RunId AND l.MatchId=m.MatchId AND l.Won=0
    JOIN TeamFacts wt ON wt.RunId=w.RunId AND wt.TeamSubmissionId=w.TeamSubmissionId
    JOIN TeamFacts lt ON lt.RunId=l.RunId AND lt.TeamSubmissionId=l.TeamSubmissionId
    WHERE m.RunId=? AND ((? IS NOT NULL AND m.SeriesId=?) OR (? IS NULL AND m.MatchId=?))
    ORDER BY m.StartedAtUtc,m.MatchId LIMIT 8`);
  const seriesQuery = db.prepare('SELECT * FROM SeriesFacts WHERE RunId=? AND SeriesId=?');
  return recent.flatMap(item => {
    const games = gamesQuery.all(runId, item.SeriesId, item.SeriesId, item.SeriesId, item.MatchId);
    if (!games.length) return [];
    const series = item.SeriesId === null ? null : seriesQuery.get(runId, item.SeriesId);
    const first = games[0];
    const team1Id = series?.Team1Id ?? first.WinnerTeamId;
    const team2Id = series?.Team2Id ?? first.LoserTeamId;
    if (team1Id === team2Id || games.some(g => g.SeasonId !== first.SeasonId || g.Stage !== first.Stage
      || ![team1Id, team2Id].includes(g.WinnerTeamId) || ![team1Id, team2Id].includes(g.LoserTeamId))) return [];
    const names = new Map(games.flatMap(g => [[g.WinnerTeamId, g.WinnerName], [g.LoserTeamId, g.LoserName]]));
    const verified = series ? verifiedSeriesOutcome(series, games) : null;
    const bo2Complete = series && first.Stage === 'regular' && series.SourceMatchCount === 2 && games.length === 2
      && games.every(g => g.StartedAtUtc && Number.isFinite(g.DurationSeconds))
      && Date.parse(games[0].StartedAtUtc) + games[0].DurationSeconds * 1000 <= Date.parse(games[1].StartedAtUtc);
    return [{ key: item.SeriesId === null ? `match:${first.MatchId}` : `series:${item.SeriesId}`,
      seriesId: item.SeriesId, stage: first.Stage, bestOf: series?.BestOf ?? null,
      playedAt: games.at(-1).StartedAtUtc, complete: Boolean(verified || bo2Complete), reverseSweep: Boolean(verified?.reverseSweep),
      team1: { teamId: team1Id, teamName: names.get(team1Id), wins: games.filter(g => g.WinnerTeamId === team1Id).length },
      team2: { teamId: team2Id, teamName: names.get(team2Id), wins: games.filter(g => g.WinnerTeamId === team2Id).length },
      games: games.map(g => ({ matchId: g.MatchId, playedAt: g.StartedAtUtc, durationSeconds: g.DurationSeconds,
        winner: { teamId: g.WinnerTeamId, teamName: g.WinnerName } })) }];
  });
}
