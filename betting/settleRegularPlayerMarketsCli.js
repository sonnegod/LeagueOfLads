#!/usr/bin/env node
import { resolveRegularPlayerMarkets } from './resolveRegularPlayerMarkets.js';
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
  console.error(`Usage: node betting/settleRegularPlayerMarketsCli.js
    --lads /absolute/LadsData.db --db /absolute/Betting.db --season <SeasonId>
    [--apply --confirm-fingerprint <fingerprint-from-preview>]
Tied leader markets are voided. Average leaders need 50% of scheduled maps.`);
  process.exitCode = 1;
} else {
  try {
    const preview = resolveRegularPlayerMarkets({ seasonId, ladsPath, bettingPath });
    if (apply && value('--confirm-fingerprint') !== preview.fingerprint) {
      throw new Error('Regular-season data changed since preview or fingerprint is incorrect');
    }
    const settlement = apply ? settleV2Markets({ bettingPath,
      results: preview.results.map(result => ({ marketId: result.marketId,
        status: result.status, winningOutcomeKey: result.winningOutcomeKey,
        resultReference: result.resultReference })) }) : null;
    console.log(JSON.stringify({ preview, applied: apply, settlement }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
