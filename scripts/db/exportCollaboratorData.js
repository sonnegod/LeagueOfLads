import Database from 'better-sqlite3';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { sanitizeCollaboratorCopy, verifyCollaboratorCopy, collaboratorHistoryCounts } from '../../config/collaboratorExport.js';

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg || process.argv.length !== 4) {
  console.error('Usage: node scripts/db/exportCollaboratorData.js <source.db> <new-export.db>');
  process.exit(1);
}
const source = resolve(sourceArg), output = resolve(outputArg);
if (source === output) throw new Error('Source and export paths must differ');
await mkdir(dirname(output), { recursive: true });
// Private staging never lives in backups/, which older checkouts may track.
const stageDir = resolve('.scratch', `collaborator-export-${Date.now()}-${process.pid}`);
await mkdir(stageDir, { recursive: true });
const stage = resolve(stageDir, 'LadsData.db');
const original = new Database(source, { readonly: true, fileMustExist: true });
try {
  original.pragma('busy_timeout = 5000');
  console.log('Creating a consistent SQLite snapshot; the source is read-only.');
  await original.backup(stage);
} finally { original.close(); }
const copy = new Database(stage, { fileMustExist: true });
let report;
try {
  copy.pragma('journal_mode = DELETE');
  const before = collaboratorHistoryCounts(copy);
  const cleared = sanitizeCollaboratorCopy(copy);
  console.log('Private records cleared. Compacting the export.');
  copy.exec('VACUUM');
  const checks = verifyCollaboratorCopy(copy, { progress: value => console.log(`Checked ${value.archives} compressed match archives.`) });
  const after = collaboratorHistoryCounts(copy);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Historical/public roster row counts changed');
  report = { format: 'lads-collaborator-export-v1', createdAtUtc: new Date().toISOString(), cleared, history: after, checks };
} finally { copy.close(); }
// Publication occurs only after every privacy and history check succeeds.
await copyFile(stage, output, constants.COPYFILE_EXCL);
const hash = createHash('sha256');
for await (const chunk of createReadStream(output)) hash.update(chunk);
report.sha256 = hash.digest('hex'); report.bytes = (await stat(output)).size;
await pipeline(createReadStream(output), createGzip({ level: 6 }), createWriteStream(output + '.gz', { flags: 'wx' }));
report.compressedBytes = (await stat(output + '.gz')).size;
await writeFile(output + '.report.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
await unlink(stage);
await rmdir(stageDir);
console.log(JSON.stringify({ output, ...report }, null, 2));
