export function signupSeasons(db) {
  return db.prepare(`SELECT s.SeasonId,s.LeagueName,s.Status,s.ExternalLeagueId,
    (SELECT COUNT(*) FROM SeasonTeams t WHERE t.SeasonId=s.SeasonId) TeamCount,
    (SELECT COUNT(*) FROM SeasonTeamPlayers p JOIN SeasonTeams t USING(TeamSubmissionId) WHERE t.SeasonId=s.SeasonId) PlayerCount
    FROM LeagueSeasons s ORDER BY CASE WHEN s.Status='ended' THEN 1 ELSE 0 END,s.SeasonId DESC`).all();
}

// Read the original signup rows, not the current roster or adjusted-player MMRs.
// Explicit columns keep screenshot blobs and upload metadata out of this view.
export function signupHistory(db,seasonId) {
  return db.transaction(()=>{
    const season=db.prepare('SELECT SeasonId,LeagueName,Status,ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
    if(!season)return null;
    const teams=db.prepare(`SELECT TeamSubmissionId,TeamName,IsManual,ManualAverageMMR,SubmittedAt
      FROM SeasonTeams WHERE SeasonId=? ORDER BY TeamName COLLATE NOCASE,TeamSubmissionId`).all(seasonId);
    const players=db.prepare(`SELECT p.TeamSubmissionId,p.PlayerId,p.Slot,CAST(i.PlayerName AS TEXT) PlayerName,
      COALESCE(m.SignupMMR,p.MMR) MMR FROM SeasonTeamPlayers p
      JOIN SeasonTeams t ON t.TeamSubmissionId=p.TeamSubmissionId
      LEFT JOIN PlayerInfo i ON i.PlayerId=p.PlayerId
      LEFT JOIN SignupMMRs m ON m.SeasonId=t.SeasonId AND m.TeamSubmissionId=p.TeamSubmissionId AND m.PlayerId=p.PlayerId
      WHERE t.SeasonId=? ORDER BY p.TeamSubmissionId,p.Slot,p.PlayerId`).all(seasonId);
    const byTeam=new Map(teams.map(team=>[team.TeamSubmissionId,{...team,players:[]}]));
    for(const {TeamSubmissionId,...player} of players)byTeam.get(TeamSubmissionId).players.push(player);
    return {season,teams:[...byTeam.values()].map(({ManualAverageMMR,...team})=>({...team,
      AverageMMR:team.IsManual?ManualAverageMMR:team.players.length
        ?team.players.reduce((sum,p)=>sum+p.MMR,0)/team.players.length:null,
    }))};
  })();
}
