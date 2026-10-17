import { planWarehouseCollection } from './warehouseCollection.js';
import { ingestWarehouseMatch, recordWarehouseFailure, IMPORTER_VERSION } from './warehouseIngestion.js';
import { captureWarehouseBaseline, compareWarehouseBaseline, validateWarehouse } from './warehouseValidation.js';
import { withSqliteBusyRetry, isSqliteBusy } from './warehouseConnection.js';

export function validateBackfillConfig(config) {
  const ranges = {
    dailyRequestBudget:[1,3000], dailyReserve:[1,3000], seasonRetryAllowance:[1,100],
    requestDelayMs:[1100,60000], minuteCooldownMs:[60000,3600000], minuteReserve:[1,59], maxMinuteRetries:[0,5]
  };
  if (!config || !Array.isArray(config.leagueIds) || !config.leagueIds.length
    || config.leagueIds.some(id=>!Number.isSafeInteger(id)||id<=0)
    || new Set(config.leagueIds).size!==config.leagueIds.length) throw new Error('Configure distinct positive leagueIds');
  for (const [key,[min,max]] of Object.entries(ranges)) {
    if (!Number.isSafeInteger(config[key]) || config[key]<min || config[key]>max) throw new Error(`Invalid ${key}: expected ${min}-${max}`);
  }
  if (Object.keys(config).some(key=>key!=='leagueIds'&&!Object.hasOwn(ranges,key))) throw new Error('Unknown backfill setting');
  return config;
}

export function planWarehouseBackfill(db, config, { requestsUsed=0, remainingDay=null, now=Date.now() }={}) {
  validateBackfillConfig(config);
  let available=Math.max(0,config.dailyRequestBudget-requestsUsed);
  if (remainingDay!==null) available=Math.min(available,Math.max(0,remainingDay-config.dailyReserve));
  const seasons=config.leagueIds.map(leagueId=>planWarehouseCollection(db,{leagueId,limit:500,now}));
  let deferred=false;
  const queue=seasons.map(season=>{
    const reserve=season.eligibleMatches ? config.seasonRetryAllowance : 0;
    const required=season.eligibleMatches+reserve;
    const selected=season.eligibleMatches>0 && !deferred && !season.remainingAfterBatch && required<=available;
    if (season.eligibleMatches && !selected) deferred=true;
    if (selected) available-=required;
    return {...season,selected,retryAllowance:reserve,reason:!season.eligibleMatches?'no eligible matches':selected?'fits daily budget':
      season.remainingAfterBatch?'season exceeds 500-match cap':'deferred to another run/day'};
  });
  return {dailyRequestBudget:config.dailyRequestBudget,requestsUsed,remainingDay,dailyReserve:config.dailyReserve,
    seasons:queue,plannedMatchRequests:queue.filter(s=>s.selected).reduce((n,s)=>n+s.selectedMatchIds.length,0),
    reservedRequests:queue.filter(s=>s.selected).reduce((n,s)=>n+s.selectedMatchIds.length+s.retryAllowance,0)};
}

const quotaNumber=(headers,key)=>{
  const raw=headers.get(key);
  return raw!==null && Number.isFinite(Number(raw)) ? Number(raw) : null;
};
export function openDotaLimits(headers, now=Date.now()) {
  const retry=headers.get('retry-after');
  let retryAfterMs=0;
  if (retry!==null) retryAfterMs=/^\d+(?:\.\d+)?$/.test(retry) ? Math.ceil(Number(retry)*1000) : Math.max(0,Date.parse(retry)-now)||0;
  return {remainingDay:quotaNumber(headers,'x-rate-limit-remaining-day'),
    remainingMinute:quotaNumber(headers,'x-rate-limit-remaining-minute'),retryAfterMs};
}

