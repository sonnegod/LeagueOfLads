#!/usr/bin/env node
import { resolveChampionMarkets } from './resolveChampionMarket.js';
import { settleV2Markets } from './settleV2Markets.js';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const seasonId = Number(value('--season'));
const ladsPath = value('--lads');
const bettingPath = value('--db');
const apply = args.includes('--apply');
if (!Number.isSafeInteger(seasonId) || seasonId <= 0 || !ladsPath || !bettingPath ||
    (apply && value('--confirm-settle') !== `CHAMPION-${seasonId}`)) {
  console.error(`Usage: node betting/settleChampionCli.js --lads /absolute/LadsData.db
    --db /absolute/Betting.db --season <SeasonId>
    [--apply --confirm-settle CHAMPION-<SeasonId>]
Preview is read-only; apply settles the final champion market and affected tickets.`);
  process.exitCode = 1;
} else {
  try {
    const results = resolveChampionMarkets({ seasonId, ladsPath, bettingPath });
    const settlement = apply ? settleV2Markets({ bettingPath, results }) : null;
    console.log(JSON.stringify({ results, applied: apply, settlement }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
