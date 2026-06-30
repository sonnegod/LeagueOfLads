export const DEFAULT_LEAGUE_RULES = Object.freeze({
  UpperBracketTeams: 2,
  LowerBracketTeams: 5,
  EliminatedTeams: 2,
  HasTiebreaker: true,
  TiebreakerPosition: 3,
});

export function normalizeLeagueRules(row = {}) {
  const hasTiebreaker = Boolean(Number(row.HasTiebreaker));
  return {
    UpperBracketTeams: Math.max(0, Number(row.UpperBracketTeams) || 0),
    LowerBracketTeams: Math.max(0, Number(row.LowerBracketTeams) || 0),
    EliminatedTeams: Math.max(0, Number(row.EliminatedTeams) || 0),
    HasTiebreaker: hasTiebreaker,
    TiebreakerPosition: hasTiebreaker ? Math.max(1, Number(row.TiebreakerPosition) || 1) : null,
  };
}

export function classifyStandings(teams, rawRules) {
  const rules = normalizeLeagueRules(rawRules);
  let lowerAssigned = 0;

  return teams.map((team, index) => {
    const rank = index + 1;
    let Qualification = 'eliminated';
    if (rank <= rules.UpperBracketTeams) Qualification = 'upper';
    else if (rules.HasTiebreaker && rank === rules.TiebreakerPosition) Qualification = 'tiebreaker';
    else if (lowerAssigned < rules.LowerBracketTeams) {
      Qualification = 'lower';
      lowerAssigned += 1;
    }
    return { ...team, Rank: rank, Qualification };
  });
}
