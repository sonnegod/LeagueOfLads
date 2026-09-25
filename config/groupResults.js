export function buildGroupResults(teams, matches, overrides) {
  const byId = new Map(teams.map((team) => [Number(team.TeamId), {
    TeamId: Number(team.TeamId), Wins: 0, Losses: 0, Score: 0,
  }]));
  const pairKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const pairs = new Map();

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const teamA = Math.min(Number(teams[i].TeamId), Number(teams[j].TeamId));
      const teamB = Math.max(Number(teams[i].TeamId), Number(teams[j].TeamId));
      pairs.set(pairKey(teamA, teamB), {
        TeamA: teamA, TeamB: teamB, WinsA: 0, WinsB: 0,
        ActualWinsA: 0, ActualWinsB: 0, Overridden: false,
      });
    }
  }

  for (const match of matches) {
    const radiant = Number(match.TeamRad);
    const dire = Number(match.TeamDire);
    const pair = pairs.get(pairKey(radiant, dire));
    if (!pair || radiant === dire) continue;
    if (Number(match.WinnerId) === pair.TeamA) pair.ActualWinsA++;
    else if (Number(match.WinnerId) === pair.TeamB) pair.ActualWinsB++;
  }

  for (const pair of pairs.values()) {
    pair.WinsA = pair.ActualWinsA;
    pair.WinsB = pair.ActualWinsB;
  }

  for (const override of overrides) {
    const pair = pairs.get(pairKey(Number(override.TeamA), Number(override.TeamB)));
    if (!pair) continue;
    pair.WinsA = Number(override.WinsA) + Math.max(0, pair.ActualWinsA - Number(override.BaseWinsA ?? pair.ActualWinsA));
    pair.WinsB = Number(override.WinsB) + Math.max(0, pair.ActualWinsB - Number(override.BaseWinsB ?? pair.ActualWinsB));
    pair.Overridden = true;
  }

  for (const pair of pairs.values()) {
    byId.get(pair.TeamA).Wins += pair.WinsA;
    byId.get(pair.TeamA).Losses += pair.WinsB;
    byId.get(pair.TeamB).Wins += pair.WinsB;
    byId.get(pair.TeamB).Losses += pair.WinsA;
  }
  for (const pair of pairs.values()) {
    byId.get(pair.TeamA).Score += pair.WinsA * byId.get(pair.TeamB).Wins;
    byId.get(pair.TeamB).Score += pair.WinsB * byId.get(pair.TeamA).Wins;
  }

  return { teams: [...byId.values()], pairs: [...pairs.values()] };
}
