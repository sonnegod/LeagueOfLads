export function getPlayerTeammates(db, playerId, leagueId = 'all') {
  const leagueFilter = leagueId === 'all' ? '' : 'AND ml.LeagueId = ?';
  const params = leagueId === 'all' ? [playerId, playerId] : [playerId, leagueId, playerId];

  return db.prepare(`WITH player_games AS (
      SELECT DISTINCT mtp.MatchId, mtp.TeamId
      FROM MatchTeamPlayer mtp
      JOIN MatchPlayer mp ON mp.MatchId = mtp.MatchId AND mp.PlayerId = mtp.PlayerId
      JOIN MatchLeague ml ON ml.MatchId = mtp.MatchId
      JOIN MatchTeam mt ON mt.MatchId = mtp.MatchId
      WHERE mtp.PlayerId = ? AND mtp.TeamId IN (mt.TeamRad, mt.TeamDire) ${leagueFilter}
    ), shared_games AS (
      SELECT DISTINCT pg.MatchId, teammate.PlayerId,
        CASE WHEN mt.WinnerId = pg.TeamId THEN 1 ELSE 0 END AS Won
      FROM player_games pg
      JOIN MatchTeamPlayer teammate ON teammate.MatchId = pg.MatchId
        AND teammate.TeamId = pg.TeamId
      JOIN MatchPlayer teammate_match ON teammate_match.MatchId = teammate.MatchId
        AND teammate_match.PlayerId = teammate.PlayerId
      JOIN MatchTeam mt ON mt.MatchId = pg.MatchId
      WHERE teammate.PlayerId != ?
    )
    SELECT pi.PlayerId, pi.PlayerName, COUNT(*) AS GamesPlayed,
      SUM(shared_games.Won) AS Wins,
      ROUND(100.0 * SUM(shared_games.Won) / COUNT(*), 2) AS WinPercentage
    FROM shared_games
    JOIN PlayerInfo pi ON pi.PlayerId = shared_games.PlayerId
    GROUP BY pi.PlayerId, pi.PlayerName
    HAVING COUNT(*) >= 5
    ORDER BY GamesPlayed DESC, WinPercentage DESC, pi.PlayerName COLLATE NOCASE`).all(...params);
}
