import 'dotenv/config';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import db from '../../database.js';
import {runResultBatch,resultWorkerPollDelay} from '../../config/matchResults.js';
import {ensureMatchResultsSchema} from '../../config/matchResultsSchema.js';
import {ScheduleStore} from '../../betting/scheduleStore.js';
import {acquireResultsWorker,renewResultsRun,ownsResultsRun,releaseResultsWorker} from '../../config/matchResultsOwnership.js';

ensureMatchResultsSchema(db.db);
new ScheduleStore(db.db);
const args=process.argv.slice(2);
if(args.some(arg=>!['--once','--init-only'].includes(arg)))throw new Error('Usage: node scripts/league/resultsWorker.js [--once|--init-only]');
let stopped=false,timer;
const stop=()=>{stopped=true;clearTimeout(timer);};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
async function tick() {
  let nextCheck=60000;
  const owner=randomUUID();let heartbeat;
  try {
    db.db.prepare('UPDATE MatchResultsState SET LastTickAt=? WHERE Id=1').run(new Date().toISOString());
    if(acquireResultsWorker(db.db,owner)) {
      heartbeat=setInterval(()=>{try{renewResultsRun(db.db,owner);}catch{/* A short busy write can retry on the next heartbeat. */}},30000);
      const results=await runResultBatch(db.db);
      if(!ownsResultsRun(db.db,owner))throw new Error('Results cycle lost ownership; deferring derived updates');
      const state=db.db.prepare('SELECT Revision,DerivedRevision FROM MatchResultsState WHERE Id=1').get();
      const pending=db.db.prepare('SELECT RequestedRevision,CompletedRevision FROM BettingRefreshState WHERE Id=1').get();
      if(state.Revision>state.DerivedRevision&&pending.RequestedRevision>pending.CompletedRevision) {
        // The betting worker owns the analytics/settlement lock and consumes the durable rebuild request.
        const code=await new Promise(resolve=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../betting/run.js',import.meta.url))],{windowsHide:true,stdio:'inherit'});
          child.once('error',()=>resolve(1));child.once('close',resolve);});
        if(code!==0)throw new Error('Derived analytics/betting refresh deferred or failed; pending work is retained');
      }
      db.db.prepare('UPDATE MatchResultsState SET DerivedRevision=MAX(DerivedRevision,?),LastSuccessAt=?,LastError=NULL WHERE Id=1').run(state.Revision,new Date().toISOString());
      if(results.length)console.log(JSON.stringify({processed:results.length,results}));
    }
    nextCheck=resultWorkerPollDelay(db.db);
  }catch(error){nextCheck=15000;db.db.prepare('UPDATE MatchResultsState SET LastError=? WHERE Id=1').run(error.message);console.error('Results worker:',error.message);}
  finally{clearInterval(heartbeat);releaseResultsWorker(db.db,owner);}
  if(!stopped&&!args.includes('--once'))timer=setTimeout(tick,nextCheck);
  else db.db.close();
}
if(args.includes('--init-only')){console.log('Match results tables are ready. Enable automatic imports under Admin → League → Match.');db.db.close();}
else{console.log('League results worker started.');await tick();}
