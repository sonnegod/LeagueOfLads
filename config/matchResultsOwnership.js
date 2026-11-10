import {randomUUID} from 'node:crypto';
import {ensureMatchResultsSchema} from './matchResultsSchema.js';
import {isSqliteBusy,withSqliteBusyRetry} from './warehouseConnection.js';

const deadline=now=>new Date(now.getTime()+180000).toISOString();
const state=db=>db.prepare('SELECT * FROM MatchResultsRunLock WHERE Id=1').get();
export function nightlyOwnsResults(db,now=new Date()) {
  ensureMatchResultsSchema(db);
  const row=state(db),at=now.toISOString();
  return row.RequestUntil>at||row.Mode==='nightly'&&row.LeaseUntil>at;
}
export function acquireResultsWorker(db,owner,now=new Date()) {
  ensureMatchResultsSchema(db);
  return db.transaction(()=>{
    const row=state(db),at=now.toISOString();
    if(row.RequestUntil>at||row.LeaseUntil>at&&row.Owner!==owner)return false;
    db.prepare("UPDATE MatchResultsRunLock SET Owner=?,Mode='worker',LeaseUntil=? WHERE Id=1").run(owner,deadline(now));
    return true;
  }).immediate();
}
export function ownsResultsRun(db,owner,now=new Date()) {
  const row=state(db);return row.Owner===owner&&row.LeaseUntil>now.toISOString();
}
export function renewResultsRun(db,owner,now=new Date()) {
  return db.prepare('UPDATE MatchResultsRunLock SET LeaseUntil=? WHERE Id=1 AND Owner=? AND LeaseUntil>?')
    .run(deadline(now),owner,now.toISOString()).changes===1;
}
export function releaseResultsWorker(db,owner) {
  db.prepare("UPDATE MatchResultsRunLock SET Owner=NULL,Mode=NULL,LeaseUntil=NULL WHERE Id=1 AND Owner=? AND Mode='worker'").run(owner);
}
function requestNightly(db,owner,now) {
  return db.transaction(()=>{
    const row=state(db),at=now.toISOString();
    if(row.RequestUntil>at&&row.RequestedBy!==owner||row.Mode==='nightly'&&row.LeaseUntil>at&&row.Owner!==owner)
      throw new Error('Another nightly run already owns match cleanup');
    db.prepare('UPDATE MatchResultsRunLock SET RequestedBy=?,RequestUntil=? WHERE Id=1').run(owner,deadline(now));
  }).immediate();
}
function acquireNightly(db,owner,now) {
  return db.transaction(()=>{
    const row=state(db),at=now.toISOString();
    if(row.RequestedBy!==owner||row.RequestUntil<=at)throw new Error('Nightly match cleanup reservation expired');
    if(row.LeaseUntil>at&&row.Owner!==owner)return false;
    db.prepare("UPDATE MatchResultsRunLock SET Owner=?,Mode='nightly',LeaseUntil=? WHERE Id=1").run(owner,deadline(now));
    // Games still being played remain eligible when they finish. Everything
    // already awaiting results/replay details becomes nightly's responsibility.
    db.prepare("UPDATE TrackedLeagueMatches SET WorkerEligible=0,ManualRequested=0,NextAttemptAt=NULL WHERE ResultStatus!='live'").run();
    return true;
  }).immediate();
}
export async function withNightlyResultsOwnership(db,run,{owner=randomUUID(),now=()=>new Date(),
  wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),heartbeatMs=30000,signal,waitTimeoutMs=600000}={}) {
  ensureMatchResultsSchema(db);
  await withSqliteBusyRetry(()=>requestNightly(db,owner,now()));
  const began=now().getTime();let acquired=false,leaseError;
  const heartbeat=setInterval(()=>{
    try {
      const at=now();
      if(acquired&&!renewResultsRun(db,owner,at))throw new Error('Nightly match cleanup lost its lease');
      const refreshed=db.prepare('UPDATE MatchResultsRunLock SET RequestUntil=? WHERE Id=1 AND RequestedBy=? AND RequestUntil>?')
        .run(deadline(at),owner,at.toISOString());
      if(!refreshed.changes)throw new Error('Nightly match cleanup lost its reservation');
    }catch(error){if(!isSqliteBusy(error))leaseError=error;}
  },heartbeatMs);
  try {
    while(!(acquired=await withSqliteBusyRetry(()=>acquireNightly(db,owner,now())))) {
      signal?.throwIfAborted();if(leaseError)throw leaseError;
      if(now().getTime()-began>=waitTimeoutMs)throw new Error('Timed out waiting for the daytime results worker to finish');
      await wait(1000);
    }
    signal?.throwIfAborted();
    return await run({owner,assertOwnership(){if(leaseError)throw leaseError;if(!ownsResultsRun(db,owner,now()))throw new Error('Nightly match cleanup lost ownership');}});
  }finally {
    clearInterval(heartbeat);
    await withSqliteBusyRetry(()=>db.transaction(()=>{
      // Nightly's refresh is authoritative, including when it reports a failure.
      // Retained cleanup work waits for the next nightly run or an admin retry.
      if(acquired&&state(db).Owner===owner)db.prepare('UPDATE MatchResultsState SET DerivedRevision=Revision WHERE Id=1').run();
      db.prepare("UPDATE MatchResultsRunLock SET Owner=NULL,Mode=NULL,LeaseUntil=NULL WHERE Id=1 AND Owner=? AND Mode='nightly'").run(owner);
      db.prepare('UPDATE MatchResultsRunLock SET RequestedBy=NULL,RequestUntil=NULL WHERE Id=1 AND RequestedBy=?').run(owner);
    }).immediate());
  }
}
