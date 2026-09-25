import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [databasePath, rawPlayerId, ...nameParts] = process.argv.slice(2);
const playerId = Number(rawPlayerId);
const playerName = nameParts.join(' ').trim();

if (!databasePath || !Number.isSafeInteger(playerId) || playerId <= 0 || !playerName) {
  console.error('Usage: node scripts/db/migrateAdmins.js <existing-LadsData.db> <admin-account-id> <admin-name>');
  process.exit(1);
}

const target = resolve(databasePath);
if (!existsSync(target)) throw new Error(`Database does not exist: ${target}`);

const db = new Database(target, { fileMustExist: true });
try {
  db.pragma('busy_timeout = 5000');
  const tables = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all().map((row) => row.name));
  if (!tables.has('Logins')) throw new Error('Not a supported LadsData database: Logins table is missing');

  const columns = db.pragma('table_info(Admins)');
  if (tables.has('Admins') && (
    columns.length !== 3 ||
    !['AdminPlayerId', 'AdminPlayerName', 'HeadAdmin'].every((name) =>
      columns.some((column) => column.name === name)) ||
    columns.find((column) => column.name === 'AdminPlayerId')?.pk !== 1
  )) {
    throw new Error('Admins table already exists with an incompatible schema');
  }

  const existing = tables.has('Admins')
    ? db.prepare('SELECT HeadAdmin FROM Admins WHERE AdminPlayerId = ?').get(playerId)
    : null;
  if (existing) {
    if (existing.HeadAdmin !== 1) {
      throw new Error('Bootstrap admin already exists without HeadAdmin access; update that row explicitly');
    }
    console.log(`Admins table and bootstrap admin already present in ${target}`);
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${target}.admins-${stamp}-${process.pid}.bak`;
    if (existsSync(backup)) throw new Error(`Backup path already exists: ${backup}`);
    await db.backup(backup);
    console.log(`Backup created: ${backup}`);

    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS Admins (
        AdminPlayerId INTEGER PRIMARY KEY NOT NULL,
        AdminPlayerName TEXT NOT NULL,
        HeadAdmin INTEGER NOT NULL DEFAULT 0 CHECK (HeadAdmin IN (0, 1))
      )`);
      db.prepare(`INSERT INTO Admins (AdminPlayerId, AdminPlayerName, HeadAdmin)
        VALUES (?, ?, 1)`).run(playerId, playerName);
    })();
    console.log(`Admins table migrated and head admin added: ${target}`);
  }
} finally {
  db.close();
}
