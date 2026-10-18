export default class TeamRosterStore {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS TeamRosterPlayers (
      TeamSubmissionId INTEGER NOT NULL REFERENCES SeasonTeams(TeamSubmissionId),
      PlayerId INTEGER NOT NULL REFERENCES PlayerInfo(PlayerId),
      Slot INTEGER NOT NULL CHECK (Slot BETWEEN 0 AND 4),
      FinalizedAt TEXT NOT NULL,
      PRIMARY KEY (TeamSubmissionId, PlayerId),
      UNIQUE (TeamSubmissionId, Slot)
    );
    CREATE TABLE IF NOT EXISTS TeamRosterPeriods (
      TeamSubmissionId INTEGER PRIMARY KEY REFERENCES SeasonTeams(TeamSubmissionId),
      EffectiveFrom TEXT,
      EffectiveTo TEXT,
      FromEstimated INTEGER NOT NULL DEFAULT 0 CHECK (FromEstimated IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS idx_SeasonTeams_ExternalTeam ON SeasonTeams(ExternalTeamId, SeasonId);`);
    // Populate finalized signups from leagues that started before this feature.
    this.finalize();
  }

  finalize(seasonId = null, effectiveFrom = null) {
    const result = this.db.prepare(`INSERT INTO TeamRosterPlayers
      (TeamSubmissionId, PlayerId, Slot, FinalizedAt)
      SELECT t.TeamSubmissionId, p.PlayerId, p.Slot, ?
      FROM SeasonTeams t
      JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
      JOIN SeasonTeamPlayers p ON p.TeamSubmissionId = t.TeamSubmissionId
      WHERE s.Status IN ('active', 'ended') AND t.IsManual = 0
        AND (? IS NULL OR s.SeasonId = ?)
        AND NOT EXISTS (SELECT 1 FROM TeamRosterPlayers r
          WHERE r.TeamSubmissionId = t.TeamSubmissionId)`)
      .run(new Date().toISOString(), seasonId, seasonId);
    this.db.prepare(`INSERT INTO TeamRosterPeriods
        (TeamSubmissionId, EffectiveFrom, EffectiveTo, FromEstimated)
      SELECT t.TeamSubmissionId,
        COALESCE(?, (SELECT MIN(ml.DatePlayed) FROM MatchLeague ml
          WHERE ml.LeagueId = s.ExternalLeagueId)),
        CASE WHEN s.Status = 'ended' THEN s.EndedAt END, ?
      FROM SeasonTeams t JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
      WHERE (? IS NULL OR s.SeasonId = ?) AND s.Status IN ('active', 'ended')
        AND EXISTS (SELECT 1 FROM TeamRosterPlayers r WHERE r.TeamSubmissionId = t.TeamSubmissionId)
        AND NOT EXISTS (SELECT 1 FROM TeamRosterPeriods p WHERE p.TeamSubmissionId = t.TeamSubmissionId)`)
      .run(effectiveFrom, effectiveFrom === null ? 1 : 0, seasonId, seasonId);
    this.db.prepare(`UPDATE TeamRosterPeriods SET EffectiveFrom = (
        SELECT MIN(ml.DatePlayed) FROM SeasonTeams t
        JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
        JOIN MatchLeague ml ON ml.LeagueId = s.ExternalLeagueId
        WHERE t.TeamSubmissionId = TeamRosterPeriods.TeamSubmissionId)
      WHERE FromEstimated = 1 AND EffectiveFrom IS NULL`).run();
    this.db.prepare(`UPDATE TeamRosterPeriods SET EffectiveTo = (
        SELECT s.EndedAt FROM SeasonTeams t JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
        WHERE t.TeamSubmissionId = TeamRosterPeriods.TeamSubmissionId)
      WHERE EffectiveTo IS NULL AND EXISTS (
        SELECT 1 FROM SeasonTeams t JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
        WHERE t.TeamSubmissionId = TeamRosterPeriods.TeamSubmissionId AND s.Status = 'ended')`).run();
    return result;
  }

  endSeason(seasonId, effectiveTo) {
    this.db.prepare(`UPDATE TeamRosterPeriods SET EffectiveTo = ?
      WHERE TeamSubmissionId IN (SELECT TeamSubmissionId FROM SeasonTeams WHERE SeasonId = ?)`)
      .run(effectiveTo, seasonId);
  }

  forSubmission(teamSubmissionId) {
    const team = this.db.prepare(`SELECT t.TeamSubmissionId, t.SeasonId,
        t.ExternalTeamId AS TeamId, s.ExternalLeagueId AS LeagueId, s.LeagueName, s.Status AS SeasonStatus,
        COALESCE(e.DisplayName, t.TeamName) AS TeamName,
        period.EffectiveFrom, period.EffectiveTo, period.FromEstimated
      FROM SeasonTeams t
      JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
      LEFT JOIN LeagueRosterEntries e ON e.TeamSubmissionId = t.TeamSubmissionId
      LEFT JOIN TeamRosterPeriods period ON period.TeamSubmissionId = t.TeamSubmissionId
      WHERE t.TeamSubmissionId = ? AND s.Status IN ('active', 'ended')
        AND EXISTS (SELECT 1 FROM TeamRosterPlayers r
          WHERE r.TeamSubmissionId = t.TeamSubmissionId)`).get(teamSubmissionId);
    if (!team) return null;
    const players = this.db.prepare(`SELECT r.PlayerId, p.PlayerName, r.Slot
      FROM TeamRosterPlayers r JOIN PlayerInfo p ON p.PlayerId = r.PlayerId
      WHERE r.TeamSubmissionId = ? ORDER BY r.Slot`).all(teamSubmissionId);
    return { ...team, Source: 'signup', players };
  }

  forTeam(teamId, leagueId = 'all') {
    const team = this.db.prepare(`SELECT t.TeamSubmissionId FROM SeasonTeams t
      JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
      WHERE t.ExternalTeamId = ? AND s.Status IN ('active', 'ended')
        AND (? = 'all' OR s.ExternalLeagueId = ?)
        AND EXISTS (SELECT 1 FROM TeamRosterPlayers r
          WHERE r.TeamSubmissionId = t.TeamSubmissionId)
      ORDER BY CASE WHEN s.Status = 'active' THEN 0 ELSE 1 END, s.SeasonId DESC
      LIMIT 1`).get(teamId, leagueId, leagueId);
    return team ? this.forSubmission(team.TeamSubmissionId) : null;
  }

  historyForTeam(teamId, leagueId = 'all') {
    const submissions = this.db.prepare(`SELECT t.TeamSubmissionId FROM SeasonTeams t
      JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
      JOIN TeamRosterPeriods p ON p.TeamSubmissionId = t.TeamSubmissionId
      WHERE t.ExternalTeamId = ? AND s.Status IN ('active', 'ended')
        AND (? = 'all' OR s.ExternalLeagueId = ?)`)
      .all(teamId, leagueId, leagueId);
    const declared = submissions.map(team => this.forSubmission(team.TeamSubmissionId));
    const declaredLeagues = new Set(declared.map(roster => roster.LeagueId));
    const observed = this.matchLineupHistory(teamId, leagueId)
      .filter(lineup => !declaredLeagues.has(lineup.LeagueId));
    return [...declared, ...observed].sort((a, b) => {
      const aDate = Date.parse(a.EffectiveFrom);
      const bDate = Date.parse(b.EffectiveFrom);
      return (Number.isFinite(bDate) ? bDate : 0) - (Number.isFinite(aDate) ? aDate : 0)
        || (b.MatchId ?? b.TeamSubmissionId) - (a.MatchId ?? a.TeamSubmissionId);
    });
  }

  matchLineupHistory(teamId, leagueId) {
    const rows = this.db.prepare(`SELECT DISTINCT mtp.MatchId, ml.LeagueId, ml.DatePlayed,
        li.LeagueName, mtp.PlayerId, COALESCE(pi.PlayerName, 'Player ' || mtp.PlayerId) AS PlayerName
      FROM MatchTeamPlayer mtp
      JOIN MatchTeam mt ON mt.MatchId = mtp.MatchId AND mtp.TeamId IN (mt.TeamRad, mt.TeamDire)
      JOIN MatchPlayer mp ON mp.MatchId = mtp.MatchId AND mp.PlayerId = mtp.PlayerId
      JOIN MatchLeague ml ON ml.MatchId = mtp.MatchId
      LEFT JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId
      LEFT JOIN PlayerInfo pi ON pi.PlayerId = mtp.PlayerId
      WHERE mtp.TeamId = ? AND mtp.PlayerId > 0 AND (? = 'all' OR ml.LeagueId = ?)
      ORDER BY ml.DatePlayed, mtp.MatchId, mtp.PlayerId`).all(teamId, leagueId, leagueId);
    const matches = new Map();
    for (const row of rows) {
      const key = `${row.LeagueId}:${row.MatchId}`;
      if (!matches.has(key)) matches.set(key, { ...row, players: [] });
      const match = matches.get(key);
      if (!match.players.some(player => player.PlayerId === row.PlayerId)) {
        match.players.push({ PlayerId: row.PlayerId, PlayerName: row.PlayerName });
      }
    }
    const history = [];
    const lineups = new Map();
    for (const match of matches.values()) {
      const signature = `${match.LeagueId}:${match.players.map(player => player.PlayerId).sort((a, b) => a - b).join(',')}`;
      const previous = lineups.get(signature);
      if (previous) {
        previous.EffectiveFrom ||= match.DatePlayed;
        previous.EffectiveTo = match.DatePlayed || previous.EffectiveTo;
        previous.LastMatchId = match.MatchId;
        previous.GamesPlayed += 1;
      } else {
        const period = { TeamId: Number(teamId), LeagueId: match.LeagueId, LeagueName: match.LeagueName,
          Source: 'match_lineup', EffectiveFrom: match.DatePlayed, EffectiveTo: match.DatePlayed,
          FromEstimated: 1, MatchId: match.MatchId, LastMatchId: match.MatchId, GamesPlayed: 1,
          players: match.players };
        history.push(period);
        lineups.set(signature, period);
      }
    }
    return history;
  }

  appearances(teamId, leagueId = 'all') {
    return this.db.prepare(`WITH declared_teams AS (
        SELECT t.TeamSubmissionId, t.ExternalTeamId AS TeamId, s.ExternalLeagueId AS LeagueId
        FROM SeasonTeams t JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
        WHERE s.Status IN ('active', 'ended') AND t.ExternalTeamId = ?
          AND EXISTS (SELECT 1 FROM TeamRosterPlayers r WHERE r.TeamSubmissionId = t.TeamSubmissionId)
      ), appearances AS (
        SELECT DISTINCT mtp.MatchId, mtp.PlayerId, d.TeamSubmissionId,
          CASE WHEN d.TeamSubmissionId IS NULL THEN 'unknown'
            WHEN EXISTS (SELECT 1 FROM TeamRosterPlayers r
              WHERE r.TeamSubmissionId = d.TeamSubmissionId AND r.PlayerId = mtp.PlayerId)
              THEN 'roster' ELSE 'standin' END AS Role
        FROM MatchTeamPlayer mtp
        JOIN MatchTeam mt ON mt.MatchId = mtp.MatchId AND mtp.TeamId IN (mt.TeamRad, mt.TeamDire)
        JOIN MatchLeague ml ON ml.MatchId = mtp.MatchId
        LEFT JOIN declared_teams d ON d.LeagueId = ml.LeagueId AND d.TeamId = mtp.TeamId
        WHERE mtp.TeamId = ? AND (? = 'all' OR ml.LeagueId = ?)
      )
      SELECT PlayerId, SUM(Role = 'roster') AS RosterGames,
        SUM(Role = 'standin') AS StandInGames, SUM(Role = 'unknown') AS UnclassifiedGames
      FROM appearances GROUP BY PlayerId`).all(teamId, teamId, leagueId, leagueId);
  }
}
