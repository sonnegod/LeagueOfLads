#!/usr/bin/env node
import { buildSeriesForecasts } from './seriesForecasts.js';

const seriesUid = Number(process.argv[2]);
if (!Number.isSafeInteger(seriesUid) || seriesUid <= 0) {
  console.error('Usage: node betting/analytics/buildSeriesForecastsCli.js <ScheduledSeries.UID>');
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(buildSeriesForecasts({ seriesUid }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
