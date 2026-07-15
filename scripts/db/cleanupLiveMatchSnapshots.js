import db from '../../database.js';

const DEFAULT_RETENTION_DAYS = 7;
const retentionDays = Number(process.argv[2] || DEFAULT_RETENTION_DAYS);

try {
  const deleted = db.deleteLiveMatchSnapshotsOlderThan(retentionDays);

  console.log(
    `Deleted live-match data older than ${retentionDays} days: ` +
    `${deleted.snapshots} snapshots, ${deleted.players} player rows, ` +
    `${deleted.drafts} draft rows.`
  );

  if (deleted.snapshots > 0 || deleted.players > 0 || deleted.drafts > 0) {
    console.log('Compacting LadsData.db to reclaim deleted snapshot space.');
    db.db.exec('VACUUM');
    console.log('Database compaction complete.');
  }
} catch (err) {
  console.error(`Live-match snapshot cleanup failed: ${err.message}`);
  process.exitCode = 1;
}
