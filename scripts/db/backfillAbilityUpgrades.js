import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { ensureWarehouseSchema } from '../../config/warehouseSchema.js';
import { backfillAbilityUpgrades } from '../../config/warehouseAbilityUpgrades.js';
import { configureWarehouseConnection, checkpointWarehouse } from '../../config/warehouseConnection.js';

const args = process.argv.slice(2);
const usage = 'Usage: node scripts/db/backfillAbilityUpgrades.js <existing-LadsData.db> [--apply] [--all] [--after-match-id N] [--limit N]';
let target, apply = false, all = false, afterMatchId = 0, limit = 1000;
try {
  if (!args[0] || args[0].startsWith('--')) throw new Error(usage);
  target = resolve(args[0]);
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--all') all = true;
    else if (['--after-match-id', '--limit'].includes(args[i])) {
      const option = args[i], raw = args[++i];
      if (!/^\d+$/.test(raw || '') || !Number.isSafeInteger(Number(raw))) throw new Error(usage);
      if (option === '--after-match-id') afterMatchId = Number(raw); else limit = Number(raw);
    } else throw new Error(usage);
  }
  if (limit < 1) throw new Error(usage);
} catch (error) { console.error(error.message); process.exit(1); }

const db = new Database(target, { fileMustExist: true, readonly: !apply });
try {
  configureWarehouseConnection(db, { role: apply ? 'migration' : 'readonly' });
  if (apply) {
    const backup = `${target}.before-ability-upgrades-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.bak`;
    await db.backup(backup);
    console.log(`Backup created: ${backup}`);
    ensureWarehouseSchema(db);
  }
  const totals = { checked: 0, players: 0, upgrades: 0, changedMatches: 0, invalidPlayers: 0, failedMatches: 0 };
  do {
    const result = backfillAbilityUpgrades(db, { apply, afterMatchId, limit });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', ...result }, null, 2));
    for (const key of Object.keys(totals)) totals[key] += result[key];
    afterMatchId = result.lastMatchId;
    if (result.failedMatches) process.exitCode = 1;
    if (apply) checkpointWarehouse(db);
    if (!result.more) break;
    if (!all) {
      console.log(`More archives remain. Continue with --after-match-id ${result.lastMatchId}`);
      break;
    }
    // Yield between batches so interruption does not wait for the entire archive scan.
    await new Promise(resolve => setImmediate(resolve));
  } while (all);
  if (all) console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', complete: true, ...totals, lastMatchId: afterMatchId }, null, 2));
} finally { db.close(); }
