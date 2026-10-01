export function getLeaguePlayerRecords(db, leagueId) {
  return db.prepare(`WITH league_matches AS (
      SELECT mt.MatchId, mt.TeamRad, mt.TeamDire, mt.WinnerId
      FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
      WHERE ml.LeagueId = ?
    ), team_games AS (
      SELECT TeamId, COUNT(*) AS TeamGames FROM (
        SELECT TeamRad AS TeamId FROM league_matches
        UNION ALL
        SELECT TeamDire AS TeamId FROM league_matches
      ) GROUP BY TeamId
    ), player_games AS (
      SELECT DISTINCT mtp.MatchId, mtp.PlayerId, mtp.TeamId
      FROM MatchTeamPlayer mtp JOIN league_matches lm ON lm.MatchId = mtp.MatchId
    )
    SELECT p.PlayerId, p.PlayerName, pg.TeamId,
      COALESCE(ln.DisplayName, ti.TeamName, 'Team ' || pg.TeamId) AS TeamName,
      tg.TeamGames, COUNT(pg.MatchId) AS GamesPlayed,
      ROUND(100.0 * SUM(CASE WHEN mt.WinnerId = pg.TeamId THEN 1 ELSE 0 END)
        / COUNT(pg.MatchId), 2) AS WinPercentage,
      AVG(mp.Kills) AS AvgKills, AVG(mp.Deaths) AS AvgDeaths,
      AVG(mp.Assists) AS AvgAssists, AVG(mp.LastHits) AS AvgLastHits,
      AVG(mp.GPM) AS AvgGPM, AVG(mp.XPM) AS AvgXPM
    FROM player_games pg
    JOIN league_matches mt ON mt.MatchId = pg.MatchId
      AND pg.TeamId IN (mt.TeamRad, mt.TeamDire)
    JOIN team_games tg ON tg.TeamId = pg.TeamId
    JOIN MatchPlayer mp ON mp.MatchId = pg.MatchId AND mp.PlayerId = pg.PlayerId
    JOIN PlayerInfo p ON p.PlayerId = pg.PlayerId
    LEFT JOIN TeamInfo ti ON ti.TeamId = pg.TeamId
    LEFT JOIN LeagueTeamNames ln ON ln.LeagueId = ? AND ln.TeamId = pg.TeamId
    GROUP BY p.PlayerId, pg.TeamId
    ORDER BY GamesPlayed DESC, p.PlayerName, pg.TeamId`).all(leagueId, leagueId);
}
