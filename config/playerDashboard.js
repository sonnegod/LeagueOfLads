const NAME_CHANGE_INTERVAL = 30 * 86400000;

export function nextNameChangeAt(lastChanged) {
  if (!lastChanged || !Number.isFinite(Date.parse(lastChanged))) return null;
  return new Date(Date.parse(lastChanged) + NAME_CHANGE_INTERVAL).toISOString();
}

export function changePlayerDisplayName(db, accountId, value, now = new Date()) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40)
    return { success: false, message: 'Enter a league name of 1–40 characters.', status: 400 };
  return db.transaction(() => {
    const player = db.prepare('SELECT LastDateChanged FROM PlayerInfo WHERE PlayerId = ?').get(accountId);
    if (!player) return { success: false, message: 'Your league profile will be available after you sign up or play a league match.', status: 404 };
    const next = nextNameChangeAt(player.LastDateChanged);
    if (next && Date.parse(next) > now.getTime())
      return { success: false, message: 'You can only change your name once every 30 days.', nextNameChangeAt: next, status: 400 };
    const name = value.trim();
    db.prepare('UPDATE PlayerInfo SET PlayerName = ?, LastDateChanged = ? WHERE PlayerId = ?').run(name, now.toISOString(), accountId);
    return { success: true, message: 'League name updated.', name, nextNameChangeAt: nextNameChangeAt(now.toISOString()) };
  })();
}

// Dashboard queries return summaries and six recent games, never a full career
// payload. Repeated participant rows count as a single appearance per match.
const appearances = `WITH ranked AS (
  SELECT mp.*, ROW_NUMBER() OVER (PARTITION BY MatchId ORDER BY rowid DESC) AS occurrence
    FROM MatchPlayer mp WHERE PlayerId = ?
), league_matches AS (
  SELECT ml.MatchId, MAX(ml.LeagueId) AS LeagueId, MAX(ml.DatePlayed) AS DatePlayed
  FROM MatchLeague ml JOIN ranked r ON r.MatchId=ml.MatchId AND r.occurrence=1
  GROUP BY ml.MatchId
), appearances AS (
  SELECT r.*, lm.LeagueId, lm.DatePlayed, li.LeagueName FROM ranked r
  JOIN league_matches lm ON lm.MatchId=r.MatchId JOIN LeagueInfo li ON li.LeagueId=lm.LeagueId
  WHERE r.occurrence=1
)`;

