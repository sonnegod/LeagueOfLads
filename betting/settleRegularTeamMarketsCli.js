#!/usr/bin/env node
import { resolveRegularTeamMarkets } from './resolveRegularTeamMarkets.js';
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
  (apply && !value('--confirm-fingerprint'))) {
  console.error(`Usage: node betting/settleRegularTeamMarketsCli.js
    --lads /absolute/LadsData.db --db /absolute/Betting.db --season <SeasonId>
    [--apply --confirm-fingerprint <fingerprint-from-preview>]
Review final playoff seeding before applying. A provisional seeding can mispay bets.`);
  process.exitCode = 1;
} else {
  try {
    const preview = resolveRegularTeamMarkets({ seasonId, ladsPath, bettingPath });
    if (apply && value('--confirm-fingerprint') !== preview.fingerprint) {
      throw new Error('Seeding changed since preview or fingerprint is incorrect');
    }
    const settlement = apply ? settleV2Markets({ bettingPath, results: preview.results.map(
      ({ marketId, status, winningOutcomeKey, resultReference }) =>
        ({ marketId, status, winningOutcomeKey, resultReference })) }) : null;
    console.log(JSON.stringify({ preview, applied: apply, settlement }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
