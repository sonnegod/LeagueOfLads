import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeriesForecasts } from './seriesForecasts.js';
import { draftForecastMarkets } from './draftForecastMarkets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Called after schedule import. It is intentionally draft-only: a new Discord
// message cannot by itself approve prices, open a market, or accept wagers.
export function autoDraftScheduledSeries({ seriesUids,
  ladsPath = path.join(root, 'db/LadsData.db'),
  publicPath = path.join(root, 'db/public.db'),
  analyticsPath = path.join(root, 'db/Analytics.db'),
  bettingPath = path.join(root, 'db/Betting.db'),
  asOf = new Date().toISOString(), simulations = 2000,
} = {}) {
  if (!Array.isArray(seriesUids)) throw new Error('seriesUids must be an array');
  let betting;
  const existingMarkets = new Map();
  try {
    betting = new Database(bettingPath, { readonly: true, fileMustExist: true });
    const v2 = betting.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'BettingSchemaMeta'`).get() &&
      betting.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version === 2;
    if (!v2) return { skipped: 'Betting database is not v2', series: [] };
    const existing = betting.prepare(`SELECT DISTINCT type FROM Markets WHERE reference_id = ?
      AND type IN ('series_moneyline', 'series_exact_score', 'series_player_prop')`);
    for (const seriesUid of new Set(seriesUids)) {
      const types = existing.all(String(seriesUid)).map(row => row.type);
      if (types.length) existingMarkets.set(seriesUid, types);
    }
  } catch (error) {
    if (error.code === 'SQLITE_CANTOPEN') return { skipped: 'Betting database is missing', series: [] };
    throw error;
  } finally { betting?.close(); }
  const series = [];
  for (const seriesUid of new Set(seriesUids)) {
    try {
      if (existingMarkets.get(seriesUid)?.includes('series_moneyline')) {
        series.push({ seriesUid, error: 'Obsolete moneyline draft exists; review and remove it before re-drafting' });
        continue;
      }
      if (existingMarkets.has(seriesUid)) {
        series.push({ seriesUid, marketsCreated: 0, status: 'EXISTING' });
        continue;
      }
      const run = buildSeriesForecasts({ seriesUid, ladsPath, publicPath,
        analyticsPath, asOf, simulations });
      const draft = draftForecastMarkets({ runId: run.runId, analyticsPath,
        bettingPath, dryRun: false });
      series.push({ seriesUid, runId: run.runId, marketsCreated: draft.created,
        status: 'DRAFT' });
    } catch (error) {
      series.push({ seriesUid, error: error.message });
    }
  }
  return { skipped: null, series };
}
