import { gunzipSync } from 'node:zlib';

// These are private inputs, free-form account records, or caches that can retain
// signup MMR. Public finalized rosters and recorded match history stay intact.
export const PRIVATE_EXPORT_TABLES = Object.freeze([
  'SeasonSignupDraftPlayers', 'SeasonSignupDrafts', 'SeasonTeamPlayers', 'SignupMMRs',
  'SeasonPendingRosterSlots', 'AdjustedPlayers', 'SeasonBettingSetup', 'BettingRefreshState',
  'AdminAuditLog', 'Logins', 'Admins', 'DraftAccess', 'Comments', 'DraftGodDrafts',
  'ScheduleMessages', 'ScheduleEventRevisions', 'DiscordScheduleCursors', 'DiscordSchedulePollLocks',
]);
const privateKey = /mmr|screenshot|rank_tier|ranktier|rank_estimate|rating_estimate/i;
const quote = name => `"${name.replaceAll('"', '""')}"`;
const tablesIn = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").pluck().all();
const columnsIn = (db, table) => db.prepare(`PRAGMA table_info(${quote(table)})`).all();

function assertNoPrivateKeys(value, location) {
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    let nested;
    try { nested = JSON.parse(value); } catch { return; }
    assertNoPrivateKeys(nested, location); return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (privateKey.test(key)) throw new Error(`Private field found at ${location}.${key}`);
    assertNoPrivateKeys(child, `${location}.${key}`);
  }
}

export function sanitizeCollaboratorCopy(db) {
  const tables = new Set(tablesIn(db));
  const cleared = {};
  // Only the disposable copy is opened writable by the CLI. Foreign keys remain
  // valid because public roster/team parents are preserved, not deleted.
  db.pragma('secure_delete = ON');
  db.transaction(() => {
    for (const table of PRIVATE_EXPORT_TABLES) if (tables.has(table)) {
      cleared[table] = db.prepare(`DELETE FROM ${quote(table)}`).run().changes;
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
        db.prepare('DELETE FROM sqlite_sequence WHERE name=?').run(table);
      }
    }
    if (tables.has('SeasonTeams') && columnsIn(db, 'SeasonTeams').some(c => c.name === 'ManualAverageMMR')) {
      cleared.ManualAverageMMR = db.prepare('UPDATE SeasonTeams SET ManualAverageMMR=NULL WHERE ManualAverageMMR IS NOT NULL').run().changes;
    }
    if (tables.has('LeagueSeasons')) {
      db.prepare('UPDATE LeagueSeasons SET SignupTitle=NULL,SignupDescription=NULL').run();
    }
  })();
  return cleared;
}

export function verifyCollaboratorCopy(db, { progress = () => {} } = {}) {
  const tables = tablesIn(db), tableSet = new Set(tables);
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`Export integrity check failed: ${integrity}`);
  if (db.pragma('foreign_key_check').length) throw new Error('Export has foreign-key violations');
  if (db.pragma('freelist_count', { simple: true }) !== 0) throw new Error('Export needs VACUUM to remove deleted pages');
  for (const table of PRIVATE_EXPORT_TABLES) if (tableSet.has(table)
    && db.prepare(`SELECT 1 FROM ${quote(table)} LIMIT 1`).get()) throw new Error(`Private table is not empty: ${table}`);

  let archives = 0, jsonValues = 0;
  for (const table of tables) {
    const columns = columnsIn(db, table);
    for (const column of columns.filter(c => privateKey.test(c.name))) {
      if (db.prepare(`SELECT 1 FROM ${quote(table)} WHERE ${quote(column.name)} IS NOT NULL LIMIT 1`).get()) {
        throw new Error(`Private column still contains data: ${table}.${column.name}`);
      }
    }
    // Check structured caches too, rather than assuming MMR only lives in a
    // dedicated table. A new cache containing private keys blocks publication.
    for (const column of columns.filter(c => /json$/i.test(c.name))) {
      for (const row of db.prepare(`SELECT ${quote(column.name)} AS value FROM ${quote(table)} WHERE ${quote(column.name)} IS NOT NULL`).iterate()) {
        assertNoPrivateKeys(JSON.parse(row.value), `${table}.${column.name}`); jsonValues++;
      }
    }
  }
  if (tableSet.has('MatchSourceResponses')) {
    for (const row of db.prepare('SELECT MatchId,Encoding,GameplayData FROM MatchSourceResponses ORDER BY MatchId').iterate()) {
      if (row.Encoding !== 'gzip') throw new Error(`Unknown archive encoding for match ${row.MatchId}`);
      const snapshot = JSON.parse(gunzipSync(row.GameplayData, { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8'));
      assertNoPrivateKeys(snapshot, `match:${row.MatchId}`); archives++;
      if (archives % 500 === 0) progress({ archives });
    }
  }
  return { integrity, archives, jsonValues, tables: tables.length };
}

export function collaboratorHistoryCounts(db) {
  const tables = new Set(tablesIn(db));
  return Object.fromEntries(['LeagueInfo', 'GroupNames', 'LeagueGroups', 'TeamInfo', 'PlayerInfo', 'MatchTeam', 'MatchPlayer',
    'MatchTeamPlayer', 'MatchLeague', 'SeriesInfo', 'SeriesMatch', 'PickInfo', 'TeamRosterPlayers', 'MatchSourceResponses',
    'MatchTeamTimeline', 'MatchPlayerTimeline', 'MatchPlayerPurchases', 'MatchPlayerAbilityUpgrades', 'MatchObjectives',
    'MatchTeamfights', 'MatchTeamfightPlayers'].filter(table => tables.has(table))
    .map(table => [table, db.prepare(`SELECT COUNT(*) FROM ${quote(table)}`).pluck().get()]));
}
