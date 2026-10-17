export function ensurePublicScoutingSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS PublicPlayerSync (
    PlayerId INTEGER PRIMARY KEY, LastAttemptAt TEXT NOT NULL, LastSuccessAt TEXT, ErrorCode TEXT);
    CREATE INDEX IF NOT EXISTS idx_PublicMatchPlayer_PlayerId_DateCreated ON PublicMatchPlayer(PlayerId, DateCreated);
    CREATE INDEX IF NOT EXISTS idx_PublicMatchPlayer_DateCreated_HeroId ON PublicMatchPlayer(DateCreated, HeroId);`);
}

export function recordPublicSync(db, playerId, succeeded, errorCode = null) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO PublicPlayerSync (PlayerId,LastAttemptAt,LastSuccessAt,ErrorCode) VALUES (?,?,?,?)
    ON CONFLICT(PlayerId) DO UPDATE SET LastAttemptAt=excluded.LastAttemptAt,
    LastSuccessAt=COALESCE(excluded.LastSuccessAt,PublicPlayerSync.LastSuccessAt),ErrorCode=excluded.ErrorCode`)
    .run(playerId, now, succeeded ? now : null, succeeded ? null : String(errorCode || 'FETCH_FAILED').slice(0, 40));
}

export function publicScoutingPlayers(db) {
  // Include website signups before their first official match, and retain recent league players.
  const season = db.prepare("SELECT SeasonId FROM LeagueSeasons WHERE Status <> 'ended' ORDER BY SeasonId DESC LIMIT 1").get();
  const league = db.prepare(`SELECT LeagueId FROM LeagueInfo ORDER BY Active DESC, LeagueId DESC LIMIT 1`).get();
  return db.prepare(`SELECT DISTINCT p.PlayerId, CAST(p.PlayerName AS TEXT) PlayerName FROM PlayerInfo p
    WHERE p.PlayerId > 0 AND (EXISTS (SELECT 1 FROM MatchPlayer mp JOIN MatchLeague ml ON ml.MatchId=mp.MatchId
      WHERE ml.LeagueId = ? AND mp.PlayerId=p.PlayerId)
    OR EXISTS (SELECT 1 FROM SeasonTeamPlayers sp JOIN SeasonTeams t ON t.TeamSubmissionId=sp.TeamSubmissionId
      WHERE t.SeasonId=? AND sp.PlayerId=p.PlayerId)
    OR EXISTS (SELECT 1 FROM TeamRosterPlayers rp JOIN SeasonTeams t ON t.TeamSubmissionId=rp.TeamSubmissionId
      WHERE t.SeasonId=? AND rp.PlayerId=p.PlayerId)) ORDER BY p.PlayerName COLLATE NOCASE`)
    .all(league?.LeagueId || null, season?.SeasonId || null, season?.SeasonId || null);
}
