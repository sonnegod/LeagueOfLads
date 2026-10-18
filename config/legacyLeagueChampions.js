// Import the historical winners already displayed by the league pages into the
// season records used by current championship features. Never replace a saved champion.
export function legacyChampionCandidates(db) {
  return db.prepare(`SELECT l.LeagueId, l.LeagueName, s.SeasonId,
      m.WinnerId ChampionTeamId, COALESCE(t.TeamName, 'Team ' || m.WinnerId) TeamName,
      strftime('%Y-%m-%dT%H:%M:%fZ', ml.DatePlayed) EndedAt
    FROM LeagueInfo l
    JOIN MatchLeague ml ON ml.LeagueId = l.LeagueId AND ml.MatchId = (
      SELECT MAX(last.MatchId) FROM MatchLeague last WHERE last.LeagueId = l.LeagueId)
    JOIN MatchTeam m ON m.MatchId = ml.MatchId
    LEFT JOIN TeamInfo t ON t.TeamId = m.WinnerId
    LEFT JOIN LeagueSeasons s ON s.ExternalLeagueId = l.LeagueId
    WHERE l.Active = 0 AND m.WinnerId > 0 AND m.WinnerId IN (m.TeamRad, m.TeamDire)
      AND (s.SeasonId IS NULL OR (s.Status = 'ended' AND s.ChampionTeamId IS NULL
        AND NOT EXISTS (SELECT 1 FROM SeasonTeams st WHERE st.SeasonId = s.SeasonId)))
    ORDER BY l.LeagueId`).all();
}

export function backfillLegacyChampions(db, timestamp = new Date().toISOString()) {
  return db.transaction(() => {
    const candidates = legacyChampionCandidates(db);
    let inserted = 0, updated = 0;
    const add = db.prepare(`INSERT INTO LeagueSeasons
      (LeagueName, Status, ExternalLeagueId, ChampionTeamId, CreatedAt, UpdatedAt, EndedAt)
      VALUES (?, 'ended', ?, ?, ?, ?, ?)`);
    const fill = db.prepare(`UPDATE LeagueSeasons SET ChampionTeamId = ?, UpdatedAt = ?,
      EndedAt = COALESCE(EndedAt, ?) WHERE SeasonId = ? AND Status = 'ended' AND ChampionTeamId IS NULL`);
    for (const candidate of candidates) {
      if (candidate.SeasonId == null) {
        inserted += add.run(candidate.LeagueName, candidate.LeagueId, candidate.ChampionTeamId,
          timestamp, timestamp, candidate.EndedAt).changes;
      } else {
        updated += fill.run(candidate.ChampionTeamId, timestamp, candidate.EndedAt, candidate.SeasonId).changes;
      }
    }
    return { inserted, updated };
  })();
}
