import Database from 'better-sqlite3';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) {
  console.error('Usage: node scripts/db/exportLadsDataSchema.js <source.db> <output.sql>');
  process.exit(1);
}

const source = resolve(sourceArg);
const output = resolve(outputArg);
if (!existsSync(source)) throw new Error(`Source database does not exist: ${source}`);
if (source === output) throw new Error('Source and output must be different files');

const db = new Database(source, { readonly: true, fileMustExist: true });
let objects;
try {
  objects = db.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*'
    ORDER BY CASE type
      WHEN 'table' THEN 0
      WHEN 'index' THEN 1
      WHEN 'view' THEN 2
      WHEN 'trigger' THEN 3
      ELSE 4 END, name
  `).all();
} finally {
  db.close();
}

if (!objects.some((object) => object.type === 'table')) {
  throw new Error('No user tables found; refusing to write an empty schema');
}

const schema = [
  '-- Schema only, exported from LadsData.db. No league, team, match, or user data is included.',
  '-- Regenerate with: node scripts/db/exportLadsDataSchema.js db/LadsData.db scripts/db/ladsData.schema.sql',
  '',
  ...objects.map((object) => `-- ${object.type}: ${object.name}\n${object.sql.trim().replace(/;+$/, '')};\n`),
].join('\n');

writeFileSync(output, schema, 'utf8');
const tables = objects.filter((object) => object.type === 'table').length;
const indexes = objects.filter((object) => object.type === 'index').length;
console.log(`Exported ${tables} tables and ${indexes} indexes to ${output}`);
