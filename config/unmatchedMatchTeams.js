export function getUnmatchedMatchTeams(db, leagueId) {
  const rows = db.prepare(`WITH match_teams AS (
      SELECT ml.LeagueId, ml.MatchId, mt.TeamRad AS TeamId
      FROM MatchLeague ml JOIN MatchTeam mt ON mt.MatchId = ml.MatchId
      WHERE ml.LeagueId = ?
      UNION
      SELECT ml.LeagueId, ml.MatchId, mt.TeamDire AS TeamId
      FROM MatchLeague ml JOIN MatchTeam mt ON mt.MatchId = ml.MatchId
      WHERE ml.LeagueId = ?
    )
    SELECT m.TeamId, m.MatchId,
      COALESCE(ln.DisplayName, ti.TeamName, 'Team ' || m.TeamId) AS TeamName
    FROM match_teams m
    LEFT JOIN LeagueGroups lg ON lg.LeagueId = m.LeagueId AND lg.TeamId = m.TeamId
    LEFT JOIN GroupNames gn ON gn.LeagueId = m.LeagueId AND gn.GroupId = lg.GroupId
    LEFT JOIN TeamInfo ti ON ti.TeamId = m.TeamId
    LEFT JOIN LeagueTeamNames ln ON ln.LeagueId = m.LeagueId AND ln.TeamId = m.TeamId
    WHERE m.TeamId IS NOT NULL AND gn.GroupId IS NULL
    ORDER BY m.TeamId, m.MatchId DESC`).all(leagueId, leagueId);
  const teams = new Map();
  for (const row of rows) {
    if (!teams.has(row.TeamId)) teams.set(row.TeamId, {
      teamId: row.TeamId, teamName: row.TeamName, matchIds: [],
    });
    teams.get(row.TeamId).matchIds.push(row.MatchId);
  }
  return [...teams.values()];
}
