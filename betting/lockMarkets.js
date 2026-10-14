import 'dotenv/config';
import Database from 'better-sqlite3';
import { resolve,dirname } from 'node:path';
import { analyticsPaths } from '../analytics/config.js';
import { BettingStore } from './store.js';

const paths=analyticsPaths();const db=new Database(resolve(process.env.BETTING_DB||resolve(dirname(paths.league),'Betting.db')));
try {
  new BettingStore(db);
  const result=db.prepare("UPDATE BettingMarkets SET Status='locked' WHERE Status IN ('open','held') AND CloseAtUtc<=?").run(new Date().toISOString());
  console.log(JSON.stringify({locked:result.changes}));
}catch(error){console.error('Market locking failed:',error.code||'internal');process.exitCode=1;}
finally{db.close();}
