import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { backfillLegacyChampions, legacyChampionCandidates } from '../../config/legacyLeagueChampions.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const paths = args.filter(arg => !arg.startsWith('--'));
if (paths.length !== 1 || args.some(arg => arg.startsWith('--') && arg !== '--apply')) {
  console.error('Usage: node scripts/db/backfillLeagueChampions.js <existing-LadsData.db> [--apply]');
  process.exit(1);
}
const target = resolve(paths[0]);
const db = new Database(target, { fileMustExist: true, readonly: !apply });
try {
  db.pragma('busy_timeout = 5000');
  const candidates = legacyChampionCandidates(db);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', candidates }, null, 2));
  if (apply && candidates.length) {
    const backup = `${target}.before-champion-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    await db.backup(backup);
    console.log(`Backup created: ${backup}`);
    console.log(JSON.stringify(backfillLegacyChampions(db)));
  } else {
    console.log(apply ? 'No missing champions to import.' : `${candidates.length} champion records would be imported.`);
  }
} finally { db.close(); }
