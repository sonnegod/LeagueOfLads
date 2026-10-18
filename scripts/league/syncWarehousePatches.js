import Database from 'better-sqlite3';
import { initializeWarehouse } from '../../config/warehouseIngestion.js';
import { syncWarehousePatches } from '../../config/warehousePatches.js';
import { configureWarehouseConnection } from '../../config/warehouseConnection.js';

const db = new Database(process.argv[2] || 'db/LadsData.db', { fileMustExist: true });
try {
  configureWarehouseConnection(db, { role: 'background' });
  initializeWarehouse(db);
  console.log(JSON.stringify(await syncWarehousePatches(db)));
} finally { db.close(); }
