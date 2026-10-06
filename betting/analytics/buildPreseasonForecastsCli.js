import { buildPreseasonForecasts } from './preseasonForecasts.js';

const seasonId = Number(process.argv[2]);
if (!Number.isSafeInteger(seasonId) || seasonId <= 0) {
  console.error('Usage: node betting/analytics/buildPreseasonForecastsCli.js <closed-season-id>');
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(buildPreseasonForecasts({ seasonId }), null, 2));
  } catch (error) {
    console.error('Preseason forecast failed:', error);
    process.exitCode = 1;
  }
}
