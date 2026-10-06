import { draftForecastMarkets } from './draftForecastMarkets.js';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const runId = Number(value('--run-id'));
const bettingPath = value('--db');
const apply = args.includes('--apply-drafts');
if (!Number.isSafeInteger(runId) || runId <= 0 || !bettingPath) {
  console.error(`Usage: node betting/analytics/draftForecastMarketsCli.js
    --run-id <completed-run-id> --db <absolute-Betting-v2.db-path> [--apply-drafts]
Default is read-only preview. --apply-drafts creates DRAFT markets, never OPEN markets.`);
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(draftForecastMarkets({ runId, bettingPath, dryRun: !apply }), null, 2));
  } catch (error) {
    console.error('Draft market creation failed:', error);
    process.exitCode = 1;
  }
}
