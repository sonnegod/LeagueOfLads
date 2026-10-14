// A bracket link, not the current score, identifies the series format. A BO5
// standing at 2-1 must not be mistaken for a completed BO3.
export function bracketSeriesFormats(raw) {
  let bracket;
  try { bracket = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return new Map(); }
  const result = new Map();
  for (const [key, label, fallback] of [['upperBracket', 'Upper bracket', 3], ['lowerBracket', 'Lower bracket', 3], ['grandFinals', 'Grand final', 5]]) {
    const rounds = Array.isArray(bracket?.[key]) ? bracket[key] : [];
    for (const round of rounds) for (const node of Array.isArray(round.matches) ? round.matches : [round]) {
      const id = Number(node.seriesId); const team1 = Number(node.team1Id); const team2 = Number(node.team2Id);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(team1) || team1 <= 0
        || !Number.isSafeInteger(team2) || team2 <= 0 || team1 === team2) continue;
      const bestOf = node.bestOf === undefined ? fallback : Number(node.bestOf);
      if (![3, 5].includes(bestOf)) continue;
      if (result.has(id)) { result.set(id, null); continue; }
      result.set(id, { bestOf, team1, team2, roundLabel: key === 'grandFinals' ? label : `${label} round ${node.round ?? round.round ?? 1}` });
    }
  }
  return result;
}

export function verifiedSeriesOutcome(series, games) {
  if (![3, 5].includes(series.BestOf) || games.length !== series.SourceMatchCount || !games.length
    || games.length > series.BestOf || games.some(g => g.Stage !== 'playoff' || !g.StartedAtUtc
      || ![series.Team1Id, series.Team2Id].includes(g.WinnerTeamId))) return null;
  const ordered = [...games].sort((a, b) => a.StartedAtUtc.localeCompare(b.StartedAtUtc));
  const target = (series.BestOf + 1) / 2;
  const scores = new Map([[series.Team1Id, 0], [series.Team2Id, 0]]);
  for (let index = 0; index < ordered.length; index++) {
    if (index && (ordered[index].StartedAtUtc <= ordered[index - 1].StartedAtUtc
      || Date.parse(ordered[index - 1].StartedAtUtc) + ordered[index - 1].DurationSeconds * 1000 > Date.parse(ordered[index].StartedAtUtc))) return null;
    const game = ordered[index]; scores.set(game.WinnerTeamId, scores.get(game.WinnerTeamId) + 1);
    if (scores.get(game.WinnerTeamId) === target && index !== ordered.length - 1) return null;
  }
  const winnerId = [...scores].find(([, score]) => score === target)?.[0];
  if (!winnerId) return null;
  const loserId = winnerId === series.Team1Id ? series.Team2Id : series.Team1Id;
  const reverseSweep = ordered.length === series.BestOf
    && ordered.slice(0, target - 1).every(g => g.WinnerTeamId === loserId)
    && ordered.slice(target - 1).every(g => g.WinnerTeamId === winnerId);
  return { winnerId, loserId, winnerScore: target, loserScore: scores.get(loserId), reverseSweep, games: ordered };
}
