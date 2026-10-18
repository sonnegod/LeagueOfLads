import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { configureWarehouseConnection, withSqliteBusyRetry } from '../../config/warehouseConnection.js';
import { planWarehouseDurationRepair, applyWarehouseDurationRepair } from '../../config/warehouseDurationRepair.js';

const [filename, ...args] = process.argv.slice(2), apply = args.includes('--apply');
const league = args.find(arg => arg.startsWith('--league='))?.slice('--league='.length);
if (!filename || args.some(arg => arg !== '--apply' && !/^--league=\d+$/.test(arg))) {
  throw new Error('Usage: node scripts/db/repairWarehouseDurations.js <existing-LadsData.db> [--league=ID] [--apply]');
}
const target = resolve(filename), db = new Database(target, { fileMustExist: true, readonly: !apply });
try {
  configureWarehouseConnection(db, { role: apply ? 'migration' : 'readonly' });
  const plan = planWarehouseDurationRepair(db, { leagueId: league === undefined ? null : Number(league) });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', ...plan }, null, 2));
  if (apply && plan.repairable) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${target}.before-duration-repair-${stamp}.bak`, report = `${target}.duration-repair-${stamp}.json`;
    await db.backup(backup);
    writeFileSync(report, JSON.stringify({ database: target, backup, plan, status: 'planned' }, null, 2), { flag: 'wx' });
    const result = await withSqliteBusyRetry(() => applyWarehouseDurationRepair(db, plan));
    writeFileSync(report, JSON.stringify({ database: target, backup, plan, status: 'complete', ...result }, null, 2));
    console.log(JSON.stringify({ backup, report, repaired: result.repaired.length, skipped: result.skipped.length }, null, 2));
  } else console.log(apply ? 'No recoverable missing durations.' : 'Preview only. Add --apply to back up and recover missing durations from saved responses. No API requests are made.');
} finally { db.close(); }
