// Read each set of children once, rather than issuing two queries per snapshot.
export function readLiveMatchCurrentStates(db) {
  return db.transaction(() => {
    const rows = db.prepare(`SELECT current.*, latest.SnapshotId AS LatestSnapshotId,
        latest.CreatedAt AS LastChangedAt
      FROM LiveMatchCurrentState current
      LEFT JOIN LiveMatchSnapshots latest ON latest.SnapshotId = (
        SELECT SnapshotId FROM LiveMatchSnapshots WHERE MatchId = current.MatchId
        ORDER BY SnapshotId DESC LIMIT 1
      )
      ORDER BY current.LastUpdated DESC, current.MatchId`).all();
    if (!rows.length) return [];
    const players = groupPlayers(db.prepare(`SELECT * FROM LiveMatchCurrentPlayer
      ORDER BY MatchId, Team, PlayerSlot, AccountId`).all(), 'MatchId');
    const drafts = new Map(db.prepare('SELECT * FROM LiveMatchCurrentDraft').all().map(row => [row.MatchId, row]));
    return rows.map(row => ({ ...row, Players: players.get(row.MatchId) || [], Draft: drafts.get(row.MatchId) || null }));
  })();
}

export function readLiveMatchSnapshots(db, matchId, afterSnapshotId = 0) {
  return db.transaction(() => {
    const rows = db.prepare(`SELECT * FROM LiveMatchSnapshots
      WHERE MatchId = ? AND SnapshotId > ? ORDER BY SnapshotId`).all(matchId, afterSnapshotId);
    if (!rows.length) return [];
    const players = groupPlayers(db.prepare(`SELECT * FROM LiveMatchSnapshotPlayer
      WHERE MatchId = ? AND SnapshotId > ? ORDER BY SnapshotId, Team, PlayerSlot, AccountId`)
      .all(matchId, afterSnapshotId), 'SnapshotId');
    const drafts = new Map(db.prepare(`SELECT * FROM LiveMatchSnapshotDraft
      WHERE MatchId = ? AND SnapshotId > ?`).all(matchId, afterSnapshotId).map(row => [row.SnapshotId, row]));
    return rows.map(row => ({ ...row, Players: players.get(row.SnapshotId) || [], Draft: drafts.get(row.SnapshotId) || null }));
  })();
}

function groupPlayers(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}
