import { classifyStandings, DEFAULT_LEAGUE_RULES } from '../../config/leagueRules.js';

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function compareStandings(a, b) {
  const wins = numeric(b.Wins) - numeric(a.Wins);
  if (wins !== 0) return wins;

  const losses = numeric(a.Losses) - numeric(b.Losses);
  if (losses !== 0) return losses;

  const neustadtl = numeric(b.Neustadtl ?? b.Score) - numeric(a.Neustadtl ?? a.Score);
  if (neustadtl !== 0) return neustadtl;

  const order = numeric(a.SortOrder) - numeric(b.SortOrder);
  if (order !== 0) return order;

  return numeric(a.TeamId ?? a.EntryId) - numeric(b.TeamId ?? b.EntryId);
}

function toAppTeam(team) {
  return {
    rank: numeric(team.Rank),
    teamId: team.TeamId == null ? null : numeric(team.TeamId),
    entryId: team.EntryId == null ? null : numeric(team.EntryId),
    teamName: team.TeamName || null,
    wins: numeric(team.Wins),
    losses: numeric(team.Losses),
    neustadtl: numeric(team.Neustadtl ?? team.Score),
    qualification: team.Qualification,
  };
}

export async function getAppStandingsPayload(db, leagueId, { groupId = null } = {}) {
  const rules = db.getLeagueRules(leagueId) || DEFAULT_LEAGUE_RULES;
  let groups = await db.getLeagueLeaderboard(leagueId);

  if (groupId !== null) {
    groups = groups.filter((group) => Number(group.GroupId) === Number(groupId));
  }

  const appGroups = await Promise.all(groups.map(async (group) => {
    const sortedTeams = [...await db.getGroupStats(group)].sort(compareStandings);
    const teams = classifyStandings(sortedTeams, rules).map(toAppTeam);

    return {
      groupId: numeric(group.GroupId),
      groupName: group.GroupName || `Group ${group.GroupId}`,
      teams,
    };
  }));

  const allTeams = appGroups.flatMap((group) => group.teams);
  const byQualification = (qualification) => (
    allTeams.filter((team) => team.qualification === qualification)
  );

  return {
    generatedAt: new Date().toISOString(),
    leagueId: numeric(leagueId),
    rules,
    groups: appGroups,
    qualification: {
      upperBracket: byQualification('upper'),
      tiebreaker: byQualification('tiebreaker'),
      lowerBracket: byQualification('lower'),
      eliminated: byQualification('eliminated'),
    },
  };
}
