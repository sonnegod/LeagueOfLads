import 'dotenv/config';
import Database from 'better-sqlite3';
import {fileURLToPath} from 'node:url';
import {InhouseStore} from '../../inhouses/store.js';
import {createSteamInhouseClient} from '../../inhouses/steam.js';
import {createInhouseWorker} from '../../inhouses/worker.js';
import {configureWarehouseConnection} from '../../config/warehouseConnection.js';

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
  const controller = new AbortController();
  const worker = createInhouseWorker(store, createSteamInhouseClient({signal: controller.signal}));
  let stopping = false;
  const stop = () => {stopping = true; controller.abort(); worker.close();};
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const maintenance = setInterval(() => {
    try {worker.maintain();} catch (error) {console.error('Inhouse maintenance:', error.code || 'Unexpected error');}
  }, 1000);
  console.log('Inhouse worker started.');
  try {
    do {
      try {await worker.step();}
      catch (error) {console.error('Inhouse worker:', error.status ? error.message : error.code || 'Unexpected error');}
      if (!stopping && !args.includes('--once')) await new Promise(resolve => setTimeout(resolve, 1000));
    } while (!stopping && !args.includes('--once'));
  } finally {clearInterval(maintenance); worker.close(); db.close();}
}
