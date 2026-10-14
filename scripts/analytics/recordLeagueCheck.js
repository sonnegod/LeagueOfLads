import 'dotenv/config';
import Database from 'better-sqlite3';
import { analyticsPaths } from '../../analytics/config.js';
import { ensureSourceMetadata, startSourceLoad, finishSourceLoad } from '../../analytics/sourceMetadata.js';

// A successful no-active-league check is fresh information too. Do not mark an
// active league fresh without running its actual ingestion jobs.
const db = new Database(analyticsPaths().league, { fileMustExist: true });
try {
  if (db.prepare('SELECT 1 FROM LeagueInfo WHERE Active = 1 LIMIT 1').get()) {
    throw new Error('A league is active; run league ingestion instead');
  }
  ensureSourceMetadata(db);
  db.transaction(() => {
    for (const source of ['match_history', 'match_details']) {
      finishSourceLoad(db, startSourceLoad(db, source));
    }
  })();
} finally { db.close(); }
