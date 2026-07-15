import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..', '..');
const databasePath = path.resolve(process.argv[2] || path.join(rootDir, 'db', 'LadsData.db'));
const initialAdminAccountId = 49219700;

const db = new Database(databasePath);

function tableExists(tableName) {
  return !!db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName);
}

function columnNames(tableName) {
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name)
  );
}

const setupAdminSchema = db.transaction(() => {
  if (!tableExists('AdminInfo')) {
    db.exec(`
      CREATE TABLE AdminInfo (
        AccountId INTEGER PRIMARY KEY,
        HeadAdmin INTEGER NOT NULL DEFAULT 0 CHECK (HeadAdmin IN (0, 1)),
        SystemAdmin INTEGER NOT NULL DEFAULT 0 CHECK (SystemAdmin IN (0, 1)),
        CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    const adminColumns = columnNames('AdminInfo');
    if (!adminColumns.has('AccountId') && adminColumns.has('SteamId')) {
      db.exec(`ALTER TABLE AdminInfo RENAME COLUMN SteamId TO AccountId`);
    }

    if (!columnNames('AdminInfo').has('AccountId')) {
      throw new Error('AdminInfo exists but has no AccountId column');
    }
  }

  if (tableExists('Logins')) {
    const loginColumns = columnNames('Logins');
    if (!loginColumns.has('AccountId') && loginColumns.has('SteamID')) {
      db.exec(`ALTER TABLE Logins RENAME COLUMN SteamID TO AccountId`);
    }

    if (!columnNames('Logins').has('AccountId')) {
      throw new Error('Logins exists but has no AccountId column');
    }
  }

  db.prepare(`
    INSERT INTO AdminInfo (AccountId, HeadAdmin, SystemAdmin)
    VALUES (?, 0, 1)
    ON CONFLICT(AccountId) DO UPDATE SET
      HeadAdmin = excluded.HeadAdmin,
      SystemAdmin = excluded.SystemAdmin
  `).run(initialAdminAccountId);
});

try {
  setupAdminSchema();
  const admin = db.prepare(`
    SELECT AccountId, HeadAdmin, SystemAdmin, CreatedAt
    FROM AdminInfo
    WHERE AccountId = ?
  `).get(initialAdminAccountId);

  console.log(`Admin schema ready in ${databasePath}`);
  console.log(admin);
} catch (err) {
  console.error(`Admin schema setup failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
