import { rebuildLeagueGroupStandings } from './groupStandings.js';
import { markBettingDirty } from '../betting/refreshQueue.js';

function invalid(message,status=400){throw Object.assign(new Error(message),{status});}

// Manual correction only. Read the original sides inside the transaction rather
// than trusting client IDs, and move only this match's participation/series links.
export function updateMatchRecord(db,values,audit=()=>{}){
  const {matchId,teamRad,teamDire,winnerId,originalTeamRad,originalTeamDire,leagueId}=values;
  const id=Number(matchId),rad=Number(teamRad),dire=Number(teamDire),winner=Number(winnerId);
  if(![id,rad,dire].every(n=>Number.isSafeInteger(n)&&n>0)||rad===dire||![rad,dire].includes(winner)){
    invalid('Select two different teams and a winner from those teams');
  }
  return db.transaction(()=>{
    const before=db.prepare('SELECT TeamRad,TeamDire,WinnerId FROM MatchTeam WHERE MatchId=?').get(id);
    if(!before)invalid('Match not found',404);
    if(leagueId!=null&&!db.prepare('SELECT 1 FROM MatchLeague WHERE MatchId=? AND LeagueId=?').get(id,leagueId)){
      invalid('Match is not in the selected season',404);
    }
    if(Number(originalTeamRad)!==before.TeamRad||Number(originalTeamDire)!==before.TeamDire){
      invalid('Match teams have changed. Load the match again before saving',409);
    }
    db.prepare('UPDATE MatchTeam SET TeamRad=?,TeamDire=?,WinnerId=? WHERE MatchId=?').run(rad,dire,winner,id);
    if(rad!==before.TeamRad||dire!==before.TeamDire){
      if(before.TeamRad===before.TeamDire)invalid('The original sides share a team ID; correct their player alignment before changing teams');
      db.prepare(`UPDATE MatchTeamPlayer SET TeamId=CASE WHEN TeamId=? THEN ? WHEN TeamId=? THEN ? ELSE TeamId END
        WHERE MatchId=? AND TeamId IN (?,?)`).run(before.TeamRad,rad,before.TeamDire,dire,id,before.TeamRad,before.TeamDire);
      const series=db.prepare(`SELECT DISTINCT s.* FROM SeriesInfo s JOIN SeriesMatch m ON m.SeriesId=s.SeriesId
        WHERE m.MatchId=?`).all(id);
      for(const old of series){
        const target=db.prepare(`SELECT SeriesId FROM SeriesInfo WHERE SeriesId<>? AND LeagueId IS ?
          AND DateCreated IS ? AND Stage IS ? AND ((Team1=? AND Team2=?) OR (Team1=? AND Team2=?))
          ORDER BY SeriesId LIMIT 1`).get(old.SeriesId,old.LeagueId,old.DateCreated,old.Stage,rad,dire,dire,rad);
        const hasOther=db.prepare('SELECT 1 FROM SeriesMatch WHERE SeriesId=? AND MatchId<>? LIMIT 1').get(old.SeriesId,id);
        let next=target?.SeriesId;
        if(!next&&!hasOther){
          db.prepare('UPDATE SeriesInfo SET Team1=?,Team2=? WHERE SeriesId=?').run(rad,dire,old.SeriesId);
          continue;
        }
        if(!next)next=Number(db.prepare('INSERT INTO SeriesInfo(Team1,Team2,DateCreated,LeagueId,Stage) VALUES(?,?,?,?,?)')
          .run(rad,dire,old.DateCreated,old.LeagueId,old.Stage).lastInsertRowid);
        if(db.prepare('SELECT 1 FROM SeriesMatch WHERE SeriesId=? AND MatchId=?').get(next,id)){
          db.prepare('DELETE FROM SeriesMatch WHERE SeriesId=? AND MatchId=?').run(old.SeriesId,id);
        }else db.prepare('UPDATE SeriesMatch SET SeriesId=? WHERE SeriesId=? AND MatchId=?').run(next,old.SeriesId,id);
        // Empty series parents may be referenced by brackets; keep them intact.
      }
    }
    for(const {LeagueId} of db.prepare('SELECT DISTINCT LeagueId FROM MatchLeague WHERE MatchId=?').all(id)) {
      rebuildLeagueGroupStandings(db,LeagueId);
    }
    // Commit the rebuild requirement with the source correction. A routine
    // scheduling worker must not settle against the previous Analytics facts.
    markBettingDirty(db,new Date(),{refreshAnalytics:true});
    audit('MatchTeam Update',`Updated Match ${id} with values Team1 = ${rad}, Team2 = ${dire}, Winner = ${winner}; previous teams ${before.TeamRad},${before.TeamDire}`);
    return {success:true,message:'Match updated successfully!'};
  }).immediate();
}
