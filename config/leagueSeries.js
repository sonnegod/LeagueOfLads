export function getLeagueSeries(db, leagueId) {
  return db.prepare(`
    SELECT si.SeriesId, si.Team1, si.Team2,
      ti1.TeamName AS team_one, ti2.TeamName AS team_two, si.DateCreated
    FROM SeriesInfo si
    JOIN TeamInfo ti1 ON ti1.TeamId = si.Team1
    JOIN TeamInfo ti2 ON ti2.TeamId = si.Team2
    WHERE EXISTS (
      SELECT 1
      FROM SeriesMatch sm
      JOIN MatchLeague ml ON ml.MatchId = sm.MatchId
      WHERE sm.SeriesId = si.SeriesId AND ml.LeagueId = ?
    )
    ORDER BY si.SeriesId DESC
  `).all(leagueId);
}

export function getTeamSeries(db, teamId, leagueId) {
  const filtered = leagueId && leagueId !== 'all';
  return db.prepare(`
    SELECT si.SeriesId, si.Team1, si.Team2,
      ti1.TeamName AS team_one, ti2.TeamName AS team_two, si.DateCreated
    FROM SeriesInfo si
    JOIN TeamInfo ti1 ON ti1.TeamId = si.Team1
    JOIN TeamInfo ti2 ON ti2.TeamId = si.Team2
    WHERE (si.Team1 = ? OR si.Team2 = ?) AND EXISTS (
      SELECT 1 FROM SeriesMatch sm JOIN MatchLeague ml ON ml.MatchId = sm.MatchId
      WHERE sm.SeriesId = si.SeriesId ${filtered ? 'AND ml.LeagueId = ?' : ''}
    )
    ORDER BY si.DateCreated DESC, si.SeriesId DESC
  `).all(...(filtered ? [teamId, teamId, leagueId] : [teamId, teamId]));
}
