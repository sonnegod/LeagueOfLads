import Database from 'better-sqlite3';
import { lockExpiredV2Markets } from './lockExpiredV2Markets.js';
import { resolveSeriesForecasts } from './analytics/resolveSeriesForecasts.js';
import { settleV2Markets } from './settleV2Markets.js';

// Automatic matching is deliberately narrow. If the same teams played more
// than one possible completed series near the scheduled date, leave the market
// locked for human review rather than choosing a possibly wrong result.
export function autoSettleV2Series({ bettingPath, ladsPath,
  now = new Date().toISOString(), apply = true,
} = {}) {
  if (!bettingPath || !ladsPath || Number.isNaN(Date.parse(now))) {
    throw new Error('Pass bettingPath, ladsPath, and a valid time');
  }
  const betting = new Database(bettingPath, { readonly: !apply, fileMustExist: true });
  let locked = 0;
  let scheduled;
  try {
    if (betting.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    if (apply) locked = lockExpiredV2Markets(betting, now);
    scheduled = betting.prepare(`SELECT DISTINCT m.reference_id AS seriesUid,
      m.season_id AS seasonId FROM Markets m
      WHERE m.type = 'series_exact_score' AND m.status = 'LOCKED'
        AND NOT EXISTS (SELECT 1 FROM MarketResults r WHERE r.market_id = m.id)
      ORDER BY m.reference_id`).all();
    const otherStatus = betting.prepare(`SELECT COUNT(*) AS n FROM Markets
      WHERE reference_id = ? AND type IN ('series_exact_score','series_player_prop')
        AND status <> 'LOCKED'`);
    scheduled = scheduled.map(row => ({ ...row,
      ready: otherStatus.get(row.seriesUid).n === 0 }));
  } finally { betting.close(); }
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  const summary = { locked, series: [] };
  try {
    const find = lads.prepare(`SELECT si.SeriesId FROM SeriesInfo si
    JOIN SeriesMatch sm ON sm.SeriesId = si.SeriesId
    JOIN MatchLeague ml ON ml.MatchId = sm.MatchId
    WHERE si.LeagueId = ?
      AND ((si.Team1 = ? AND si.Team2 = ?) OR (si.Team1 = ? AND si.Team2 = ?))
      AND date(ml.DatePlayed) BETWEEN date(?, '-1 day') AND date(?, '+2 day')
    GROUP BY si.SeriesId HAVING COUNT(DISTINCT sm.MatchId) >= 2
    ORDER BY si.SeriesId`);
    for (const row of scheduled) {
      const uid = Number(row.seriesUid);
      if (!row.ready || !Number.isSafeInteger(uid)) {
        summary.series.push({ seriesUid: row.seriesUid, status: 'needs_review' });
        continue;
      }
      const schedule = lads.prepare(`SELECT Team1, Team2, Date
        FROM ScheduledSeries WHERE UID = ?`).get(uid);
      const season = lads.prepare(`SELECT ExternalLeagueId FROM LeagueSeasons
        WHERE SeasonId = ?`).get(row.seasonId);
      if (!schedule || !season?.ExternalLeagueId) {
        summary.series.push({ seriesUid: uid, status: 'missing_schedule_or_league' });
        continue;
      }
      const candidates = find.all(season.ExternalLeagueId, schedule.Team1, schedule.Team2,
        schedule.Team2, schedule.Team1, schedule.Date, schedule.Date);
      if (candidates.length !== 1) {
        summary.series.push({ seriesUid: uid,
          status: candidates.length ? 'ambiguous' : 'awaiting_valid_league_result',
          candidates: candidates.map(candidate => candidate.SeriesId) });
        continue;
      }
      try {
        const resolved = resolveSeriesForecasts({ seriesUid: uid,
          completedSeriesId: candidates[0].SeriesId, ladsPath, bettingPath });
        const settlement = apply ? settleV2Markets({ bettingPath,
          results: resolved.results.map(result => ({ marketId: result.marketId,
            status: result.status, winningOutcomeKey: result.winningOutcomeKey,
            resultReference: result.resultReference })) }) : null;
        summary.series.push({ seriesUid: uid, completedSeriesId: candidates[0].SeriesId,
          status: apply ? 'settled' : 'ready', settlement });
      } catch (error) {
        summary.series.push({ seriesUid: uid, status: 'needs_review', error: error.message });
      }
    }
    return summary;
  } finally { lads.close(); }
}
