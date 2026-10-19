import { ANALYTICS_DEFAULTS, positiveId } from './config.js';
import { readWarehouseBettingInputs } from './warehouseFeatures.js';

// Server-only consumer contract. No route exposes this payload. Betting owns all
// subsequent forecasts, lines, prices, markets and settlement decisions.
export function readSeasonBettingInputs(db, seasonId, now = new Date()) {
  seasonId = positiveId(seasonId, 'season');
  if (!seasonId) throw new Error('A season is required');
  return db.transaction(() => {
    const scopeField = db.pragma('table_info(AnalyticsRuns)').some(column => column.name === 'Scope')
      ? 'r.Scope' : "'signup_era' AS Scope";
    const run = db.prepare(`SELECT r.RunId, r.AsOfUtc, r.Version, ${scopeField} FROM AnalyticsState s
      JOIN AnalyticsRuns r ON r.RunId = s.PublishedRunId WHERE s.Id = 1 AND r.Status = 'complete'`).get();
    if (!run || run.Scope === 'legacy_preview') return null;
    const season = db.prepare(`SELECT SeasonId, LeagueId, LeagueName, Status, RulesJson, GroupEndMatchId,
      TiebreakerEndMatchId FROM SeasonFacts WHERE RunId = ? AND SeasonId = ?`).get(run.RunId, seasonId);
    if (!season) return null;
    const sources = db.prepare(`SELECT SourceName, LastSuccessAtUtc, LatestStatus FROM SourceSnapshots
      WHERE RunId = ?`).all(run.RunId).map(source => ({
        ...source,
        IsStale: !Number.isFinite(Date.parse(source.LastSuccessAtUtc)) || Date.parse(source.LastSuccessAtUtc)>now.getTime() || now.getTime() - Date.parse(source.LastSuccessAtUtc)
          >= ANALYTICS_DEFAULTS.sourceStaleHours * 3600000,
      }));
    const pendingSlots = db.prepare(`SELECT p.TeamSubmissionId,p.Slot,p.EstimatedMMR FROM PrivatePendingRosterSlots p
      JOIN TeamFacts t ON t.RunId=p.RunId AND t.TeamSubmissionId=p.TeamSubmissionId
      WHERE p.RunId=? AND t.SeasonId=? ORDER BY p.TeamSubmissionId,p.Slot`).all(run.RunId,seasonId);
    const teams = db.prepare(`SELECT t.TeamSubmissionId, t.TeamId, t.TeamName, t.GroupId, t.IsManual,
      f.AverageSignupMMR, f.RosterSamples, f.QualityStatus AS SignupQuality
      FROM TeamFacts t LEFT JOIN PrivateTeamFeatures f
      ON f.RunId = t.RunId AND f.TeamSubmissionId = t.TeamSubmissionId
      WHERE t.RunId = ? AND t.SeasonId = ? ORDER BY t.TeamSubmissionId`).all(run.RunId, seasonId)
      .map(t=>({...t,PendingPlayers:pendingSlots.filter(p=>p.TeamSubmissionId===t.TeamSubmissionId).length}));
    const roster = db.prepare(`SELECT r.TeamSubmissionId, r.PlayerId, p.PlayerName, r.Slot,
      r.EffectiveFromUtc, r.EffectiveToUtc, r.FromEstimated, r.MembershipSource,
      i.SignupMMR, i.InputSource AS MMRSource
      FROM RosterMembership r JOIN TeamFacts t ON t.RunId = r.RunId AND t.TeamSubmissionId = r.TeamSubmissionId
      JOIN PlayerFacts p ON p.RunId = r.RunId AND p.PlayerId = r.PlayerId
      LEFT JOIN PrivateRosterInputs i ON i.RunId = r.RunId AND i.TeamSubmissionId = r.TeamSubmissionId AND i.PlayerId = r.PlayerId
      WHERE r.RunId = ? AND t.SeasonId = ? ORDER BY r.TeamSubmissionId, r.Slot`).all(run.RunId, seasonId);
    const playerStats = db.prepare(`SELECT s.TeamSubmissionId, s.PlayerId, s.Stage, s.Membership,
      s.GamesPlayed, s.Wins, s.TeamGames, s.MarketEligible, m.Metric, m.Samples, m.Total,
      m.Average, m.Minimum, m.Maximum, m.Variance, m.RecentSamples, m.RecentAverage,
      CASE WHEN m.Samples = s.GamesPlayed THEN 1 ELSE 0 END AS MetricComplete,
      d.AllowsSeasonTotal, d.AllowsSeasonAverage
      FROM PlayerTeamSeasonStats s JOIN PlayerMetricStats m
      ON m.RunId = s.RunId AND m.SeasonId = s.SeasonId AND m.TeamSubmissionId = s.TeamSubmissionId
      AND m.PlayerId = s.PlayerId AND m.Stage = s.Stage AND m.Membership = s.Membership
      JOIN MetricDefinitions d ON d.Metric = m.Metric
      WHERE s.RunId = ? AND s.SeasonId = ? ORDER BY s.TeamSubmissionId, s.PlayerId, s.Stage, m.Metric`)
      .all(run.RunId, seasonId);
    const privatePlayerFeatures = db.prepare(`SELECT f.PlayerId, f.WindowStartUtc, f.AsOfUtc, f.SampleCount,
      f.Wins, f.AverageKills, f.AverageDeaths, f.AverageAssists, f.FeatureVersion, f.QualityStatus
      FROM PrivatePlayerFeatures f WHERE f.RunId = ? AND EXISTS (
        SELECT 1 FROM RosterMembership r JOIN TeamFacts t ON t.RunId = r.RunId AND t.TeamSubmissionId = r.TeamSubmissionId
        WHERE r.RunId = f.RunId AND r.PlayerId = f.PlayerId AND t.SeasonId = ?)`)
      .all(run.RunId, seasonId);
    const teamStats = db.prepare(`SELECT TeamSubmissionId, Stage, GamesPlayed, Wins, Losses
      FROM TeamSeasonStats WHERE RunId = ? AND SeasonId = ? AND Stage IN ('regular','playoff')`).all(run.RunId, seasonId);
    const games = db.prepare('SELECT * FROM MatchFacts WHERE RunId=? AND SeasonId=? ORDER BY MatchId LIMIT 10001').all(run.RunId,seasonId);
    const appearances = db.prepare(`SELECT g.*,m.SeriesId,m.Stage,m.StartedAtUtc FROM PlayerGameFacts g JOIN MatchFacts m
      ON m.RunId=g.RunId AND m.MatchId=g.MatchId WHERE g.RunId=? AND m.SeasonId=? ORDER BY g.MatchId,g.PlayerId LIMIT 100001`).all(run.RunId,seasonId);
    const history = db.prepare(`SELECT m.*,a.TeamSubmissionId AS Team1Key,b.TeamSubmissionId AS Team2Key,
      a.Won AS Team1Won FROM MatchFacts m JOIN TeamGameFacts a ON a.RunId=m.RunId AND a.MatchId=m.MatchId AND a.Side='radiant'
      JOIN TeamGameFacts b ON b.RunId=m.RunId AND b.MatchId=m.MatchId AND b.Side='dire'
      WHERE m.RunId=? AND m.Stage IN ('regular','playoff') AND m.StartedAtUtc IS NOT NULL AND m.StartedAtUtc<=? ORDER BY m.StartedAtUtc,m.MatchId LIMIT 10001`).all(run.RunId,run.AsOfUtc);
    const metricHistory = db.prepare(`WITH ranked AS (SELECT g.*,m.Stage,m.StartedAtUtc,m.DurationSeconds,m.SourceObservedAtUtc,
      ROW_NUMBER() OVER(PARTITION BY g.PlayerId ORDER BY m.StartedAtUtc DESC,m.MatchId DESC) AS n FROM PlayerGameFacts g
      JOIN MatchFacts m ON m.RunId=g.RunId AND m.MatchId=g.MatchId WHERE g.RunId=? AND g.Membership='rostered'
      AND m.Stage IN ('regular','playoff') AND m.StartedAtUtc IS NOT NULL AND m.StartedAtUtc<=?) SELECT * FROM ranked WHERE n<=100 LIMIT 100001`).all(run.RunId,run.AsOfUtc);
    const historyTeams = db.prepare(`SELECT t.TeamSubmissionId,t.SeasonId,f.AverageSignupMMR,f.QualityStatus,
      MAX(r.EffectiveFromUtc) AS EffectiveFromUtc,MAX(r.FromEstimated) AS FromEstimated FROM TeamFacts t
      JOIN PrivateTeamFeatures f ON f.RunId=t.RunId AND f.TeamSubmissionId=t.TeamSubmissionId
      LEFT JOIN RosterMembership r ON r.RunId=t.RunId AND r.TeamSubmissionId=t.TeamSubmissionId
      WHERE t.RunId=? GROUP BY t.TeamSubmissionId`).all(run.RunId);
    const strengthHistory=db.prepare(`SELECT g.MatchId,g.PlayerId,g.TeamSubmissionId,g.Won,m.SeasonId,m.StartedAtUtc,m.DurationSeconds,m.SourceObservedAtUtc
      FROM PlayerGameFacts g JOIN MatchFacts m ON m.RunId=g.RunId AND m.MatchId=g.MatchId
      WHERE g.RunId=? AND g.Membership='rostered' AND m.Stage IN ('regular','playoff') AND m.StartedAtUtc IS NOT NULL AND m.StartedAtUtc<=?
      ORDER BY m.StartedAtUtc,g.MatchId,g.PlayerId LIMIT 100001`).all(run.RunId,run.AsOfUtc);
    const historyRosters=db.prepare(`SELECT r.TeamSubmissionId,r.PlayerId,r.Slot,r.EffectiveFromUtc,r.EffectiveToUtc,r.FromEstimated,t.SeasonId
      FROM RosterMembershipIntervals r JOIN TeamFacts t ON t.RunId=r.RunId AND t.TeamSubmissionId=r.TeamSubmissionId WHERE r.RunId=?
      UNION ALL SELECT r.TeamSubmissionId,r.PlayerId,r.Slot,r.EffectiveFromUtc,r.EffectiveToUtc,r.FromEstimated,t.SeasonId
      FROM RosterMembership r JOIN TeamFacts t ON t.RunId=r.RunId AND t.TeamSubmissionId=r.TeamSubmissionId
      WHERE r.RunId=? AND NOT EXISTS(SELECT 1 FROM RosterMembershipIntervals h WHERE h.RunId=r.RunId AND h.TeamSubmissionId=r.TeamSubmissionId)`)
      .all(run.RunId,run.RunId);
    if (games.length>10000 || appearances.length>100000 || history.length>10000 || metricHistory.length>100000 || strengthHistory.length>100000) throw new Error('Betting input batch exceeds configured bounds');
    return { contractVersion: 1, analyticsRunId: run.RunId, asOf: run.AsOfUtc,
      buildVersion: run.Version, season, sources, teams, roster, pendingSlots, playerStats, teamStats, privatePlayerFeatures,
      games, appearances, history, metricHistory, historyTeams, strengthHistory, historyRosters,
      rosterIntervals:db.prepare(`SELECT r.* FROM RosterMembershipIntervals r JOIN TeamFacts t ON t.RunId=r.RunId AND t.TeamSubmissionId=r.TeamSubmissionId
        WHERE r.RunId=? AND t.SeasonId=? ORDER BY r.TeamSubmissionId,r.PlayerId,r.EffectiveFromUtc`).all(run.RunId,seasonId) };
  })();
}

// Opt-in richer feature contract for model development. Existing prices and
// accepted tickets continue to use their existing, validated input contract.
export function readSeasonPerformanceInputs(db, seasonId) {
  seasonId = positiveId(seasonId, 'season');
  if (!seasonId) throw new Error('A season is required');
  return db.transaction(() => {
    const run = db.prepare(`SELECT r.RunId,r.AsOfUtc,r.Scope FROM AnalyticsRuns r
      JOIN AnalyticsState s ON s.PublishedRunId=r.RunId WHERE r.Status='complete'`).get();
    if (!run || run.Scope === 'legacy_preview'
      || !db.prepare('SELECT 1 FROM SeasonFacts WHERE RunId=? AND SeasonId=?').get(run.RunId, seasonId)) return null;
    return { analyticsRunId: run.RunId, asOf: run.AsOfUtc, ...readWarehouseBettingInputs(db, run.RunId, seasonId) };
  })();
}
