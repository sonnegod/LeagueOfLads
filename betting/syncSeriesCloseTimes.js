import Database from 'better-sqlite3';
import { lockExpiredV2Markets } from './lockExpiredV2Markets.js';

// Schedule edits can move kickoff earlier. Never let an already-open market
// retain a later closing time; a move later is left for explicit review.
export function syncSeriesCloseTimes({ seriesUids, ladsPath, bettingPath,
  now = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(seriesUids) || !ladsPath || !bettingPath ||
    Number.isNaN(Date.parse(now))) throw new Error('Invalid schedule sync input');
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let betting;
  try {
    if (!lads.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table'
      AND name = 'ScheduledSeriesTimes'`).get()) return { tightened: 0, locked: 0 };
    betting = new Database(bettingPath, { fileMustExist: true });
    if (!betting.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table'
      AND name = 'BettingSchemaMeta'`).get() ||
      betting.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      return { tightened: 0, locked: 0 };
    }
    const startFor = lads.prepare(`SELECT StartAt FROM ScheduledSeriesTimes
      WHERE ScheduledSeriesUid = ?`);
    const tighten = betting.prepare(`UPDATE Markets SET close_time = ?
      WHERE reference_id = ? AND type IN ('series_exact_score','series_player_prop')
        AND status = 'OPEN' AND close_time > ?`);
    let tightened = 0;
    for (const uid of new Set(seriesUids)) {
      const startAt = startFor.get(uid)?.StartAt;
      if (startAt && !Number.isNaN(Date.parse(startAt))) {
        tightened += tighten.run(startAt, String(uid), startAt).changes;
      }
    }
    return { tightened, locked: lockExpiredV2Markets(betting, now) };
  } finally { betting?.close(); lads.close(); }
}
