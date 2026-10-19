import { applySignupSlotOverrides, pendingSlotOverrides } from '../config/pendingRosterSlots.js';

export function currentSeasonRoster(db, seasonId, status) {
  const table = status === 'active' && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='TeamRosterPlayers'").get()
    ? 'TeamRosterPlayers' : 'SeasonTeamPlayers';
  const roster = db.prepare(`SELECT p.TeamSubmissionId,p.PlayerId,p.Slot FROM ${table} p
    JOIN SeasonTeams t ON t.TeamSubmissionId=p.TeamSubmissionId WHERE t.SeasonId=? ORDER BY p.TeamSubmissionId,p.Slot`).all(seasonId);
  if (table === 'SeasonTeamPlayers') return applySignupSlotOverrides(roster, pendingSlotOverrides(db, seasonId));
  const pending = pendingSlotOverrides(db, seasonId).filter(p => p.ConfirmedPlayerId == null);
  return roster.filter(p => !pending.some(s => s.TeamSubmissionId === p.TeamSubmissionId && s.Slot === p.Slot));
}

export function conflictingRosterPlayers(roster) {
  const teamsByPlayer = new Map();
  for (const row of roster) {
    if (!teamsByPlayer.has(row.PlayerId)) teamsByPlayer.set(row.PlayerId, new Set());
    teamsByPlayer.get(row.PlayerId).add(row.TeamSubmissionId);
  }
  return [...teamsByPlayer].filter(([, teams]) => teams.size > 1).map(([player]) => player).sort((a, b) => a - b);
}
