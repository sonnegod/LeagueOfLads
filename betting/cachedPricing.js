import {HISTORICAL_PRICING_VERSION,historicalSourceFingerprint} from './historicalPricing.js';

// Scheduling reuses approved preseason inputs instead of reconstructing
// historical Analytics. Current identities still come from canonical Analytics.
export function readCachedHistoricalPricing(book,league,seasonId,setup) {
  if(!setup)return null;
  const cached=book.db.prepare(`SELECT s.SnapshotId,f.ValidationJson,
    json_extract(m.RulesJson,'$.historicalPricing.sourceFingerprint') AS SourceFingerprint
    FROM BettingMarkets m JOIN BettingForecasts f ON f.ForecastId=m.ForecastId
    JOIN BettingInputSnapshots s ON s.SnapshotId=f.SnapshotId
    WHERE m.SeasonId=? AND m.EventId IS NULL AND f.ModelVersion=?
      AND json_extract(m.RulesJson,'$.setupJson')=?
    ORDER BY f.ForecastId DESC LIMIT 1`).get(seasonId,HISTORICAL_PRICING_VERSION,setup.SetupJson);
  if(!cached)return null;
  const validation=JSON.parse(cached.ValidationJson);
  if(!validation.validated||cached.SourceFingerprint!==historicalSourceFingerprint(league))return null;
  // Extract only the historical features, not the full input/forecast payloads.
  const features=book.db.prepare(`SELECT json_extract(InputJson,'$.inputs.metricHistory') AS Metrics,
    json_extract(InputJson,'$.inputs.preseasonTeamPriors') AS Priors FROM BettingInputSnapshots WHERE SnapshotId=?`).get(cached.SnapshotId);
  if(!features?.Metrics||!features.Priors)return null;
  return {modelMode:'historical_roster',modelVersion:HISTORICAL_PRICING_VERSION,validation,
    metricHistory:JSON.parse(features.Metrics),preseasonTeamPriors:JSON.parse(features.Priors),sourceFingerprint:cached.SourceFingerprint};
}
