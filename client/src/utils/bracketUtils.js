// utils/bracketUtils.js
export function prepareBracketData(seriesList) {
  // 1️⃣ Create unique teams list
  const teamsMap = new Map();
  seriesList.forEach(s => {
    teamsMap.set(s.Team1, { id: s.Team1, name: s.Team1Name });
    teamsMap.set(s.Team2, { id: s.Team2, name: s.Team2Name });
  });
  const teams = Array.from(teamsMap.values());

  // 2️⃣ Create matches and map ids
  const matches = seriesList.map((s, index) => ({
    id: `m${index}`,
    team1: s.Team1,
    team2: s.Team2,
    winner: s.WinnerId,
    loser: s.LoserId,
    bracket: s.Bracket || "U",
    games: s.Games || [],
    round: s.Round || 0
  }));

  // 3️⃣ Add winnerTo / loserTo for next match
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];

    // winnerTo: next match where this team plays
    const nextWinnerMatch = matches.find(
      n =>
        n.id !== m.id &&
        (n.team1 === m.winner || n.team2 === m.winner) &&
        !matches
          .slice(0, i)
          .some(p => p.id === n.id && (p.winner === m.winner || p.loser === m.winner))
    );
    m.winnerTo = nextWinnerMatch ? nextWinnerMatch.id : null;

    // loserTo: next match where this loser plays (null if eliminated)
    const nextLoserMatch = matches.find(
      n =>
        n.id !== m.id &&
        (n.team1 === m.loser || n.team2 === m.loser) &&
        !matches
          .slice(0, i)
          .some(p => p.id === n.id && (p.winner === m.loser || p.loser === m.loser))
    );
    m.loserTo = nextLoserMatch ? nextLoserMatch.id : null;
  }

  return { teams, matches };
}
