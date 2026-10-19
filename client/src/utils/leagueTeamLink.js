export function leagueTeamLink(team) {
  if (team.TeamId != null) return `/team/${team.TeamId}`;
  if (team.TeamSubmissionId != null && team.HasRoster) return `/team/roster/${team.TeamSubmissionId}`;
  return null;
}
