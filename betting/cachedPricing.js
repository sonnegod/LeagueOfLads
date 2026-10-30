import {HISTORICAL_PRICING_VERSION,historicalSourceFingerprint} from './historicalPricing.js';

// Scheduling reuses the latest approved historical inputs instead of rebuilding
// Analytics. A data refresh can save newer inputs without repricing preseason.
export function readCachedHistoricalPricing(book,league,seasonId,setup) {
  if(!setup)return null;
  const cached=book.db.prepare(`SELECT s.SnapshotId,
    CASE WHEN json_extract(s.InputJson,'$.inputs.historicalStatPricing.version')=?
      THEN json_extract(s.InputJson,'$.inputs.historicalStatValidation') ELSE f.ValidationJson END AS ValidationJson,
    COALESCE(json_extract(s.InputJson,'$.inputs.historicalPricing.sourceFingerprint'),
      json_extract(s.InputJson,'$.inputs.historicalStatPricing.sourceFingerprint')) AS SourceFingerprint
    FROM BettingForecasts f JOIN BettingInputSnapshots s ON s.SnapshotId=f.SnapshotId
    WHERE s.SeasonId=? AND (f.ModelVersion=? OR json_extract(s.InputJson,'$.inputs.historicalStatPricing.version')=?) AND f.ForecastKey IS NOT NULL
      AND json_extract(s.InputJson,'$.setup.SetupJson')=?
    ORDER BY f.ForecastId DESC LIMIT 1`).get(HISTORICAL_PRICING_VERSION,seasonId,HISTORICAL_PRICING_VERSION,HISTORICAL_PRICING_VERSION,setup.SetupJson);
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
