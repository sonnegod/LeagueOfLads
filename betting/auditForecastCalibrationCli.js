#!/usr/bin/env node
import { auditForecastCalibration } from './auditForecastCalibration.js';

const args = process.argv.slice(2);
const index = args.indexOf('--db');
const bettingPath = index < 0 ? null : args[index + 1];
if (!bettingPath) {
  console.error('Usage: node betting/auditForecastCalibrationCli.js --db /absolute/Betting.db');
  process.exitCode = 1;
} else {
  try { console.log(JSON.stringify(auditForecastCalibration({ bettingPath }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