export function getPlayerDashboard(db, accountId) {
  const player = db.prepare('SELECT PlayerId, PlayerName, LastDateChanged FROM PlayerInfo WHERE PlayerId = ?').get(accountId);
  const league = db.prepare('SELECT LeagueId, LeagueName FROM LeagueInfo WHERE Active = 1 ORDER BY LeagueId DESC LIMIT 1').get();
  const seasonSummary = league ? db.prepare(`${appearances}
    SELECT COUNT(*) AS games, COALESCE(SUM(Winner = 1), 0) AS wins, COALESCE(SUM(Winner = 0), 0) AS losses,
      COALESCE(SUM(Winner IS NULL OR Winner NOT IN (0, 1)), 0) AS unknown
    FROM appearances a WHERE a.LeagueId=?`).get(accountId, league.LeagueId) : null;
  const recentMatches = db.prepare(`${appearances}
    SELECT a.MatchId, a.HeroId, h.HeroName, a.Winner, a.Kills, a.Deaths, a.Assists, a.GPM, a.XPM,
      CASE WHEN mt.StartTimeUtc > 0 THEN strftime('%Y-%m-%dT%H:%M:%SZ',mt.StartTimeUtc,'unixepoch')
        ELSE a.DatePlayed END AS DatePlayed, a.LeagueName
    FROM appearances a LEFT JOIN HeroInfo h ON h.HeroId=a.HeroId
    LEFT JOIN MatchTeam mt ON mt.MatchId=a.MatchId ORDER BY a.MatchId DESC LIMIT 6`).all(accountId);
  const teams = db.prepare(`SELECT t.TeamSubmissionId, t.ExternalTeamId AS TeamId,
      COALESCE(e.DisplayName,t.TeamName) AS TeamName
    FROM TeamRosterPlayers r JOIN SeasonTeams t ON t.TeamSubmissionId=r.TeamSubmissionId
    JOIN LeagueSeasons s ON s.SeasonId=t.SeasonId
    LEFT JOIN LeagueRosterEntries e ON e.TeamSubmissionId=t.TeamSubmissionId AND e.LeagueId=s.ExternalLeagueId
    WHERE r.PlayerId=? AND s.Status='active' ORDER BY t.TeamSubmissionId`).all(accountId);
  const teammates = teams.length ? db.prepare(`SELECT t.TeamSubmissionId, r.PlayerId, p.PlayerName, r.Slot
    FROM TeamRosterPlayers r JOIN SeasonTeams t ON t.TeamSubmissionId=r.TeamSubmissionId
    JOIN LeagueSeasons s ON s.SeasonId=t.SeasonId
    LEFT JOIN PlayerInfo p ON p.PlayerId=r.PlayerId
    WHERE s.Status='active' AND EXISTS (SELECT 1 FROM TeamRosterPlayers own
      WHERE own.TeamSubmissionId=t.TeamSubmissionId AND own.PlayerId=?)
    ORDER BY t.TeamSubmissionId,r.Slot`).all(accountId) : [];
  // Use the league's two latest seasons with games, rather than reaching back
  // to an inactive player's older seasons or consuming a slot for an empty season.
  const formSeasons = db.prepare(`SELECT li.LeagueId,li.LeagueName FROM LeagueInfo li
    WHERE EXISTS (SELECT 1 FROM MatchLeague ml JOIN MatchTeam mt ON mt.MatchId=ml.MatchId
      WHERE ml.LeagueId=li.LeagueId AND EXISTS (SELECT 1 FROM MatchPlayer mp
        WHERE mp.MatchId=mt.MatchId AND mp.HeroId>0 AND mp.Winner IN (0,1)))
    ORDER BY li.LeagueId DESC LIMIT 2`).all();
  const formHeroes = formSeasons.length ? db.prepare(`${appearances}
    SELECT a.HeroId,h.HeroName,COUNT(*) AS games,SUM(a.Winner=1) AS wins,SUM(a.Winner=0) AS losses,
      ROUND(100.0*SUM(a.Winner=1)/COUNT(*),1) AS winRate,
      ROUND(1.0*SUM(CASE WHEN a.Kills IS NOT NULL AND a.Deaths IS NOT NULL AND a.Assists IS NOT NULL
        THEN a.Kills+a.Assists END)/MAX(1,SUM(CASE WHEN a.Kills IS NOT NULL AND a.Deaths IS NOT NULL
          AND a.Assists IS NOT NULL THEN a.Deaths END)),2) AS kda
    FROM appearances a JOIN MatchTeam mt ON mt.MatchId=a.MatchId
    LEFT JOIN HeroInfo h ON h.HeroId=a.HeroId
    WHERE a.LeagueId IN (${formSeasons.map(()=>'?').join(',')}) AND a.HeroId>0 AND a.Winner IN (0,1)
    GROUP BY a.HeroId HAVING COUNT(*)>=5 AND SUM(a.Winner=1)*2>COUNT(*)
    ORDER BY winRate DESC,games DESC,MAX(a.MatchId) DESC,a.HeroId LIMIT 3`)
    .all(accountId,...formSeasons.map(s=>s.LeagueId)) : [];
  return { player: player ? { id: player.PlayerId, name: player.PlayerName,
      nextNameChangeAt: nextNameChangeAt(player.LastDateChanged) } : null,
    currentLeague: league || null, seasonSummary, recentMatches,
    heroForm: {seasons:formSeasons,heroes:formHeroes},
    teams: teams.map(team=>({...team,players:teammates.filter(p=>p.TeamSubmissionId===team.TeamSubmissionId)
      .map(({PlayerId,PlayerName})=>({PlayerId,PlayerName}))})) };
}
