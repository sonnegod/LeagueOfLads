export function isRegularTeamPlayer(gamesPlayed, teamGames, earlySeason = false) {
  const played = Number(gamesPlayed);
  const total = Number(teamGames);
  if (!Number.isFinite(played) || !Number.isFinite(total) || played < 2 || total <= 0) return false;
  return earlySeason && total <= 8 ? played * 4 >= total * 3 : played * 2 > total;
}