// Fetching and waits happen outside transactions. A successful response is reused
// across database retries, and only existing curated IDs can reach this function.
export async function runWarehouseBackfill(db, config, {
  state, saveState=()=>{}, saveReport=()=>{}, log=()=>{}, fetcher=fetch,
  now=Date.now, sleep=ms=>new Promise(r=>setTimeout(r,ms)), signal
}) {
  validateBackfillConfig(config);
  const day=()=>new Date(now()).toISOString().slice(0,10);
  if (!state || state.day!==day() || !Number.isSafeInteger(state.requests) || state.requests<0) throw new Error('Invalid current-day backfill ledger');
  const totals={requests:0,ready:0,partial:0,failed:0,rateLimits:0,skipped:0};
  const reports=[];
  let stopReason=null,lastRequestAt=null;
  const allowance=()=>{
    if(signal?.aborted)return 'interrupted';
    if(state.day!==day())return 'UTC day changed; rerun for the next daily batch';
    if(state.requests>=config.dailyRequestBudget)return 'daily request budget reached';
    if(state.remainingDay!==null && state.remainingDay!==undefined && state.remainingDay<=config.dailyReserve)return 'daily reserve reached';
    return null;
  };
  const wait=async(ms,reason)=>{
    if(ms<=0)return;
    if(ms>=60000)log({event:'waiting',reason,seconds:Math.ceil(ms/1000)});
    const until=now()+ms;
    while(now()<until&&!signal?.aborted)await sleep(Math.min(1000,until-now()));
  };
  const plan=planWarehouseBackfill(db,config,{requestsUsed:state.requests,remainingDay:state.remainingDay??null,now:now()});
  if(plan.seasons.some(s=>s.eligibleMatches&&!s.selected))return {
    plan,totals,requestsToday:state.requests,remainingDay:state.remainingDay??null,
    stopReason:'entire batch does not fit remaining allowance; no requests sent',reports
  };
  // An earlier rate-limit cooldown survives interruption/restart.
  if(state.waitUntil>now())await wait(state.waitUntil-now(),'saved OpenDota cooldown');
  for(const season of plan.seasons.filter(s=>s.selected)) {
    stopReason=allowance();if(stopReason)break;
    const expected=season.selectedMatchIds.length+config.seasonRetryAllowance;
    const remaining=Math.min(config.dailyRequestBudget-state.requests,
      state.remainingDay==null?Infinity:state.remainingDay-config.dailyReserve);
    if(expected>remaining){stopReason='next complete season no longer fits daily budget';break;}
    log({event:'season-start',league:season.league,matches:season.selectedMatchIds.length});
    const baseline=captureWarehouseBaseline(db),before={...totals};
    let retryRequests=0;
    for(const matchId of season.selectedMatchIds) {
      if(stopReason)break;
      const exists=db.prepare('SELECT 1 FROM MatchTeam m JOIN MatchLeague l ON l.MatchId=m.MatchId WHERE m.MatchId=? AND l.LeagueId=?').get(matchId,season.league.LeagueId);
      const imported=db.prepare('SELECT Status,ImporterVersion FROM MatchIngestionState WHERE MatchId=?').get(matchId);
      if(!exists || (imported?.Status==='ready'&&imported.ImporterVersion>=IMPORTER_VERSION)){totals.skipped++;continue;}
      let minuteRetries=0;
      while(!stopReason) {
        stopReason=allowance();if(stopReason)break;
        if(state.waitUntil>now())await wait(state.waitUntil-now(),'OpenDota minute allowance');
        if(lastRequestAt!==null)await wait(Math.max(0,config.requestDelayMs-(now()-lastRequestAt)),'request pacing');
        stopReason=allowance();if(stopReason)break;
        // Count before sending so an interruption can only overcount, never
        // undercount the number of requests charged against this daily cap.
        state.requests++;totals.requests++;lastRequestAt=now();saveState(state);
        try {
          const timeout=AbortSignal.timeout(20000);
          const response=await fetcher(`https://api.opendota.com/api/matches/${matchId}`,{
            signal:signal?AbortSignal.any([signal,timeout]):timeout
          });
          const limits=openDotaLimits(response.headers,now());
          if(limits.remainingDay!==null)state.remainingDay=limits.remainingDay;
          if(limits.remainingMinute!==null && limits.remainingMinute<=config.minuteReserve)state.waitUntil=now()+Math.max(config.minuteCooldownMs,limits.retryAfterMs);
          saveState(state);
          if(response.status===429) {
            totals.rateLimits++;
            const message=(await response.text()).slice(0,500);
            log({event:'rate-limit',matchId,...limits,message});
            if((limits.remainingDay!==null&&limits.remainingDay<=config.dailyReserve)||/day|daily|month/i.test(message)){
              stopReason='OpenDota daily quota/reserve reached';break;
            }
            if(!/minute/i.test(message)&&limits.remainingMinute!==0&&!(limits.remainingMinute<0)&&!limits.retryAfterMs){
              stopReason='unrecognized OpenDota rate limit; review response before resuming';break;
            }
            const cooldown=Math.max(config.minuteCooldownMs*2**minuteRetries,limits.retryAfterMs);
            state.waitUntil=now()+cooldown;saveState(state);
            if(minuteRetries>=config.maxMinuteRetries||retryRequests>=config.seasonRetryAllowance){
              stopReason='minute retry allowance reached; cooldown saved for next run';break;
            }
            minuteRetries++;retryRequests++;
            await wait(cooldown,'OpenDota minute limit');
            continue;
          }
          if([401,403].includes(response.status)){stopReason=`OpenDota authentication/access error ${response.status}`;break;}
          if(!response.ok)throw new Error(`OpenDota returned ${response.status}`);
          const data=await response.json();
          const result=await withSqliteBusyRetry(()=>ingestWarehouseMatch(db,data,{expectedMatchId:matchId}));
          totals[result.status]++;log({event:'match',...result});
          break;
        }catch(error){
          if(signal?.aborted){stopReason='interrupted';break;}
          if(isSqliteBusy(error)){stopReason='database remains busy; fetched response was not refetched';break;}
          totals.failed++;
          recordWarehouseFailure(db,matchId,error);
          log({event:'match-error',matchId,error:error.message,issues:error.issues||[]});
          break;
        }
      }
    }
    const reconciliation=compareWarehouseBaseline(db,baseline);
    const validation=validateWarehouse(db,{leagueId:season.league.LeagueId,deep:true});
    const report={league:season.league,finishedAt:new Date(now()).toISOString(),
      totals:Object.fromEntries(Object.keys(totals).map(k=>[k,totals[k]-before[k]])),stopReason,reconciliation,validation};
    reports.push(report);saveReport(report);log({event:'season-finished',...report});
    if(!reconciliation.unchanged||!validation.valid)stopReason='validation failed; review report before continuing';
    else if(totals.failed>before.failed||validation.problems.length)stopReason='match conflicts/errors or source discrepancies need review';
    if(stopReason)break;
  }
  return {plan,totals,requestsToday:state.requests,remainingDay:state.remainingDay??null,stopReason:stopReason||
    (plan.seasons.some(s=>s.eligibleMatches&&!s.selected)?'daily batch finished; remaining seasons deferred':'all selected seasons processed'),reports};
}
