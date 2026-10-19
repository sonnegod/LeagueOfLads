export function getHeadToHeadMatches(db,p1Id,p2Id) {
  return db.prepare(`WITH p1_teams AS (
      SELECT DISTINCT MatchId,TeamId FROM MatchTeamPlayer WHERE PlayerId=?
    ), p2_teams AS (
      SELECT DISTINCT MatchId,TeamId FROM MatchTeamPlayer WHERE PlayerId=?
    ), match_dates AS (
      SELECT MatchId,MAX(DatePlayed) AS DatePlayed FROM MatchLeague GROUP BY MatchId
    )
    SELECT DISTINCT
      CASE WHEN mt.StartTimeUtc>0 THEN strftime('%Y-%m-%dT%H:%M:%SZ',mt.StartTimeUtc,'unixepoch')
        ELSE ml.DatePlayed END AS DatePlayed,
      mp1.MatchId,mp1.PlayerId AS P1Id,ti1.TeamName AS P1Team,
      mp2.PlayerId AS P2Id,ti2.TeamName AS P2Team,mp1.Winner AS P1Won,
      (mp1.Kills || '/' || mp1.Deaths || '/' || mp1.Assists) AS P1KDA,
      (mp2.Kills || '/' || mp2.Deaths || '/' || mp2.Assists) AS P2KDA
    FROM MatchPlayer mp1
    JOIN MatchPlayer mp2 ON mp2.MatchId=mp1.MatchId
    JOIN MatchTeam mt ON mt.MatchId=mp1.MatchId
    JOIN match_dates ml ON ml.MatchId=mp1.MatchId
    JOIN p1_teams t1 ON t1.MatchId=mp1.MatchId
    JOIN p2_teams t2 ON t2.MatchId=mp2.MatchId
    JOIN TeamInfo ti1 ON ti1.TeamId=t1.TeamId
    JOIN TeamInfo ti2 ON ti2.TeamId=t2.TeamId
    WHERE mp1.PlayerId=? AND mp2.PlayerId=? AND t1.TeamId!=t2.TeamId
    ORDER BY DatePlayed DESC,mp1.MatchId DESC`).all(p1Id,p2Id,p1Id,p2Id);
}
