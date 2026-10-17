const LOCK_TIMEOUTS = { site: 500, background: 100, migration: 5000, readonly: 1000 };

export function sqliteSupportsConcurrentWal(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!parts) return false;
  const [, major, minor, patch] = parts.map(Number);
  return major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3)
    || (minor === 50 && patch >= 7) || (minor === 44 && patch >= 6)));
}

export function configureWarehouseConnection(db, { role = 'site' } = {}) {
  if (!Object.hasOwn(LOCK_TIMEOUTS, role)) throw new Error('Unknown warehouse connection role');
  if (db.inTransaction) throw new Error('Configure the warehouse connection before starting a transaction');
  db.pragma(`busy_timeout = ${LOCK_TIMEOUTS[role]}`);
  const version = db.prepare('SELECT sqlite_version() version').get().version;
  let journalMode = db.pragma('journal_mode', { simple: true });
  if (!db.readonly && !db.memory) {
    if (!sqliteSupportsConcurrentWal(version)) {
      throw new Error(`SQLite ${version} lacks the WAL concurrency fix. Run npm install to install the configured better-sqlite3 version before starting the site or enrichment.`);
    }
    if (journalMode !== 'wal') journalMode = db.pragma('journal_mode = WAL', { simple: true });
    if (journalMode !== 'wal') throw new Error(`Could not enable warehouse WAL mode (received ${journalMode})`);
    // Retain power-loss durability; use SQLite's passive automatic checkpoints.
    db.pragma('synchronous = FULL');
    db.pragma('wal_autocheckpoint = 1000');
  }
  return { journalMode, sqliteVersion: version, busyTimeoutMs: LOCK_TIMEOUTS[role] };
}

export const isSqliteBusy = error => /^SQLITE_(BUSY|LOCKED)(_|$)/.test(error?.code || '');

// Retry only database work. Callers keep the fetched response, avoiding another API request.
export async function withSqliteBusyRetry(operation, { attempts = 5, delayMs = 250 } = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || !Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new Error('Invalid SQLite retry settings');
  }
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!isSqliteBusy(error) || attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(delayMs * attempt, 1000)));
    }
  }
}

export function checkpointWarehouse(db) {
  if (db.readonly || db.memory || db.pragma('journal_mode', { simple: true }) !== 'wal') return null;
  try { return db.pragma('wal_checkpoint(PASSIVE)')[0]; }
  catch (error) {
    if (isSqliteBusy(error)) return { busy: 1, log: null, checkpointed: null };
    throw error;
  }
}
