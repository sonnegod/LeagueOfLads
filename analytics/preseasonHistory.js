import Database from 'better-sqlite3';
import { migrateAnalytics } from './store.js';
import { buildAnalytics } from './build.js';

// Historical pricing input, separate from canonical signup-era ownership and
// settlement. Each history generation is discarded after extracting facts.
export function readPreseasonPreviewHistory(league, { excludeLeagueId, now = new Date(), seasons = 3 } = {}) {
  if (!Number.isInteger(seasons) || seasons < 1 || seasons > 5) throw new Error('Use one to five history seasons');
  const hasUtc = league.pragma('table_info(MatchTeam)').some(c => c.name === 'StartTimeUtc');
  const candidates = league.prepare(`SELECT l.LeagueId,l.LeagueName,MAX(${hasUtc ? 'm.StartTimeUtc' : 'ml.DatePlayed'}) Latest
    FROM LeagueInfo l JOIN MatchLeague ml USING(LeagueId) JOIN MatchTeam m USING(MatchId)
    WHERE l.LeagueId<>? AND ${hasUtc ? 'm.StartTimeUtc>0 AND m.StartTimeUtc+m.Duration<?' : "ml.DatePlayed<?"}
    GROUP BY l.LeagueId ORDER BY Latest DESC,l.LeagueId DESC LIMIT ?`)
    .all(excludeLeagueId || -1, hasUtc ? now.getTime() / 1000 : now.toISOString(), seasons);
  const history = [], reports = [];
  for (const candidate of candidates) {
    const derived = new Database(':memory:');
    try {
      migrateAnalytics(derived);
      const { runId } = buildAnalytics({ league, analytics: derived, previewLeagueId: candidate.LeagueId, now });
      const rows = derived.prepare(`SELECT g.*,m.SeasonId,m.SeriesId,m.LeagueId,m.Stage,m.StartedAtUtc,m.SourceObservedAtUtc,m.DurationSeconds,
        c.PatchKey,e.LaneRole FROM PlayerGameFacts g JOIN MatchFacts m USING(RunId,MatchId)
        JOIN MatchContextFacts c USING(RunId,MatchId) JOIN PlayerPerformanceFacts e USING(RunId,MatchId,PlayerId)
        WHERE g.RunId=? AND m.Stage IN ('regular','playoff') AND m.StartedAtUtc IS NOT NULL ORDER BY m.StartedAtUtc,g.MatchId,g.PlayerId`).all(runId);
      history.push(...rows.map(({ RunId, ...row }) => row));
      reports.push({ leagueId: candidate.LeagueId, name: candidate.LeagueName,
        games: new Set(rows.map(r => r.MatchId)).size, lastPlayedAt: rows.at(-1)?.StartedAtUtc || null });
    } finally { derived.close(); }
  }
  return { history, reports };
}
