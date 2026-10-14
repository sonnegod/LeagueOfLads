import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyticsPaths } from '../analytics/config.js';
import { BettingStore } from './store.js';
import { ScheduleStore } from './scheduleStore.js';
import { fixtureGuard,seasonGuard,settleOperationalChanges } from './engine.js';
import {createRefreshQueue} from './refreshQueue.js';

let refreshQueue=null;
export function queueBettingRefresh(markDirty=true) {
  refreshQueue?.request(markDirty);
}
export function mutationRefresh(req,res,next) {
  if(['POST','PUT','PATCH','DELETE'].includes(req.method))res.once('finish',()=>{if(res.statusCode>=200&&res.statusCode<300)queueBettingRefresh();});
  next();
}
export function createBettingRuntime(league,betting,audit=()=>{}) {
  const paths=analyticsPaths();
  let book;
  const schedules=new ScheduleStore(league,{audit,changed:seasonId=>{
    if(book&&!league.inTransaction)settleOperationalChanges(book,league,seasonId);
    queueBettingRefresh();
  }});
  refreshQueue?.dispose();
  refreshQueue=createRefreshQueue({db:league,launch:()=>spawn(process.execPath,
    [fileURLToPath(new URL('../scripts/betting/run.js',import.meta.url)),'--refresh-analytics'],{windowsHide:true,stdio:'ignore',env:process.env})});
  book=new BettingStore(betting,{eventGuard:(eventId,market)=>fixtureGuard(league,eventId,market),
    seasonGuard:(seasonId,market)=>seasonGuard(league,paths.analytics,seasonId,market)});
  refreshQueue.resume();
  return {book,schedules,analyticsPath:paths.analytics};
}
