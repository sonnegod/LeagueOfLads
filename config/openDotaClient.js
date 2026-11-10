import Database from 'better-sqlite3';
import {resolve} from 'node:path';

const ready=new WeakSet();
export function ensureOpenDotaBudget(db) {
  if(ready.has(db))return;
  db.exec(`CREATE TABLE IF NOT EXISTS OpenDotaUsage(Window TEXT PRIMARY KEY,Requests INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS OpenDotaThrottle(Id INTEGER PRIMARY KEY CHECK(Id=1),NextAt INTEGER NOT NULL DEFAULT 0,
      PauseUntil INTEGER NOT NULL DEFAULT 0,Reason TEXT);
    INSERT OR IGNORE INTO OpenDotaThrottle(Id) VALUES(1);`);
  ready.add(db);
}
export function reserveOpenDotaRequest(db,{now=Date.now(),priority='background',minuteLimit=30,monthlyLimit=45000}={}) {
  if(!Number.isSafeInteger(minuteLimit)||minuteLimit<1||minuteLimit>1200||!Number.isSafeInteger(monthlyLimit)||monthlyLimit<1)throw new Error('Configure positive integer OpenDota budgets (minute limit at most 1200)');
  ensureOpenDotaBudget(db);
  return db.transaction(()=>{
    const state=db.prepare('SELECT * FROM OpenDotaThrottle WHERE Id=1').get();
    const minute='minute:'+Math.floor(now/60000),month='month:'+new Date(now).toISOString().slice(0,7);
    const usage=window=>db.prepare('SELECT Requests FROM OpenDotaUsage WHERE Window=?').get(window)?.Requests||0;
    const nextMonth=new Date(now);nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1,1);nextMonth.setUTCHours(0,0,0,0);
    if(state.PauseUntil>now)return {retryAt:state.PauseUntil,reason:state.Reason||'OpenDota cooldown'};
    if(usage(month)>=monthlyLimit-(priority==='results'?0:Math.min(500,Math.floor(monthlyLimit/10))))return {retryAt:nextMonth.getTime(),reason:'OpenDota monthly budget reserved or exhausted'};
    if(usage(minute)>=minuteLimit-(priority==='results'?0:Math.min(8,Math.floor(minuteLimit/3))))return {retryAt:(Math.floor(now/60000)+1)*60000,reason:'OpenDota minute budget reserved or exhausted'};
    if(state.NextAt>now)return {retryAt:state.NextAt,reason:'OpenDota request pacing'};
    const add=db.prepare('INSERT INTO OpenDotaUsage VALUES(?,1) ON CONFLICT(Window) DO UPDATE SET Requests=Requests+1');
    add.run(minute);add.run(month);
    db.prepare('UPDATE OpenDotaThrottle SET NextAt=? WHERE Id=1').run(now+Math.ceil(60000/minuteLimit));
    db.prepare("DELETE FROM OpenDotaUsage WHERE Window LIKE 'minute:%' AND Window<?").run('minute:'+Math.floor((now-120000)/60000));
    return {allowed:true};
  }).immediate();
}
export async function fetchOpenDota(url,{db,priority='background',fetchImpl=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),...options}={}) {
  // Injected transports remain isolated in tests. Real callers share the league DB.
  if(!db&&fetchImpl!==globalThis.fetch)return fetchImpl(url,options);
  const owned=!db;
  if(!db)db=new Database(process.env.LEAGUE_DB_PATH||resolve(process.env.LEAGUE_OF_LADS_ROOT||(process.env.ENVIRONMENT==='DEV'?'.':'/root/LeagueOfLads'),'db/LadsData.db'),{fileMustExist:true});
  if(owned)db.pragma('busy_timeout = 5000');
  try {
    for(;;) {
      options.signal?.throwIfAborted();
      const permit=reserveOpenDotaRequest(db,{priority,minuteLimit:Number(process.env.OPENDOTA_REQUESTS_PER_MINUTE)||30,monthlyLimit:Number(process.env.OPENDOTA_MONTHLY_BUDGET)||45000});
      if(permit.allowed)break;
      const delay=permit.retryAt-Date.now();
      if(delay>60000)throw Object.assign(new Error(permit.reason),{retryAt:permit.retryAt,code:'OPENDOTA_DEFERRED'});
      await wait(Math.max(25,delay));
    }
    const target=new URL(url);
    if(process.env.OPENDOTA_API_KEY)target.searchParams.set('api_key',process.env.OPENDOTA_API_KEY);
    const response=await fetchImpl(target.toString(),{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
    if(response.status===429||response.headers?.get('x-rate-limit-remaining-minute')==='0'||response.headers?.get('x-rate-limit-remaining-month')==='0'||response.headers?.get('x-rate-limit-remaining-day')==='0') {
      const raw=response.headers.get('retry-after'),seconds=Number(raw);
      let until=raw&&Number.isFinite(seconds)?Date.now()+seconds*1000:Date.parse(raw)||Date.now()+60000;
      if(response.headers.get('x-rate-limit-remaining-month')==='0'){const date=new Date();date.setUTCMonth(date.getUTCMonth()+1,1);date.setUTCHours(0,0,0,0);until=Math.max(until,date.getTime());}
      else if(response.headers.get('x-rate-limit-remaining-day')==='0'){const date=new Date();date.setUTCDate(date.getUTCDate()+1);date.setUTCHours(0,0,0,0);until=Math.max(until,date.getTime());}
      db.prepare('UPDATE OpenDotaThrottle SET PauseUntil=MAX(PauseUntil,?),Reason=? WHERE Id=1').run(until,'OpenDota rate limit');
    }
    return response;
  }finally{if(owned)db.close();}
}
export function openDotaBudgetStatus(db) {
  ensureOpenDotaBudget(db);
  return {minuteLimit:Number(process.env.OPENDOTA_REQUESTS_PER_MINUTE)||30,monthlyLimit:Number(process.env.OPENDOTA_MONTHLY_BUDGET)||45000,
    monthRequests:db.prepare('SELECT Requests FROM OpenDotaUsage WHERE Window=?').get('month:'+new Date().toISOString().slice(0,7))?.Requests||0,
    ...db.prepare('SELECT PauseUntil,Reason FROM OpenDotaThrottle WHERE Id=1').get()};
}
