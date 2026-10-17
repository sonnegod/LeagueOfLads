import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { planWarehouseCollection } from '../../config/warehouseCollection.js';
import { initializeWarehouse, ingestWarehouseMatch, recordWarehouseFailure } from '../../config/warehouseIngestion.js';
import { captureWarehouseBaseline, compareWarehouseBaseline, validateWarehouse } from '../../config/warehouseValidation.js';
import { configureWarehouseConnection, withSqliteBusyRetry, isSqliteBusy, checkpointWarehouse } from '../../config/warehouseConnection.js';

const [filename, ...args] = process.argv.slice(2);
const arg = key => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
if (!filename || args.some(a => !['--apply','--force','--no-backup'].includes(a) && !/^--(league|limit|delay-ms)=.+$/.test(a))) {
  throw new Error('Usage: node scripts/league/enrichWarehouse.js <existing-LadsData.db> --league=ID [--limit=25] [--delay-ms=1100] [--apply] [--force] [--no-backup]');
}
const leagueId = Number(arg('league')), limit = Number(arg('limit') || 25), delay = Number(arg('delay-ms') || 1100);
if (!Number.isSafeInteger(delay) || delay < 1100 || delay > 60000) throw new Error('Delay must be 1100–60000 ms');
const apply = args.includes('--apply'), target = resolve(filename);
const db = new Database(target, { fileMustExist: true, readonly: !apply });
let stopped = false, activeRequest;
const stop = () => { stopped = true; activeRequest?.abort(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  configureWarehouseConnection(db, { role: apply ? 'background' : 'readonly' });
  const plan = planWarehouseCollection(db, { leagueId, limit, force: args.includes('--force') });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', ...plan }, null, 2));
  if (apply && plan.selectedMatchIds.length) {
    if (args.includes('--no-backup')) console.log('Backup skipped (--no-backup); protected-data validation remains enabled.');
    else {
      const folder = resolve(dirname(target), '..', 'backups', 'LadsData');
      mkdirSync(folder, { recursive: true });
      const backup = join(folder, `LadsData_before-edw-pilot-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      await db.backup(backup);
      console.log(`Backup created: ${backup}`);
    }
    const baseline = captureWarehouseBaseline(db);
    initializeWarehouse(db);
    const totals = { requests: 0, ready: 0, partial: 0, failed: 0 };
    for (const matchId of plan.selectedMatchIds) {
      if (stopped) break;
      // An admin might have removed the match after the plan was generated.
      if (!db.prepare('SELECT 1 FROM MatchTeam WHERE MatchId=?').get(matchId)) continue;
      if (totals.requests) await new Promise(r => setTimeout(r, delay));
      if (stopped) break;
      activeRequest = new AbortController();
      const timer = setTimeout(() => activeRequest.abort(), 20000);
      try {
        totals.requests++;
        const response = await fetch(`https://api.opendota.com/api/matches/${matchId}`, { signal: activeRequest.signal });
        if (!response.ok) {
          const error = new Error(`OpenDota returned ${response.status}`);
          error.rateLimit = Object.fromEntries([...response.headers].filter(([name]) =>
            name === 'retry-after' || /^x-ratelimit-|^x-rate-limit-/.test(name)));
          if ([401,403,429].includes(response.status)) { stopped = true; error.stopCollection = true; }
          throw error;
        }
        const data = await response.json();
        const result = await withSqliteBusyRetry(() => ingestWarehouseMatch(db, data, { expectedMatchId: matchId }));
        totals[result.status]++;
        console.log(JSON.stringify({ matchId, status: result.status, sections: result.sections, issues: result.issues }));
      } catch (error) {
        if (!activeRequest.signal.aborted || !stopped) {
          totals.failed++;
          if (isSqliteBusy(error)) stopped = true;
          else if (!error.stopCollection) recordWarehouseFailure(db, matchId, error);
          console.warn(JSON.stringify({ matchId, error: error.message, issues: error.issues || [], ...(error.rateLimit ? { rateLimit: error.rateLimit } : {}) }));
        }
      } finally { clearTimeout(timer); activeRequest = null; }
    }
    const reconciliation = compareWarehouseBaseline(db, baseline), validation = validateWarehouse(db, { leagueId, deep: true });
    const checkpoint = checkpointWarehouse(db);
    console.log(JSON.stringify({ totals, stopped, reconciliation, validation, checkpoint }, null, 2));
    if (totals.failed || !reconciliation.unchanged || !validation.valid) process.exitCode = 1;
  }
} finally {
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  db.close();
}
