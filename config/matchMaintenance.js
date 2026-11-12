import { WAREHOUSE_CHILDREN } from './warehouseSchema.js';
import { rebuildLeagueGroupStandings } from './groupStandings.js';
import { refreshSeriesLifecycle } from './seriesLifecycle.js';
import { hasTable, resultsChanged } from './matchResultsSchema.js';
import { markBettingDirty } from '../betting/refreshQueue.js';

// Live observations may precede warehouse ingestion, so they are not orphans
// merely because their MatchTeam row is absent.
const MATCH_CHILDREN = [...WAREHOUSE_CHILDREN, 'PickInfo', 'MatchDraftSources', 'SeriesMatch', 'DraftGodMatchTelemetry',
  'MatchTeamPlayer', 'MatchPlayer', 'MatchLeague'];

const positiveId = value => {
  const raw = String(value), id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid ID');
  return id;
};

function children(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  if (!tables.has('MatchTeam')) throw new Error('Not a match warehouse: MatchTeam is missing');
  return MATCH_CHILDREN.filter(table => tables.has(table));
}

export function deleteMatchRecords(db, matchId, audit) {
  const id = positiveId(matchId);
  return db.transaction(() => {
    // Capture these links before deleting them; standings and series scores
    // must be rebuilt from the remaining matches in the same transaction.
    const leagues = hasTable(db, 'MatchLeague')
      ? db.prepare('SELECT DISTINCT LeagueId FROM MatchLeague WHERE MatchId=?').all(id) : [];
    const series = hasTable(db, 'SeriesMatch')
      ? db.prepare('SELECT DISTINCT SeriesId FROM SeriesMatch WHERE MatchId=?').all(id) : [];
    const deleted = {};
    for (const table of [...children(db), 'MatchTeam']) {
      deleted[table] = db.prepare(`DELETE FROM ${table} WHERE MatchId=?`).run(id).changes;
    }
    if (Object.values(deleted).some(Boolean)) {
      if (hasTable(db, 'GroupNames')) {
        for (const { LeagueId } of leagues) rebuildLeagueGroupStandings(db, LeagueId);
      }
      if (hasTable(db, 'SeriesLifecycle')) {
        for (const { SeriesId } of series) refreshSeriesLifecycle(db, SeriesId);
      }
      if (hasTable(db, 'BettingRefreshState')) markBettingDirty(db, new Date(), { refreshAnalytics: true });
      if (hasTable(db, 'MatchResultsState')) resultsChanged(db);
      audit?.(id, deleted);
    }
    return deleted;
  }).immediate();
}

export function findOrphanMatchRecords(db) {
  return Object.fromEntries(children(db).map(table => [table, db.prepare(`SELECT COUNT(*) n FROM ${table} child
    WHERE NOT EXISTS (SELECT 1 FROM MatchTeam parent WHERE parent.MatchId=child.MatchId)`).get().n]));
}

export function cleanupOrphanMatchRecords(db) {
  return db.transaction(() => Object.fromEntries(children(db).map(table => [table,
    db.prepare(`DELETE FROM ${table} WHERE NOT EXISTS (SELECT 1 FROM MatchTeam parent
      WHERE parent.MatchId=${table}.MatchId)`).run().changes,
  ]))).immediate();
}
