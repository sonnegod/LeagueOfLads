import {matchRecordDay} from '../shared/matchRecordDay.js';

export function addSameDayMatchSuggestions(db,leagueId,records) {
  if(!records.some(record=>record.team1.needsReview||record.team2.needsReview))return records;
  const byDay=new Map(),players=new Map();
  for(const record of records) {
    const day=matchRecordDay(record.playedAt);
    if(!day)continue;
    if(!byDay.has(day))byDay.set(day,[]);
    byDay.get(day).push(record);
  }
  // Only account IDs and team membership are needed; no player statistics or private signup data.
  for(const row of db.prepare(`SELECT p.MatchId,p.TeamId,p.PlayerId FROM MatchTeamPlayer p
    JOIN MatchLeague l ON l.MatchId=p.MatchId WHERE l.LeagueId=? AND p.PlayerId>0`).all(leagueId)) {
    const key=`${row.MatchId}:${row.TeamId}`;
    if(!players.has(key))players.set(key,new Set());
    players.get(key).add(row.PlayerId);
  }
  const overlap=(a,teamA,b,teamB)=>{
    const first=players.get(`${a.matchId}:${teamA}`),second=players.get(`${b.matchId}:${teamB}`);
    return first&&second?[...first].filter(id=>second.has(id)).length:0;
  };
  return records.map(record=>{
    const unknown=[record.team1,record.team2].filter(team=>team.needsReview);
    if(!unknown.length)return record;
    const known=[record.team1,record.team2].filter(team=>!team.needsReview&&team.id>0);
    const candidates=(byDay.get(matchRecordDay(record.playedAt))||[])
      .filter(other=>other.matchId!==record.matchId&&(!record.seriesId||other.seriesId!==record.seriesId))
      .map(other=>{
        const teams=[other.team1,other.team2];
        const sharedTeamIds=known.filter(team=>teams.some(candidate=>candidate.id===team.id)).map(team=>team.id);
        const rosterMatches=unknown.map(team=>teams.filter(candidate=>!sharedTeamIds.includes(candidate.id))
          .map(candidate=>({fromTeamId:team.id,toTeamId:candidate.id,playerCount:overlap(record,team.id,other,candidate.id)}))
          .sort((a,b)=>b.playerCount-a.playerCount)[0]).filter(match=>match?.playerCount>=3);
        const difference=Math.abs(Date.parse(record.playedAt)-Date.parse(other.playedAt));
        return {matchId:other.matchId,sharedTeamIds,rosterMatches,
          strength:rosterMatches.reduce((total,match)=>total+match.playerCount,0),groupedTeams:teams.filter(team=>!team.needsReview).length,
          difference:Number.isFinite(difference)?difference:Infinity};
      })
      .filter(candidate=>candidate.sharedTeamIds.length>0)
      .sort((a,b)=>b.sharedTeamIds.length-a.sharedTeamIds.length||b.strength-a.strength||b.groupedTeams-a.groupedTeams||a.difference-b.difference
        ||Math.abs(a.matchId-record.matchId)-Math.abs(b.matchId-record.matchId));
    return {...record,relatedMatches:candidates.slice(0,3).map(({matchId,sharedTeamIds,rosterMatches})=>({matchId,sharedTeamIds,rosterMatches}))};
  });
}
