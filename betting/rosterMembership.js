export function currentSeasonRoster(db, seasonId, status) {
  const table = status === 'active' && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='TeamRosterPlayers'").get()
    ? 'TeamRosterPlayers' : 'SeasonTeamPlayers';
  return db.prepare(`SELECT p.TeamSubmissionId,p.PlayerId,p.Slot FROM ${table} p
    JOIN SeasonTeams t ON t.TeamSubmissionId=p.TeamSubmissionId WHERE t.SeasonId=? ORDER BY p.TeamSubmissionId,p.Slot`).all(seasonId);
}

export function conflictingRosterPlayers(roster) {
  const teamsByPlayer = new Map();
  for (const row of roster) {
    if (!teamsByPlayer.has(row.PlayerId)) teamsByPlayer.set(row.PlayerId, new Set());
    teamsByPlayer.get(row.PlayerId).add(row.TeamSubmissionId);
  }
  return [...teamsByPlayer].filter(([, teams]) => teams.size > 1).map(([player]) => player).sort((a, b) => a - b);
}
