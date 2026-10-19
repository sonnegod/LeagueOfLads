import { resolve, dirname, basename } from 'node:path';
import {existsSync,realpathSync} from 'node:fs';
import { analyticsPaths } from '../analytics/config.js';

export function localBettingTestMode(env=process.env) {
  if(env.BETTING_LOCAL_TEST_MODE!=='true')return false;
  if(env.ENVIRONMENT!=='DEV'||env.NODE_ENV==='production')throw new Error('Local betting tests require ENVIRONMENT=DEV and cannot run in production');
  return true;
}

export function bettingDatabasePath(leaguePath=analyticsPaths().league,env=process.env) {
  const normal=resolve(env.BETTING_DB||resolve(dirname(leaguePath),'Betting.db'));
  if(!localBettingTestMode(env))return normal;
  const test=resolve(env.BETTING_LOCAL_TEST_DB||resolve(dirname(leaguePath),'Betting-local-test.db'));
  const sources=analyticsPaths(env);
  const identity=p=>{const full=resolve(p);return (existsSync(full)?realpathSync.native(full)
    :existsSync(dirname(full))?resolve(realpathSync.native(dirname(full)),basename(full)):full).toLowerCase();};
  if([normal,leaguePath,sources.analytics,sources.public].some(p=>identity(p)===identity(test)))
    throw new Error('Local betting tests need a separate Betting-local-test database');
  return test;
}
