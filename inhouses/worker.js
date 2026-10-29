import {randomUUID} from 'node:crypto';

// A database lease prevents accidentally running two PM2 instances against the
// same queue. Reservation and result transactions remain authoritative as well.
export function createInhouseWorker(store, api, {clock = Date.now, owner = randomUUID()} = {}) {
  let stopped = false, nextPoll = 0, nextHealth = 0;
  const detailDue = new Map();
  function lease() {
    return store.db.prepare(`UPDATE InhouseWorker SET Owner=?,LeaseUntil=? WHERE Id=1
      AND (Owner=? OR LeaseUntil<? OR Owner IS NULL)`).run(owner, clock() + 120000, owner, clock()).changes === 1;
  }
  function health(error, success = false) {
    store.mutate(() => {
      store.db.prepare(`UPDATE InhouseWorker SET LastTick=?,LastSuccess=CASE WHEN ? THEN ? ELSE LastSuccess END,LastError=? WHERE Id=1 AND Owner=?`)
        .run(clock(), Number(success), clock(), error || null, owner);
    });
  }
  function maintain() {
    if (stopped || !lease()) return false;
    // Keep ready checks and picks advancing while API requests are awaiting
    // network responses. Launch cancellation still follows discovery in step().
    store.tick({expireLaunch: false});
    if (clock() >= nextHealth) {
      store.mutate(() => store.db.prepare('UPDATE InhouseWorker SET LastTick=? WHERE Id=1 AND Owner=?').run(clock(), owner));
      nextHealth = clock() + 15000;
    }
    return true;
  }
  async function step() {
    if (stopped || !lease()) return {skipped: true};
    store.tick({expireLaunch: false});
    if (clock() < nextPoll) {
      if (clock() >= nextHealth) {health(null); nextHealth = clock() + 15000;}
      return {polled: false};
    }
    nextPoll = clock() + 10000;
    const pending = store.db.prepare("SELECT * FROM InhouseGames WHERE Status IN ('awaiting_game','playing') ORDER BY InhouseId").all();
    if (!pending.length) {health(null); nextHealth = clock() + 15000; return {polled: false};}
    const errors = [], details = new Map();
    const budgetEnd = clock() + 45000;
    async function matchDetails(id) {
      if (!lease()) throw new Error('Worker lease unavailable');
      if (!details.has(id)) details.set(id, await api.details(id));
      return details.get(id);
    }
    function tryLink(match) {
      if (stopped) return;
      const eligible = pending.filter(g => g.Status === 'awaiting_game' && match.leagueId === g.LeagueId && !g.MatchId && (() => {
        try {store.validateMatch(g, match); return true;} catch {return false;}
      })());
      if (eligible.length !== 1) return;
      try {store.applyMatch(eligible[0].InhouseId, match); eligible[0].MatchId = match.matchId; eligible[0].Status = match.winner && match.duration >= 300 ? 'completed' : 'playing';}
      catch (error) {if (!error.status || error.status >= 500) throw error;}
    }
    try {
      for (const leagueId of new Set(pending.map(g => g.LeagueId))) {
        if (stopped || clock() > budgetEnd) break;
        try {for (const match of await api.live(leagueId)) tryLink(match);}
        catch (error) {errors.push(error.message);}
        // History also recovers a game that started/finished while the worker
        // was offline. It is not needed every five seconds during a long game.
        const awaiting = pending.filter(g => !stopped && g.Status === 'awaiting_game' && g.LeagueId === leagueId);
        if (awaiting.length) {
          try {
            const history = await api.history(leagueId);
            const earliest = Math.min(...awaiting.map(g => g.FormedAt)) - 120000;
            for (const candidate of history) {
              if (clock() > budgetEnd || stopped) break;
              if (!Number.isFinite(candidate.startedAt) || candidate.startedAt < earliest ||
                store.db.prepare('SELECT 1 FROM InhouseGames WHERE MatchId=?').get(candidate.matchId)) continue;
              try {tryLink(await matchDetails(candidate.matchId));} catch (error) {errors.push(error.message);}
            }
          } catch (error) {errors.push(error.message);}
        }
      }
      for (const g of pending.filter(g => g.Status === 'playing')) {
        if (stopped || clock() > budgetEnd) break;
        if ((detailDue.get(g.MatchId) || 0) > clock()) continue;
        detailDue.set(g.MatchId, clock() + 15000);
        try {
          const match = await matchDetails(g.MatchId);
          if (stopped) break;
          const outcome = store.applyMatch(g.InhouseId, match);
          if (match.winner && !outcome.completed) errors.push(`Match ${g.MatchId} is shorter than five minutes; cancel or correct its link if it was a remake.`);
        } catch (error) {errors.push(error.message);}
      }
    } finally {
      // Discover before enforcing launch deadlines, so a game present at the
      // boundary can be linked atomically rather than cancelled first.
      if (!stopped && lease()) {
        store.tick();
        health(errors.length ? [...new Set(errors)].join(' ').slice(0, 1000) : null, errors.length === 0);
      }
      nextHealth = clock() + 15000;
      const playing = new Set(store.db.prepare("SELECT MatchId FROM InhouseGames WHERE Status='playing'").all().map(g => g.MatchId));
      for (const id of detailDue.keys()) if (!playing.has(id)) detailDue.delete(id);
    }
    return {polled: true, errors};
  }
  return {step, maintain, close() {
    stopped = true;
    store.db.prepare('UPDATE InhouseWorker SET Owner=NULL,LeaseUntil=0 WHERE Id=1 AND Owner=?').run(owner);
  }};
}
