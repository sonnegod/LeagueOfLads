import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function publishSeriesMarkets({ seriesUid, bettingPath,
  ladsPath = path.join(root, 'db/LadsData.db'),
  now = new Date().toISOString(), apply = false,
} = {}) {
  if (!Number.isSafeInteger(seriesUid) || seriesUid <= 0 ||
    !bettingPath || !path.isAbsolute(bettingPath)) {
    throw new Error('Pass a scheduled series UID and explicit absolute Betting v2 DB path');
  }
  if (Number.isNaN(Date.parse(now))) throw new Error('Invalid publication time');
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let betting;
  try {
    const hasTimes = lads.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table'
      AND name = 'ScheduledSeriesTimes'`).get();
    if (!hasTimes) throw new Error('Scheduled series has no recorded kickoff time');
    const schedule = lads.prepare(`SELECT s.UID, t.StartAt FROM ScheduledSeries s
      LEFT JOIN ScheduledSeriesTimes t ON t.ScheduledSeriesUid = s.UID
      WHERE s.UID = ?`).get(seriesUid);
    if (!schedule?.StartAt || Number.isNaN(Date.parse(schedule.StartAt)) ||
      Date.parse(schedule.StartAt) <= Date.parse(now)) {
      throw new Error('Scheduled series needs a future kickoff time before publication');
    }
    betting = new Database(bettingPath, { readonly: !apply, fileMustExist: true });
    betting.pragma('foreign_keys = ON');
    if (betting.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    const markets = betting.prepare(`SELECT id, status, close_time, type, source_run_key
      FROM Markets WHERE reference_id = ? AND type IN
      ('series_moneyline','series_exact_score','series_player_prop') ORDER BY id`)
      .all(String(seriesUid));
    if (markets.some(market => market.type === 'series_moneyline')) {
      throw new Error('Obsolete Bo2 moneyline draft must be removed before publication');
    }
    if (!markets.some(market => market.type === 'series_exact_score') ||
      !markets.some(market => market.type === 'series_player_prop')) {
      throw new Error('Series forecast market set is incomplete');
    }
    if (new Set(markets.map(market => market.source_run_key)).size !== 1 ||
      markets.some(market => market.status !== 'DRAFT')) {
      throw new Error('Series markets must all be DRAFT from the same forecast run');
    }
    const missingPrices = betting.prepare(`SELECT COUNT(*) AS n FROM BettingOptions bo
      JOIN Markets m ON m.id = bo.market_id
      WHERE m.reference_id = ? AND m.type IN
      ('series_moneyline','series_exact_score','series_player_prop')
        AND NOT EXISTS (SELECT 1 FROM OptionPriceHistory p WHERE p.option_id = bo.id)`)
      .get(String(seriesUid)).n;
    if (missingPrices) throw new Error('Series markets contain unpriced options');
    if (!apply) return { dryRun: true, seriesUid, markets: markets.length,
      closeTime: schedule.StartAt, sourceRunKey: markets[0].source_run_key };
    const count = betting.transaction(() => {
      const update = betting.prepare(`UPDATE Markets SET status = 'OPEN',
        close_time = ?, published_at = ? WHERE id = ? AND status = 'DRAFT'`);
      for (const market of markets) {
        if (update.run(schedule.StartAt, now, market.id).changes !== 1) {
          throw new Error(`Market ${market.id} changed during publication`);
        }
      }
      return markets.length;
    })();
    return { dryRun: false, seriesUid, markets: count,
      closeTime: schedule.StartAt, sourceRunKey: markets[0].source_run_key };
  } finally { betting?.close(); lads.close(); }
}
