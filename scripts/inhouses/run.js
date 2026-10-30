import 'dotenv/config';
import Database from 'better-sqlite3';
import {fileURLToPath} from 'node:url';
import {InhouseStore} from '../../inhouses/store.js';
import {createInhouseWorker} from '../../inhouses/worker.js';
import {configureWarehouseConnection} from '../../config/warehouseConnection.js';
import {createInhouseBotPool} from '../../inhouses/botPool.js';

const args = process.argv.slice(2);
if (args.some(arg => !['--once', '--init-only'].includes(arg))) throw new Error('Use --once or --init-only');
const dbPath = process.env.ENVIRONMENT === 'DEV'
  ? fileURLToPath(new URL('../../db/LadsData.db', import.meta.url)) : '/root/LeagueOfLads/db/LadsData.db';
// Never import database.js here: live league preloads/migrations are unnecessary
// for an outcome-only worker, and must not start overnight ingestion.
const db = new Database(dbPath, {fileMustExist: true});
configureWarehouseConnection(db, {role: 'background'});
const store = new InhouseStore(db);
if (args.includes('--init-only')) {
  console.log('Inhouse tables are ready. Configure the ticket in Admin > Inhouses.');
  db.close();
} else {
  const pool = createInhouseBotPool(store);
  const worker = createInhouseWorker(store, pool);
  if (!worker.claim()) {db.close(); throw new Error('Another inhouse worker is already running');}
  let stopping = false;
  const stop = () => {stopping = true; worker.close();};
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log('Inhouse worker started.');
  try {
    do {
      try {if ((await worker.step()).skipped) stopping = true;}
      catch (error) {console.error('Inhouse worker:', error.status ? error.message : error.code || 'Unexpected error');}
      if (!stopping && !args.includes('--once')) await new Promise(resolve => setTimeout(resolve, 1000));
    } while (!stopping && !args.includes('--once'));
  } finally {worker.close(); db.close();}
}
