import Database from 'better-sqlite3';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const targetArg = process.argv[2];
if (!targetArg || process.argv.length !== 3) {
  console.error('Usage: node scripts/db/createLadsDataDb.js <new-database-path>');
  process.exit(1);
}

const target = resolve(targetArg);
if (!existsSync(dirname(target))) throw new Error(`Parent directory does not exist: ${dirname(target)}`);
const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), 'ladsData.schema.sql');
const schema = readFileSync(schemaPath, 'utf8');
if (!schema.trim()) throw new Error('Schema file is empty');

// Reserve the path exclusively so an existing database can never be overwritten.
try {
  closeSync(openSync(target, 'wx'));
} catch (error) {
  if (error.code === 'EEXIST') throw new Error(`Database already exists: ${target}`);
  throw error;
}
let db;
try {
  db = new Database(target, { fileMustExist: true });
  db.transaction(() => db.exec(schema))();
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
  const objects = db.prepare(`
    SELECT type, COUNT(*) AS count FROM sqlite_master
    WHERE name NOT GLOB 'sqlite_*' GROUP BY type
  `).all();
  const labels = { table: 'tables', index: 'indexes', view: 'views', trigger: 'triggers' };
  console.log(`Created ${target}: ${objects.map(({ type, count }) => `${count} ${labels[type] || type}`).join(', ')}`);
} catch (error) {
  if (db?.open) db.close();
  unlinkSync(target);
  throw error;
} finally {
  if (db?.open) db.close();
}
