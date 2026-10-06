#!/usr/bin/env node
import { voidScheduledSeries } from './voidScheduledSeries.js';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const bettingPath = value('--db');
const seriesUid = Number(value('--scheduled'));
const reason = value('--reason');
if (!bettingPath || !Number.isSafeInteger(seriesUid) || seriesUid <= 0 ||
    !reason || value('--confirm-push') !== `PUSH-${seriesUid}`) {
  console.error(`Usage: node betting/voidScheduledSeriesCli.js --db /absolute/path/to/Betting.db
    --scheduled <ScheduledSeries.UID> --reason <short-reason>
    --confirm-push PUSH-<ScheduledSeries.UID>
Voids every v2 market for the series and settles affected wallets atomically.`);
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(voidScheduledSeries({ bettingPath, seriesUid, reason }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
