export function ensureChampionshipRosterSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ChampionshipRosterPlayers (
    SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
    TeamId INTEGER NOT NULL,
    PlayerId INTEGER NOT NULL,
    Slot INTEGER NOT NULL CHECK (Slot BETWEEN 0 AND 4),
    UpdatedAt TEXT NOT NULL,
    PRIMARY KEY (SeasonId, TeamId, PlayerId),
    UNIQUE (SeasonId, TeamId, Slot)
  );
  CREATE INDEX IF NOT EXISTS idx_MatchLeague_LeagueId_MatchId ON MatchLeague(LeagueId, MatchId);
  CREATE INDEX IF NOT EXISTS idx_MatchTeamPlayer_MatchId_PlayerId_TeamId ON MatchTeamPlayer(MatchId, PlayerId, TeamId);
  CREATE INDEX IF NOT EXISTS idx_MatchPlayer_MatchId_PlayerId ON MatchPlayer(MatchId, PlayerId)`);
}

// Materialize only this team's completed season games, then look up their players.
// Keep games first in the join: a correlated MatchPlayer lookup over the whole
// warehouse is especially expensive on databases without SQLite statistics.
export const CHAMPIONSHIP_ROSTER_PLAYERS_SQL = `WITH team_games AS MATERIALIZED (
    SELECT m.MatchId, m.TeamRad, m.TeamDire, CASE WHEN m.WinnerId = ? THEN 1 ELSE 0 END Won
    FROM MatchLeague ml JOIN MatchTeam m ON m.MatchId = ml.MatchId
    WHERE ml.LeagueId = ? AND ? IN (m.TeamRad, m.TeamDire)
      AND m.WinnerId IN (m.TeamRad, m.TeamDire) AND m.TeamRad <> m.TeamDire
  ), appearances AS (
    SELECT p.MatchId, p.PlayerId, MAX(g.Won) Won
    FROM team_games g CROSS JOIN MatchTeamPlayer p
    WHERE p.MatchId = g.MatchId AND p.PlayerId > 0 AND p.TeamId IN (g.TeamRad, g.TeamDire)
      AND EXISTS (SELECT 1 FROM MatchPlayer mp WHERE mp.MatchId = p.MatchId AND mp.PlayerId = p.PlayerId)
    GROUP BY p.MatchId, p.PlayerId HAVING COUNT(DISTINCT p.TeamId) = 1 AND MIN(p.TeamId) = ?
  ) SELECT a.PlayerId, COALESCE(CAST(pi.PlayerName AS TEXT), 'Player ' || a.PlayerId) PlayerName,
    COUNT(*) Games, SUM(a.Won) Wins FROM appearances a
    LEFT JOIN PlayerInfo pi ON pi.PlayerId = a.PlayerId GROUP BY a.PlayerId
    ORDER BY Games DESC, PlayerName COLLATE NOCASE, a.PlayerId`;

export function hasSignupRoster(db, seasonId) {
  return Boolean(db.prepare(`SELECT 1 FROM SeasonTeams t JOIN TeamRosterPlayers p
    ON p.TeamSubmissionId = t.TeamSubmissionId WHERE t.SeasonId = ? LIMIT 1`).get(seasonId));
}
