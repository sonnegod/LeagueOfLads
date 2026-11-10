import db from '../../database.js';
import {startSourceLoad,finishSourceLoad} from '../../analytics/sourceMetadata.js';
import {enqueueLeagueMatch,runResultBatch} from '../../config/matchResults.js';
import {ScheduleStore} from '../../betting/scheduleStore.js';

// Nightly owns cleanup, resetting daytime backoff and reviewing incomplete imports.
const leagueId=db.getActiveLeague()?.[0]?.LeagueId;
new ScheduleStore(db.db);
const run=startSourceLoad(db.db,'match_details');
try {
  if(leagueId) {
    const matches=db.db.prepare(`SELECT m.MatchId,m.TeamRad,m.TeamDire,l.DatePlayed FROM MatchLeague l JOIN MatchTeam m USING(MatchId)
      WHERE l.LeagueId=? AND ((SELECT COUNT(DISTINCT p.PlayerId) FROM MatchPlayer p WHERE p.MatchId=m.MatchId)<10
        OR (datetime(l.DatePlayed)>datetime('now','-7 days') AND NOT EXISTS(SELECT 1 FROM MatchIngestionState i WHERE i.MatchId=m.MatchId AND i.Status='ready')))
      AND NOT EXISTS(SELECT 1 FROM LiveMatchCurrentState c WHERE c.MatchId=m.MatchId) ORDER BY m.MatchId`).all(leagueId);
    for(const m of matches) {
      enqueueLeagueMatch(db.db,m.MatchId,leagueId,{teamRad:m.TeamRad,teamDire:m.TeamDire,startedAt:m.DatePlayed,nightly:true});
      db.db.prepare("UPDATE TrackedLeagueMatches SET ResultStatus='pending',NextAttemptAt=COALESCE(NextAttemptAt,?) WHERE MatchId=? AND ResultStatus='live'")
        .run(new Date().toISOString(),m.MatchId);
    }
    const queued=db.db.prepare(`SELECT COUNT(*) n FROM TrackedLeagueMatches WHERE LeagueId=? AND
      (ResultStatus='pending' OR (ResultStatus IN ('imported','remake') AND EnrichmentStatus IN ('pending','partial','error')))`)
      .get(leagueId).n;
    const results=await runResultBatch(db.db,{automatic:false,limit:Math.max(5,queued)});
    const failures=db.db.prepare('SELECT COUNT(*) n FROM MatchLeague l WHERE l.LeagueId=? AND (SELECT COUNT(DISTINCT p.PlayerId) FROM MatchPlayer p WHERE p.MatchId=l.MatchId)<10').get(leagueId).n;
    finishSourceLoad(db.db,run,{records:results.filter(r=>r.imported||r.remake).length,failures});
    console.log(JSON.stringify({queued:matches.length,processed:results.length,failures}));
    if(failures)process.exitCode=1;
  }else finishSourceLoad(db.db,run);
}catch(error){finishSourceLoad(db.db,run,{failed:true,failures:1});console.error('Match detail load failed:',error.message);process.exitCode=1;}
