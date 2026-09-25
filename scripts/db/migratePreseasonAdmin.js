import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const targetArg = process.argv[2];
if (!targetArg || process.argv.length !== 3) {
  console.error('Usage: node scripts/db/migratePreseasonAdmin.js <existing-LadsData.db>');
  process.exit(1);
}

const target = resolve(targetArg);
if (!existsSync(target)) throw new Error(`Database does not exist: ${target}`);

const migration = `
  CREATE TABLE IF NOT EXISTS LeagueTeamNames (
    LeagueId INTEGER NOT NULL,
    TeamId INTEGER NOT NULL,
    DisplayName TEXT NOT NULL,
    PRIMARY KEY (LeagueId, TeamId)
  );
  CREATE TABLE IF NOT EXISTS GroupResultOverrides (
    LeagueId INTEGER NOT NULL,
    GroupId INTEGER NOT NULL,
    TeamA INTEGER NOT NULL,
    TeamB INTEGER NOT NULL,
    WinsA INTEGER NOT NULL CHECK (WinsA >= 0),
    WinsB INTEGER NOT NULL CHECK (WinsB >= 0),
    BaseWinsA INTEGER NOT NULL DEFAULT 0,
    BaseWinsB INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (LeagueId, GroupId, TeamA, TeamB),
    CHECK (TeamA < TeamB)
  );
  CREATE TABLE IF NOT EXISTS LeagueRosterEntries (
    EntryId INTEGER PRIMARY KEY AUTOINCREMENT,
    LeagueId INTEGER NOT NULL,
    GroupId INTEGER NOT NULL,
    DisplayName TEXT NOT NULL,
    TeamId INTEGER,
    SortOrder INTEGER NOT NULL,
    UNIQUE (LeagueId, TeamId)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_LeagueRosterEntries_LeagueGroupName
    ON LeagueRosterEntries (LeagueId, GroupId, DisplayName COLLATE NOCASE);
`;

function verifySchema(db) {
  const required = {
    LeagueTeamNames: ['LeagueId', 'TeamId', 'DisplayName'],
    GroupResultOverrides: [
      'LeagueId', 'GroupId', 'TeamA', 'TeamB', 'WinsA', 'WinsB', 'BaseWinsA', 'BaseWinsB',
    ],
    LeagueRosterEntries: ['EntryId', 'LeagueId', 'GroupId', 'DisplayName', 'TeamId', 'SortOrder'],
  };
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set(db.pragma(`table_info(${table})`).map((column) => column.name));
    if (columns.some((column) => !actual.has(column))) return false;
  }
  const primaryKey = (table) => db.pragma(`table_info(${table})`)
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name).join(',');
  if (primaryKey('LeagueTeamNames') !== 'LeagueId,TeamId' ||
      primaryKey('GroupResultOverrides') !== 'LeagueId,GroupId,TeamA,TeamB' ||
      primaryKey('LeagueRosterEntries') !== 'EntryId') return false;
  const roster = db.pragma('table_info(LeagueRosterEntries)');
  if (roster.find((column) => column.name === 'TeamId')?.notnull) return false;
  const hasUniqueTeamId = db.pragma('index_list(LeagueRosterEntries)').some((index) => {
    if (!index.unique) return false;
    const columns = db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno')
      .all(index.name).map((column) => column.name);
    return columns.join(',') === 'LeagueId,TeamId';
  });
  if (!hasUniqueTeamId) return false;
  const index = db.prepare(`SELECT sql FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_LeagueRosterEntries_LeagueGroupName'`).get();
  return Boolean(index?.sql && /UNIQUE INDEX/i.test(index.sql) && /COLLATE NOCASE/i.test(index.sql));
}

const db = new Database(target, { fileMustExist: true });
try {
  db.pragma('busy_timeout = 5000');
  const baseTables = ['LeagueInfo', 'GroupNames', 'LeagueGroups'];
  const found = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()
    .map((row) => row.name));
  const missing = baseTables.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Not a supported LadsData database; missing: ${missing.join(', ')}`);

  if (verifySchema(db)) {
    console.log(`Preseason admin schema already present in ${target}`);
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${target}.preseason-admin-${stamp}-${process.pid}.bak`;
    if (existsSync(backup)) throw new Error(`Backup path already exists: ${backup}`);
    await db.backup(backup);
    console.log(`Backup created: ${backup}`);

    db.transaction(() => {
      db.exec(migration);
      if (!verifySchema(db)) throw new Error('Migration did not create the expected schema');
    })();
    console.log(`Preseason admin schema migrated: ${target}`);
  }
} finally {
  db.close();
}
