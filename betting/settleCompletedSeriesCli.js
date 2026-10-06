#!/usr/bin/env node
import { resolveSeriesForecasts } from './analytics/resolveSeriesForecasts.js';
import { settleV2Markets } from './settleV2Markets.js';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const bettingPath = value('--db');
const seriesUid = Number(value('--scheduled'));
const completedSeriesId = Number(value('--completed'));
const apply = args.includes('--apply');
const confirmation = `SETTLE-${seriesUid}-${completedSeriesId}`;
if (!bettingPath || !Number.isSafeInteger(seriesUid) || seriesUid <= 0 ||
    !Number.isSafeInteger(completedSeriesId) || completedSeriesId <= 0 ||
    (apply && value('--confirm-settle') !== confirmation)) {
  console.error(`Usage: node betting/settleCompletedSeriesCli.js --db /absolute/path/to/Betting.db
    --scheduled <ScheduledSeries.UID> --completed <SeriesInfo.SeriesId>
    [--apply --confirm-settle SETTLE-<ScheduledSeries.UID>-<SeriesInfo.SeriesId>]
Default previews the results. Apply settles validated v2 markets and tickets atomically.`);
  process.exitCode = 1;
} else {
  try {
    const preview = resolveSeriesForecasts({ seriesUid, completedSeriesId, bettingPath });
    const settlement = apply ? settleV2Markets({ bettingPath, results: preview.results.map(result => ({
      marketId: result.marketId, status: result.status,
      winningOutcomeKey: result.winningOutcomeKey,
      resultReference: result.resultReference,
    })) }) : null;
    console.log(JSON.stringify({ ...preview, applied: apply, settlement }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
