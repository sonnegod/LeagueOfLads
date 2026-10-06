import Database from 'better-sqlite3';
import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureAnalyticsSchema } from './analyticsSchema.js';

const targetArg = process.argv[2] || 'db/Analytics.db';
if (process.argv.length > 3) {
  console.error('Usage: node scripts/db/createAnalyticsDb.js [new-database-path]');
  process.exit(1);
}

const target = resolve(targetArg);
if (!existsSync(dirname(target))) throw new Error(`Parent directory does not exist: ${dirname(target)}`);

// Reserve the new path exclusively. Never open or overwrite an existing DB.
try {
  closeSync(openSync(target, 'wx'));
} catch (error) {
  if (error.code === 'EEXIST') throw new Error(`Database already exists: ${target}`);
  throw error;
}

let db;
try {
  db = new Database(target, { fileMustExist: true });
  ensureAnalyticsSchema(db);
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
  console.log(`Created ${target}`);
} catch (error) {
  if (db?.open) db.close();
  unlinkSync(target);
  throw error;
} finally {
  if (db?.open) db.close();
}
