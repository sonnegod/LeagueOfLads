#!/usr/bin/env node
import { buildPlayoffForecasts } from './playoffForecasts.js';

const args = process.argv.slice(2);
const seasonId = Number(args[0]);
const simulations = args[1] ? Number(args[1]) : 2000;
if (!Number.isSafeInteger(seasonId) || seasonId <= 0) {
  console.error('Usage: node betting/analytics/buildPlayoffForecastsCli.js <SeasonId> [simulations]');
  process.exitCode = 1;
} else {
  try { console.log(JSON.stringify(buildPlayoffForecasts({ seasonId, simulations }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
