#!/usr/bin/env node
import { publishPlayoffMarkets } from './publishPlayoffMarkets.js';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const seasonId = Number(value('--season'));
const apply = args.includes('--apply');
if (!Number.isSafeInteger(seasonId) || seasonId <= 0 || !value('--lads') ||
  !value('--db') || !value('--close-at') ||
  (apply && value('--confirm-publish') !== `PUBLISH-PLAYOFFS-${seasonId}`)) {
  console.error(`Usage: node betting/publishPlayoffMarketsCli.js
    --lads /absolute/LadsData.db --db /absolute/Betting.db --season <SeasonId>
    --close-at <first-playoff-map-kickoff-ISO-UTC>
    [--apply --confirm-publish PUBLISH-PLAYOFFS-<SeasonId>]
Default previews. Review uncalibrated draft prices and the saved bracket first.`);
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(publishPlayoffMarkets({ seasonId,
      ladsPath: value('--lads'), bettingPath: value('--db'), closeAt: value('--close-at'),
      apply }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
