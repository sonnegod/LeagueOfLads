import Database from 'better-sqlite3';
import path from 'node:path';
import { settleV2Markets } from './settleV2Markets.js';

// Use when a scheduled series was played without the league ID, abandoned, or
// otherwise cannot be graded from trustworthy league match data. This must be
// invoked explicitly; an overdue schedule alone does not prove a bad match.
export function voidScheduledSeries({ bettingPath, seriesUid, reason } = {}) {
  if (!bettingPath || !path.isAbsolute(bettingPath) ||
    !Number.isSafeInteger(seriesUid) || seriesUid <= 0 ||
    typeof reason !== 'string' || !reason.trim() || reason.length > 200) {
    throw new Error('Pass an absolute v2 DB path, scheduled series UID, and reason');
  }
  const db = new Database(bettingPath, { readonly: true, fileMustExist: true });
  let markets;
  try {
    if (db.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    markets = db.prepare(`SELECT id FROM Markets WHERE reference_id = ?
      AND type IN ('series_moneyline', 'series_exact_score', 'series_player_prop')
      ORDER BY id`).all(String(seriesUid));
  } finally { db.close(); }
  if (!markets.length) throw new Error(`No v2 series markets for scheduled series ${seriesUid}`);
  const resultReference = `push:scheduled_series:${seriesUid}:${reason.trim()}`;
  return settleV2Markets({ bettingPath, results: markets.map(market => ({
    marketId: market.id, status: 'VOID', resultReference,
  })) });
}
