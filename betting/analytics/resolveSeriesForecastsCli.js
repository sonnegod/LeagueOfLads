#!/usr/bin/env node
import { resolveSeriesForecasts } from './resolveSeriesForecasts.js';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const seriesUid = Number(value('--scheduled'));
const completedSeriesId = Number(value('--completed'));
const bettingPath = value('--db');
if (!Number.isSafeInteger(seriesUid) || seriesUid <= 0 ||
    !Number.isSafeInteger(completedSeriesId) || completedSeriesId <= 0 ||
    !bettingPath) {
  console.error(`Usage: node betting/analytics/resolveSeriesForecastsCli.js \
--db /absolute/path/to/Betting.db --scheduled <ScheduledSeries.UID> \
--completed <SeriesInfo.SeriesId>`);
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(resolveSeriesForecasts({
      seriesUid, completedSeriesId, bettingPath,
    }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
