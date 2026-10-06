#!/usr/bin/env node
import { publishPreseasonMarkets } from './publishPreseasonMarkets.js';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const seasonId = Number(value('--season'));
const apply = args.includes('--apply');
if (!Number.isSafeInteger(seasonId) || seasonId <= 0 || !value('--lads') ||
  !value('--db') || !value('--close-at') ||
  (apply && value('--confirm-publish') !== `PUBLISH-PRESEASON-${seasonId}`)) {
  console.error(`Usage: node betting/publishPreseasonMarketsCli.js
    --lads /absolute/LadsData.db --db /absolute/Betting.db --season <SeasonId>
    --close-at <first-map-kickoff-ISO-UTC>
    [--apply --confirm-publish PUBLISH-PRESEASON-<SeasonId>]
Default previews. Review odds and kickoff before opening all preseason futures.`);
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(publishPreseasonMarkets({ seasonId,
      ladsPath: value('--lads'), bettingPath: value('--db'), closeAt: value('--close-at'),
      apply }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
