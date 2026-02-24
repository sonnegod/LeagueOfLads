import Database from 'better-sqlite3';
import dotenv from 'dotenv';

dotenv.config();

function resolveDbPaths() {
  if (process.env.ENVIRONMENT === 'DEV') {
    return {
      ladsDbPath: './db/LadsData.db',
      publicDbPath: './db/public.db',
    };
  }

  return {
    ladsDbPath: '/root/LeagueOfLads/db/LadsData.db',
    publicDbPath: '/root/LeagueOfLads/db/public.db',
  };
}

export function openPublicDataStores() {
  const { ladsDbPath, publicDbPath } = resolveDbPaths();
  const ladsDb = new Database(ladsDbPath);
  const publicDb = new Database(publicDbPath);

  ladsDb.pragma('journal_mode = WAL');
  publicDb.pragma('journal_mode = WAL');
  publicDb.pragma('foreign_keys = ON');

  return { ladsDb, publicDb };
}

export function assertPublicSchema(publicDb) {
  const requiredTables = ['PlayerInfo', 'PublicMatchPlayer'];
  const rows = publicDb
    .prepare(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN (${requiredTables.map(() => '?').join(', ')})
      `
    )
    .all(...requiredTables);

  const found = new Set(rows.map((row) => row.name));
  const missing = requiredTables.filter((name) => !found.has(name));

  if (missing.length > 0) {
    throw new Error(
      `Missing public.db tables: ${missing.join(', ')}. Run public_db_create_script.txt first.`
    );
  }

  const publicMatchPlayerColumns = new Set(
    publicDb
      .prepare(`PRAGMA table_info('PublicMatchPlayer')`)
      .all()
      .map((row) => row.name)
  );
  const requiredMatchColumns = [
    'MatchId',
    'PlayerId',
    'Won',
    'HeroId',
    'Kills',
    'Deaths',
    'Assists',
    'DateCreated',
  ];
  const missingMatchColumns = requiredMatchColumns.filter(
    (name) => !publicMatchPlayerColumns.has(name)
  );

  if (missingMatchColumns.length > 0) {
    throw new Error(
      `PublicMatchPlayer missing columns: ${missingMatchColumns.join(', ')}. Run public_db_create_script.txt.`
    );
  }
}

export function closePublicDataStores(stores) {
  if (stores?.ladsDb) stores.ladsDb.close();
  if (stores?.publicDb) stores.publicDb.close();
}
