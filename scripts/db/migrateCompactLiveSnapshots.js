import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const databasePath = process.argv[2];
if (!databasePath || process.argv.length !== 3) {
  console.error('Usage: node scripts/db/migrateCompactLiveSnapshots.js <existing-LadsData.db>');
  process.exit(1);
}

const target = resolve(databasePath);
if (!existsSync(target)) throw new Error(`Database does not exist: ${target}`);

const db = new Database(target, { fileMustExist: true });
try {
  db.pragma('busy_timeout = 5000');
  const snapshotColumns = new Set(db.pragma('table_info(LiveMatchSnapshots)').map((column) => column.name));
  const currentColumns = new Set(db.pragma('table_info(LiveMatchCurrentState)').map((column) => column.name));
  if (!snapshotColumns.has('SnapshotId') || !snapshotColumns.has('MatchId') ||
      !currentColumns.has('MatchId') || !currentColumns.has('RadiantTeamName') ||
      !currentColumns.has('DireTeamName')) {
    throw new Error('LiveMatchSnapshots table is missing or incompatible');
  }

  const snapshotHasRaw = snapshotColumns.has('ResponseJson');
  const currentHasRaw = currentColumns.has('ResponseJson');
  if (!snapshotHasRaw && snapshotColumns.has('RadiantTeamName') &&
      snapshotColumns.has('DireTeamName') && !currentHasRaw) {
    console.log(`Live match state and snapshots are already compact in ${target}`);
  } else {
    if (!snapshotHasRaw &&
        (!snapshotColumns.has('RadiantTeamName') || !snapshotColumns.has('DireTeamName'))) {
      throw new Error('Cannot recover team names: ResponseJson column is already missing');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${target}.live-snapshots-${stamp}-${process.pid}.bak`;
    if (existsSync(backup)) throw new Error(`Backup path already exists: ${backup}`);
    await db.backup(backup);
    console.log(`Backup created: ${backup}`);

    db.transaction(() => {
      if (!snapshotColumns.has('RadiantTeamName')) {
        db.exec('ALTER TABLE LiveMatchSnapshots ADD COLUMN RadiantTeamName TEXT');
      }
      if (!snapshotColumns.has('DireTeamName')) {
        db.exec('ALTER TABLE LiveMatchSnapshots ADD COLUMN DireTeamName TEXT');
      }

      if (snapshotHasRaw) {
        db.exec(`
          UPDATE LiveMatchSnapshots
          SET RadiantTeamName = COALESCE(
                RadiantTeamName,
                CASE WHEN json_valid(ResponseJson) THEN COALESCE(
                  json_extract(ResponseJson, '$.radiant_team.team_name'),
                  json_extract(ResponseJson, '$.radiant_team_name'),
                  json_extract(ResponseJson, '$.team_name_radiant')
                ) END
              ),
              DireTeamName = COALESCE(
                DireTeamName,
                CASE WHEN json_valid(ResponseJson) THEN COALESCE(
                  json_extract(ResponseJson, '$.dire_team.team_name'),
                  json_extract(ResponseJson, '$.dire_team_name'),
                  json_extract(ResponseJson, '$.team_name_dire')
                ) END
              )
        `);
        db.exec('ALTER TABLE LiveMatchSnapshots DROP COLUMN ResponseJson');
      }

      if (currentHasRaw) {
        db.exec(`
          UPDATE LiveMatchCurrentState
          SET RadiantTeamName = COALESCE(
                RadiantTeamName,
                CASE WHEN json_valid(ResponseJson) THEN COALESCE(
                  json_extract(ResponseJson, '$.radiant_team.team_name'),
                  json_extract(ResponseJson, '$.radiant_team_name'),
                  json_extract(ResponseJson, '$.team_name_radiant')
                ) END
              ),
              DireTeamName = COALESCE(
                DireTeamName,
                CASE WHEN json_valid(ResponseJson) THEN COALESCE(
                  json_extract(ResponseJson, '$.dire_team.team_name'),
                  json_extract(ResponseJson, '$.dire_team_name'),
                  json_extract(ResponseJson, '$.team_name_dire')
                ) END
              )
        `);
        db.exec('ALTER TABLE LiveMatchCurrentState DROP COLUMN ResponseJson');
      }
    })();

    db.exec('VACUUM');
    console.log(`Compacted live match state and snapshots in ${target}`);
  }
} finally {
  db.close();
}
