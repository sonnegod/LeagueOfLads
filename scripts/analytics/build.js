import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyticsPaths, positiveId, previewAnalyticsPath } from '../../analytics/config.js';
import { openAnalytics, readAnalyticsStatus, safeAnalyticsStatus } from '../../analytics/store.js';
import { buildAnalytics } from '../../analytics/build.js';

const paths = analyticsPaths();
const options = { firstSeasonId: process.env.ANALYTICS_FIRST_SEASON_ID || null };
const canonicalPath = paths.analytics;
let explicitTarget = false;
let explicitFirstSeason = false;
const flags = { '--league-db': 'league', '--public-db': 'public', '--analytics-db': 'analytics' };
let analytics; let league; let publicDb;
try {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--init-only') options.init = true;
    else if (arg === '--status') options.status = true;
    else if (arg === '--help') {
      console.log('Usage: node scripts/analytics/build.js [--init-only|--status] [--league-db path] [--public-db path] [--analytics-db path] [--first-season id] [--season-id id | --preview-league leagueId]');
      process.exit(0);
    } else if (flags[arg] || ['--first-season', '--season-id', '--preview-league'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (flags[arg]) {
        paths[flags[arg]] = resolve(value);
        if (arg === '--analytics-db') explicitTarget = true;
      } else if (arg === '--first-season') {
        options.firstSeasonId = positiveId(value, 'first signup season'); explicitFirstSeason = true;
      }
      else if (arg === '--season-id') options.seasonId = positiveId(value, 'season');
      else options.previewLeagueId = positiveId(value, 'preview league');
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.previewLeagueId) {
    if (options.seasonId || explicitFirstSeason) throw new Error('Choose a signup season filter or a historical preview, not both');
    if (!explicitTarget) paths.analytics = previewAnalyticsPath(canonicalPath, options.previewLeagueId);
    if (paths.analytics.toLowerCase() === canonicalPath.toLowerCase()) throw new Error('Historical previews require a separate Analytics database');
    options.firstSeasonId = null;
  }
  if (new Set(Object.values(paths).map(path => process.platform === 'win32' ? path.toLowerCase() : path)).size !== 3) {
    throw new Error('Source and Analytics database paths must be different');
  }
  if (options.status) {
    console.log(JSON.stringify(readAnalyticsStatus(paths.analytics), null, 2));
  } else {
    analytics = openAnalytics(paths.analytics);
    if (!options.init) {
      if (!existsSync(paths.league)) throw new Error('League source database does not exist');
      league = new Database(paths.league, { readonly: true, fileMustExist: true });
      league.pragma('busy_timeout = 5000');
      if (existsSync(paths.public)) publicDb = new Database(paths.public, { readonly: true, fileMustExist: true });
      buildAnalytics({ analytics, league, publicDb, firstSeasonId: options.firstSeasonId,
        seasonId: options.seasonId, previewLeagueId: options.previewLeagueId });
    }
    console.log(JSON.stringify(safeAnalyticsStatus(analytics), null, 2));
  }
} catch (error) {
  console.error(`Analytics job failed: ${error.code === 'ANALYTICS_BUILD_BUSY' ? 'another build is running' : error.message}`);
  process.exitCode = 1;
} finally {
  publicDb?.close(); league?.close(); analytics?.close();
}
