import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { findOrphanMatchRecords, cleanupOrphanMatchRecords } from '../../config/matchMaintenance.js';

const args = process.argv.slice(2), apply = args.includes('--apply');
const paths = args.filter(arg => !arg.startsWith('--'));
if (paths.length !== 1 || args.some(arg => arg.startsWith('--') && arg !== '--apply')) {
  console.error('Usage: node scripts/db/cleanupOrphanMatchRecords.js <existing-LadsData.db> [--apply]');
  process.exit(1);
}
const target = resolve(paths[0]);
const db = new Database(target, { fileMustExist: true, readonly: !apply });
try {
  db.pragma('busy_timeout = 5000');
  const orphans = findOrphanMatchRecords(db);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', orphans }, null, 2));
  if (apply && Object.values(orphans).some(Boolean)) {
    const backup = `${target}.before-orphan-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    await db.backup(backup);
    console.log(`Backup created: ${backup}`);
    console.log(JSON.stringify({ deleted: cleanupOrphanMatchRecords(db), remaining: findOrphanMatchRecords(db) }, null, 2));
  } else console.log(apply ? 'No orphan match records to remove.' : 'Preview only. Add --apply to back up and remove these orphan records.');
} finally { db.close(); }
