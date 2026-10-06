#!/usr/bin/env node
import { publishSeriesMarkets } from './publishSeriesMarkets.js';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const seriesUid = Number(value('--scheduled'));
const bettingPath = value('--db');
const apply = args.includes('--apply');
if (!Number.isSafeInteger(seriesUid) || seriesUid <= 0 || !bettingPath ||
    (apply && value('--confirm-publish') !== `PUBLISH-${seriesUid}`)) {
  console.error(`Usage: node betting/publishSeriesMarketsCli.js --db /absolute/path/to/Betting.db
    --scheduled <ScheduledSeries.UID> [--apply --confirm-publish PUBLISH-<ScheduledSeries.UID>]
Default previews only. Apply opens all draft series markets until the parsed kickoff time.`);
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(publishSeriesMarkets({ seriesUid, bettingPath, apply }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
