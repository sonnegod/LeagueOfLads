import {WORKER_BUSY_EXIT_CODE} from './workerLock.js';

export function markBettingDirty(db,now=new Date(),{refreshAnalytics=false}={}) {
  db.prepare(`UPDATE BettingRefreshState SET RequestedRevision=RequestedRevision+1,RequestedAtUtc=?,
    AnalyticsRequestedRevision=CASE WHEN ? THEN RequestedRevision+1 ELSE AnalyticsRequestedRevision END WHERE Id=1`)
    .run(now.toISOString(),Number(refreshAnalytics));
}

// One child per API process, with durable pending revisions across restarts.
// Tests inject a clock and launcher so failure/recovery never touches real DBs.
export function createRefreshQueue({db,launch,now=()=>new Date(),setTimer=setTimeout,clearTimer=clearTimeout,
  debounceMs=3000,retryMs=5000,maxRetryMs=60000,maxFailures=6}) {
  let timer=null,running=false,disposed=false,failures=0;
  const pending=()=>{const state=db.prepare('SELECT RequestedRevision,CompletedRevision FROM BettingRefreshState WHERE Id=1').get();return state.RequestedRevision>state.CompletedRevision;};
  function schedule(delay,isRetry=false) {
    if(disposed||running)return;if(timer)clearTimer(timer);
    db.prepare('UPDATE BettingRefreshState SET NextRetryAtUtc=? WHERE Id=1').run(isRetry?new Date(now().getTime()+delay).toISOString():null);
    timer=setTimer(start,delay);timer?.unref?.();
  }
  function finish(code) {
    running=false;if(disposed)return;
    if(code===WORKER_BUSY_EXIT_CODE) {
      // A competing cron/API worker is doing the work; this is not a failure.
      failures=0;db.prepare('UPDATE BettingRefreshState SET ConsecutiveFailures=0,LastErrorCode=NULL,NextRetryAtUtc=NULL WHERE Id=1').run();
      if(pending())schedule(30000,true);
    }else if(code===0) {
      failures=0;db.prepare('UPDATE BettingRefreshState SET ConsecutiveFailures=0,LastErrorCode=NULL,NextRetryAtUtc=NULL WHERE Id=1').run();
      if(pending())schedule(debounceMs);
    }else {
      failures++;db.prepare('UPDATE BettingRefreshState SET ConsecutiveFailures=?,LastErrorCode=?,NextRetryAtUtc=NULL WHERE Id=1')
        .run(failures,failures>=maxFailures?'refresh_retry_exhausted':'refresh_failed');
      if(pending()&&failures<maxFailures)schedule(Math.min(maxRetryMs,retryMs*2**(failures-1)),true);
    }
  }
  function start() {
    timer=null;if(disposed)return;running=true;
    db.prepare('UPDATE BettingRefreshState SET LastAttemptAtUtc=?,NextRetryAtUtc=NULL WHERE Id=1').run(now().toISOString());
    let finished=false;const done=code=>{if(finished)return;finished=true;finish(code);};
    try {const child=launch();child.once('error',()=>done(1));child.once('close',code=>done(code));}
    catch{done(1);}
  }
  return {
    request(markDirty=true) {
      if(disposed)return;if(markDirty){markBettingDirty(db,now());failures=0;
        db.prepare('UPDATE BettingRefreshState SET ConsecutiveFailures=0,LastErrorCode=NULL WHERE Id=1').run();}
      if(!running)schedule(debounceMs);
    },
    resume(){if(pending())schedule(debounceMs);},
    dispose(){disposed=true;if(timer)clearTimer(timer);timer=null;},
  };
}
