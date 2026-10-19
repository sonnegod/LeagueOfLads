export function ensurePendingRosterSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS SeasonPendingRosterSlots (
    TeamSubmissionId INTEGER NOT NULL, Slot INTEGER NOT NULL CHECK (Slot BETWEEN 0 AND 4),
    EstimatedMMR INTEGER NOT NULL CHECK (EstimatedMMR > 5500), PlaceholderPlayerId INTEGER,
    ConfirmedPlayerId INTEGER, ConfirmedMMR INTEGER, ConfirmedAtUtc TEXT,
    CreatedAtUtc TEXT NOT NULL, UpdatedAtUtc TEXT NOT NULL, ActorId TEXT,
    PRIMARY KEY (TeamSubmissionId, Slot)
  )`);
}

export function pendingSlotOverrides(db, seasonId) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='SeasonPendingRosterSlots'").get()) return [];
  return db.prepare(`SELECT p.* FROM SeasonPendingRosterSlots p
    JOIN SeasonTeams t ON t.TeamSubmissionId=p.TeamSubmissionId WHERE t.SeasonId=?
    ORDER BY p.TeamSubmissionId,p.Slot`).all(seasonId);
}

export function currentPendingSlots(db, seasonId) {
  return pendingSlotOverrides(db, seasonId).filter(p => p.ConfirmedPlayerId == null)
    .map(({TeamSubmissionId,Slot,EstimatedMMR}) => ({TeamSubmissionId,Slot,EstimatedMMR}));
}

// Original submissions remain intact. An explicit slot override removes a fake
// placeholder identity without assigning its history to the unknown player.
export function applySignupSlotOverrides(roster, overrides) {
  const keys = new Set(overrides.map(p => `${p.TeamSubmissionId}:${p.Slot}`));
  return [...roster.filter(p => !keys.has(`${p.TeamSubmissionId}:${p.Slot}`)),
    ...overrides.filter(p => p.ConfirmedPlayerId != null).map(p => ({
      TeamSubmissionId:p.TeamSubmissionId,PlayerId:p.ConfirmedPlayerId,Slot:p.Slot,
    }))].sort((a,b) => a.TeamSubmissionId-b.TeamSubmissionId || a.Slot-b.Slot);
}
