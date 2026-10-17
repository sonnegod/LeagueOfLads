import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureWarehouseBaseline, compareWarehouseBaseline, validateWarehouse } from '../../config/warehouseValidation.js';
import { configureWarehouseConnection } from '../../config/warehouseConnection.js';

const [filename, ...args] = process.argv.slice(2);
const arg = key => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
if (!filename || args.some(a => a !== '--deep' && !/^--(baseline|compare|league)=.+$/.test(a)) || (arg('baseline') && arg('compare'))) {
  throw new Error('Usage: node scripts/db/validateWarehouse.js <existing-LadsData.db> [--league=ID] [--deep] [--baseline=new.json | --compare=baseline.json]');
}
const leagueId = arg('league') === undefined ? null : Number(arg('league'));
if (leagueId !== null && (!Number.isSafeInteger(leagueId) || leagueId <= 0)) throw new Error('Invalid league ID');
const db = new Database(resolve(filename), { readonly: true, fileMustExist: true });
try {
  configureWarehouseConnection(db, { role: 'readonly' });
  if (arg('baseline')) {
    const output = resolve(arg('baseline'));
    if (existsSync(output)) throw new Error('Baseline already exists; refusing to overwrite');
    writeFileSync(output, JSON.stringify(captureWarehouseBaseline(db), null, 2), { flag: 'wx' });
    console.log(`Baseline saved: ${output}`);
  } else {
    const reconciliation = arg('compare') ? compareWarehouseBaseline(db, JSON.parse(readFileSync(resolve(arg('compare')), 'utf8'))) : null;
    const validation = validateWarehouse(db, { leagueId, deep: args.includes('--deep') });
    console.log(JSON.stringify({ reconciliation, validation }, null, 2));
    if (!validation.valid || (reconciliation && !reconciliation.unchanged)) process.exitCode = 1;
  }
} finally { db.close(); }
