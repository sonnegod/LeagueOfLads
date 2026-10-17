import Database from 'better-sqlite3';
import { resolve, dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { warehouseNeedsMigration, WAREHOUSE_VERSION } from '../../config/warehouseSchema.js';
import { initializeWarehouse } from '../../config/warehouseIngestion.js';
import { captureWarehouseBaseline, compareWarehouseBaseline, validateWarehouse } from '../../config/warehouseValidation.js';
import { configureWarehouseConnection } from '../../config/warehouseConnection.js';

const [filename, ...flags] = process.argv.slice(2);
if (!filename || flags.some(f => f !== '--apply')) throw new Error('Usage: node scripts/db/migrateWarehouse.js <existing-LadsData.db> [--apply]');
const apply = flags.includes('--apply'), target = resolve(filename);
const db = new Database(target, { fileMustExist: true, readonly: !apply });
try {
  const connection = configureWarehouseConnection(db, { role: apply ? 'migration' : 'readonly' });
  const needed = warehouseNeedsMigration(db);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', connection, migrationVersion: WAREHOUSE_VERSION, migrationNeeded: needed }));
  if (apply) {
    if (needed) {
      const folder = resolve(dirname(target), '..', 'backups', 'LadsData');
      mkdirSync(folder, { recursive: true });
      const backup = join(folder, `LadsData_before-edw-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      await db.backup(backup);
      console.log(`Backup created: ${backup}`);
    }
    const before = captureWarehouseBaseline(db);
    initializeWarehouse(db);
    const reconciliation = compareWarehouseBaseline(db, before);
    const validation = validateWarehouse(db);
    console.log(JSON.stringify({ reconciliation, validation }, null, 2));
    if (!reconciliation.unchanged || !validation.valid) process.exitCode = 1;
  }
} finally { db.close(); }
