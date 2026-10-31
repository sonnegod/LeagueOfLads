import {randomUUID} from 'node:crypto';

// One process owns the five Steam sessions, deadlines and lobby assignments.
export function createInhouseWorker(store, pool, {clock = Date.now, owner = randomUUID()} = {}) {
  let stopped = false, started = false, nextHealth = 0, lastSuccess = 0, lastError = '';
  function claim() {
    return !stopped && store.db.prepare(`UPDATE InhouseWorker SET Owner=?,LeaseUntil=? WHERE Id=1
      AND (Owner=? OR LeaseUntil<? OR Owner IS NULL)`).run(owner, clock() + 120000, owner, clock()).changes === 1;
  }
  function maintain() {
    if (!claim()) {
      if (started && !stopped) close({report: false});
      return false;
    }
    if (!started) {
      started = true;
      try {pool.start();} catch (error) {close(); throw error;}
    }
    store.tick();
    const report = pool.tick() || {};
    // The bot owns the join deadline after confirming its lobby is ready.
    // Site maintenance advances only ready checks and captain choices/drafts.
    const error = report.errors?.join(' ').slice(0,1000) || '';
    if (clock() >= nextHealth || report.lastSuccess > lastSuccess || error !== lastError) {
      store.mutate(() => store.db.prepare(`UPDATE InhouseWorker SET LastTick=?,
        LastSuccess=CASE WHEN ?>COALESCE(LastSuccess,0) THEN ? ELSE LastSuccess END,LastError=?
        WHERE Id=1 AND Owner=?`).run(clock(), report.lastSuccess || 0, report.lastSuccess || 0,
          error || null, owner));
      lastSuccess = report.lastSuccess || 0; lastError = error;
      nextHealth = clock() + 15000;
    }
    return true;
  }
  function close({report = true} = {}) {
    if (stopped) return;
    stopped = true;
    try {if (started) pool.close(report ? undefined : {report: false});}
    finally {store.db.prepare('UPDATE InhouseWorker SET Owner=NULL,LeaseUntil=0 WHERE Id=1 AND Owner=?').run(owner);}
  }
  return {claim, maintain, close, async step() {return maintain() ? {polled: true} : {skipped: true};}};
}
