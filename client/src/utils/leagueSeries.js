export function seriesMatchesForDisplay(series) {
  return series.flatMap(item => (item.seriesMatches || []).map(match => ({
    ...match,
    SeriesId: item.SeriesId,
    RadiantTeamId: match.rad_team_id,
    RadiantTeamName: match.rad_team_name,
    DireTeamId: match.dire_team_id,
    DireTeamName: match.dire_team_name,
  })));
}

export function groupLeagueSeries(series, matches) {
  const byId = new Map(series.map(item => [String(item.SeriesId), { ...item, matches: [] }]));
  const ungroupedMatches = [];
  for (const match of matches) {
    const parent = byId.get(String(match.SeriesId));
    if (parent) parent.matches.push(match);
    else ungroupedMatches.push(match);
  }

  const groups = [...byId.values()].filter(item => item.matches.length > 0).map(item => {
    item.matches.sort((a, b) => Number(a.MatchId) - Number(b.MatchId));
    let team1Wins = 0;
    let team2Wins = 0;
    for (const match of item.matches) {
      const winnerId = match.WinnerSide === 'r' ? match.RadiantTeamId
        : match.WinnerSide === 'd' ? match.DireTeamId : null;
      if (winnerId == null) continue;
      if (String(winnerId) === String(item.Team1)) team1Wins += 1;
      else if (String(winnerId) === String(item.Team2)) team2Wins += 1;
    }
    const firstMatch = item.matches[0];
    const teamName = teamId => String(firstMatch.RadiantTeamId) === String(teamId)
      ? firstMatch.RadiantTeamName : String(firstMatch.DireTeamId) === String(teamId)
        ? firstMatch.DireTeamName : null;
    return {
      ...item,
      team_one: teamName(item.Team1) || item.team_one,
      team_two: teamName(item.Team2) || item.team_two,
      team1Wins,
      team2Wins,
      hasPendingResults: team1Wins + team2Wins < item.matches.length,
    };
  });
  return { series: groups, ungroupedMatches };
}
