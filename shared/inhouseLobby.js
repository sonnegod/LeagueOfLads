// Dota's lobby team slots are numbered 1–5 (unlike match player_slot).
export function inhouseLobbyAssignments(players) {
  return ['A','B'].flatMap(side => players.filter(p => p.side === side).sort((a,b) =>
    (a.position || 9) - (b.position || 9) || (a.pickNumber || 0) - (b.pickNumber || 0)
      || (a.joinedAt || 0) - (b.joinedAt || 0) || a.playerId - b.playerId)
    .map((p,slot) => ({playerId:p.playerId,team:side === 'A' ? 0 : 1,slot:slot + 1})));
}
