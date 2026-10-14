import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { analyticsPaths } from '../../analytics/config.js';
import { openAnalytics } from '../../analytics/store.js';
import { buildAnalytics } from '../../analytics/build.js';
import { BettingStore } from '../../betting/store.js';
import { ScheduleStore } from '../../betting/scheduleStore.js';
import { runBetting,settleOperationalChanges } from '../../betting/engine.js';
import {markBettingDirty} from '../../betting/refreshQueue.js';

const paths=analyticsPaths();let bettingPath=resolve(process.env.BETTING_DB||resolve(dirname(paths.league),'Betting.db'));
let league,betting,analytics,publicDb;
const args=process.argv.slice(2);let seasonId=null;let refresh=false;let init=false;let status=false;
let trackedRefresh=false;
const workerStarted=performance.now();
try {
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--refresh-analytics')refresh=true;
    else if(args[i]==='--init-only')init=true;
    else if(args[i]==='--status')status=true;
    else if(args[i]==='--help'){console.log('Usage: node scripts/betting/run.js [--init-only|--status|--refresh-analytics] [--season-id id] [--league-db path] [--analytics-db path] [--betting-db path]');process.exit(0);}
    else if(['--season-id','--league-db','--analytics-db','--betting-db'].includes(args[i])) {
      const flag=args[i];const value=args[++i];if(!value)throw new Error('Missing argument');
      if(flag==='--season-id'){seasonId=Number(value);if(!Number.isSafeInteger(seasonId)||seasonId<=0)throw new Error('Invalid season');}
      else if(flag==='--league-db')paths.league=resolve(value);
      else if(flag==='--analytics-db')paths.analytics=resolve(value);
      else bettingPath=resolve(value);
    } else throw new Error('Unknown option');
  }
  if(new Set([paths.league,paths.analytics,bettingPath].map(p=>p.toLowerCase())).size!==3)throw new Error('Database paths must be different');
  if(!existsSync(paths.league))throw new Error('League database is missing');
  league=new Database(paths.league,{fileMustExist:true});league.pragma('busy_timeout = 5000');
  const schedules=new ScheduleStore(league);
  if(!status&&!init&&!seasonId) {
    markBettingDirty(league);trackedRefresh=true;
    league.prepare('UPDATE BettingRefreshState SET LastAttemptAtUtc=? WHERE Id=1').run(new Date().toISOString());
  }
  const requestedRevision=league.prepare('SELECT RequestedRevision FROM BettingRefreshState WHERE Id=1').get().RequestedRevision;
  betting=new Database(bettingPath);betting.pragma('journal_mode = WAL');
  const book=new BettingStore(betting);
  if(status)console.log(JSON.stringify({jobs:betting.prepare('SELECT JobId,Status,StartedAtUtc,CompletedAtUtc,MarketsOpened,MarketsSettled,IssueCode FROM BettingJobs ORDER BY JobId DESC LIMIT 5').all(),
    markets:betting.prepare('SELECT SeasonId,Status,COUNT(*) AS count FROM BettingMarkets GROUP BY SeasonId,Status').all()},null,2));
  else if(init)console.log('Schedule and Betting migrations complete. Legacy tables are preserved.');
  else {
    settleOperationalChanges(book,league,seasonId);
    if(refresh){
      analytics=openAnalytics(paths.analytics);
      if(existsSync(paths.public))publicDb=new Database(paths.public,{readonly:true,fileMustExist:true});
      buildAnalytics({analytics,league,publicDb,firstSeasonId:process.env.ANALYTICS_FIRST_SEASON_ID||null});
    } else {
      if(!existsSync(paths.analytics))throw new Error('Build Analytics before running Betting');
      analytics=new Database(paths.analytics,{readonly:true,fileMustExist:true});
    }
    const result=runBetting({book,league,analytics,schedules,seasonId});
    console.log(JSON.stringify({...result,resources:{elapsedMs:Math.round(performance.now()-workerStarted),
      peakRssBytes:process.resourceUsage().maxRSS*1024,heapUsedBytes:process.memoryUsage().heapUsed}},null,2));
    if(!seasonId)league.prepare(`UPDATE BettingRefreshState SET CompletedRevision=MAX(CompletedRevision,?),LastCompletedAtUtc=?,
      ConsecutiveFailures=0,LastErrorCode=NULL,NextRetryAtUtc=NULL WHERE Id=1`).run(requestedRevision,new Date().toISOString());
  }
}catch(error){
  if(trackedRefresh)try{league.prepare("UPDATE BettingRefreshState SET LastErrorCode='refresh_failed',ConsecutiveFailures=ConsecutiveFailures+1 WHERE Id=1").run();}catch{}
  console.error('Betting job failed:',error.message);process.exitCode=1;
}
finally{publicDb?.close();analytics?.close();betting?.close();league?.close();}
