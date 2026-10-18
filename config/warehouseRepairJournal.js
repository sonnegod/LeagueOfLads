import { MATCH_PLAYER_ADDITIONS, MATCH_TEAM_ADDITIONS } from './warehouseSchema.js';

const additions = { MatchPlayer: MATCH_PLAYER_ADDITIONS, MatchTeam: MATCH_TEAM_ADDITIONS };
export const quoteIdentifier = value => `"${value.replaceAll('"', '""')}"`;

// Capture only original columns. Expansion columns have their own source validation.
export function captureRepairRows(db, table, where, params) {
  const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
    .map(c => c.name).filter(name => !Object.hasOwn(additions[table] || {}, name));
  const rows = db.prepare(`SELECT rowid,${columns.map(quoteIdentifier).join(',')}
    FROM ${quoteIdentifier(table)} WHERE ${where} ORDER BY rowid`).raw().all(...params);
  return { table, columns, rows };
}

// Reconstruct the baseline stream by undoing ONLY the exact recorded repairs in
// memory. Unexpected edits to repaired rows, or any other row, still fail validation.
export function repairOverlay(table, columns, repairs) {
  const changes = new Map();
  for (const repair of repairs) for (const change of repair.changes) {
    if (change.table !== table) continue;
    if (JSON.stringify(change.columns) !== JSON.stringify(columns)) throw new Error('Repair journal column mismatch');
    const before = new Map(change.before.map(row => [row[0], row.slice(1)]));
    const after = new Map(change.after.map(row => [row[0], row.slice(1)]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = changes.get(id), previous = before.get(id) ?? null, next = after.get(id) ?? null;
      if (old && JSON.stringify(old.after) !== JSON.stringify(previous)) throw new Error('Unrecorded change between repairs');
      changes.set(id, { before: old ? old.before : previous, after: next });
    }
  }
  return changes;
}
