import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureAnalyticsSchema } from './analyticsSchema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultPaths = {
  lads: path.join(root, 'db/LadsData.db'),
  public: path.join(root, 'db/public.db'),
  analytics: path.join(root, 'db/Analytics.db'),
};

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

export function refreshAnalytics({ ladsPath = defaultPaths.lads, publicPath = defaultPaths.public,
  analyticsPath = defaultPaths.analytics, asOf = new Date().toISOString(), scope = 'all' } = {}) {
  if (!['all', 'league', 'public'].includes(scope)) throw new Error('scope must be all, league, or public');
  const refreshLeague = scope !== 'public';
  const refreshPublic = scope !== 'league';
  const cutoff = new Date(asOf);
  if (Number.isNaN(cutoff.getTime())) throw new Error('asOf must be a valid date');
  const timestamp = cutoff.toISOString();
  const since = new Date(cutoff.getTime() - 30 * 86400000).toISOString();
  let lads;
  let publicDb;
  let analytics;
  try {
    if (refreshLeague) lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
    if (refreshPublic) publicDb = new Database(publicPath, { readonly: true, fileMustExist: true });
    analytics = new Database(analyticsPath);
    ensureAnalyticsSchema(analytics);

    const leagueStats = refreshLeague ? lads.prepare(`SELECT ml.LeagueId, mp.PlayerId,
      COALESCE(CAST(pi.PlayerName AS TEXT), 'Player ' || mp.PlayerId) AS PlayerName,
      MAX(ml.DatePlayed) AS LastMatchDate, COUNT(*) AS Games,
      SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) AS Wins,
      SUM(COALESCE(mp.Kills, 0)) AS TotalKills,
      SUM(COALESCE(mp.Deaths, 0)) AS TotalDeaths,
      SUM(COALESCE(mp.Assists, 0)) AS TotalAssists,
      MAX(COALESCE(mp.Kills, 0)) AS MaxKills,
      MAX(COALESCE(mp.Deaths, 0)) AS MaxDeaths,
      MAX(COALESCE(mp.Assists, 0)) AS MaxAssists,
      AVG(mp.GPM) AS AvgGPM, MAX(mp.GPM) AS MaxGPM,
      AVG(mp.XPM) AS AvgXPM, MAX(mp.XPM) AS MaxXPM,
      AVG(mp.Lasthits) AS AvgLastHits, MAX(mp.Lasthits) AS MaxLastHits,
      AVG(mp.HeroDamage) AS AvgHeroDamage, MAX(mp.HeroDamage) AS MaxHeroDamage,
      COUNT(DISTINCT mp.HeroId) AS DistinctHeroes
      FROM MatchPlayer mp JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
      LEFT JOIN PlayerInfo pi ON pi.PlayerId = mp.PlayerId
      WHERE (ml.DatePlayed IS NULL OR ml.DatePlayed <= ?)
        AND mp.PlayerId > 0 AND ml.LeagueId > 0
      GROUP BY ml.LeagueId, mp.PlayerId`).all(timestamp.slice(0, 10)) : [];
    const weekly = refreshLeague ? lads.prepare(`SELECT ml.LeagueId,
      date(ml.DatePlayed, '-' || ((CAST(strftime('%w', ml.DatePlayed) AS INTEGER) + 6) % 7) || ' days') AS WeekStart,
      mp.PlayerId, COALESCE(CAST(pi.PlayerName AS TEXT), 'Player ' || mp.PlayerId) AS PlayerName,
      COUNT(*) AS Games, SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) AS Wins,
      SUM(COALESCE(mp.Kills, 0)) AS TotalKills,
      SUM(COALESCE(mp.Deaths, 0)) AS TotalDeaths,
      SUM(COALESCE(mp.Assists, 0)) AS TotalAssists,
      MAX(COALESCE(mp.Kills, 0)) AS MaxKills,
      MAX(COALESCE(mp.Deaths, 0)) AS MaxDeaths, AVG(mp.GPM) AS AvgGPM
      FROM MatchPlayer mp JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
      LEFT JOIN PlayerInfo pi ON pi.PlayerId = mp.PlayerId
      WHERE ml.DatePlayed <= ? AND mp.PlayerId > 0 AND ml.LeagueId > 0
      GROUP BY ml.LeagueId, WeekStart, mp.PlayerId`).all(timestamp.slice(0, 10)) : [];
    const publicStats = refreshPublic ? publicDb.prepare(`SELECT pi.PlayerId, CAST(pi.PlayerName AS TEXT) AS PlayerName,
      COUNT(pm.MatchId) AS Games, SUM(CASE WHEN pm.Won = 1 THEN 1 ELSE 0 END) AS Wins,
      COALESCE(SUM(pm.Kills), 0) AS TotalKills,
      COALESCE(SUM(pm.Deaths), 0) AS TotalDeaths,
      COALESCE(SUM(pm.Assists), 0) AS TotalAssists,
      COUNT(DISTINCT pm.HeroId) AS DistinctHeroes, MAX(pm.DateCreated) AS LastMatchAt
      FROM PlayerInfo pi LEFT JOIN PublicMatchPlayer pm ON pm.PlayerId = pi.PlayerId
        AND pm.DateCreated >= ? AND pm.DateCreated <= ?
      WHERE pi.PlayerId > 0 GROUP BY pi.PlayerId`).all(since, timestamp) : [];
    const matches = refreshLeague ? lads.prepare(`SELECT ml.MatchId, ml.LeagueId, ml.DatePlayed AS PlayedDate,
      mt.TeamRad AS RadiantTeamId, mt.TeamDire AS DireTeamId, mt.WinnerId AS WinnerTeamId,
      (SELECT si.Stage FROM SeriesMatch sm JOIN SeriesInfo si ON si.SeriesId = sm.SeriesId
       WHERE sm.MatchId = ml.MatchId LIMIT 1) AS Stage,
      COALESCE(CAST(w.TeamName AS TEXT), 'Team ' || mt.WinnerId) AS WinnerName,
      COALESCE(CAST(l.TeamName AS TEXT), 'Team ' || CASE WHEN mt.WinnerId = mt.TeamRad THEN mt.TeamDire ELSE mt.TeamRad END) AS LoserName
      FROM MatchLeague ml JOIN MatchTeam mt ON mt.MatchId = ml.MatchId
      LEFT JOIN TeamInfo w ON w.TeamId = mt.WinnerId
      LEFT JOIN TeamInfo l ON l.TeamId = CASE WHEN mt.WinnerId = mt.TeamRad THEN mt.TeamDire ELSE mt.TeamRad END
      WHERE ml.DatePlayed <= ? AND ml.LeagueId > 0 AND mt.TeamRad > 0 AND mt.TeamDire > 0
        AND mt.TeamRad <> mt.TeamDire AND mt.WinnerId IN (mt.TeamRad, mt.TeamDire)
      ORDER BY ml.DatePlayed DESC, ml.MatchId DESC`).all(timestamp.slice(0, 10)) : [];

    const apply = analytics.transaction(() => {
      if (refreshLeague) analytics.prepare("DELETE FROM HomeFeedItems WHERE ItemKey LIKE 'match:%' OR ItemKey LIKE 'weekly-kills:%'").run();
      const tables = [
        ...(refreshLeague ? ['WeeklyPlayerStats', 'PlayerLeagueStats'] : []),
        ...(refreshPublic ? ['PlayerRecentPublicStats'] : []),
      ];
      for (const table of tables) {
        analytics.prepare(`DELETE FROM ${table}`).run();
      }
      const insertLeague = analytics.prepare(`INSERT INTO PlayerLeagueStats VALUES
        (@LeagueId, @PlayerId, @PlayerName, @LastMatchDate, @Games, @Wins,
         @TotalKills, @TotalDeaths, @TotalAssists, @MaxKills, @MaxDeaths, @MaxAssists,
         @AvgGPM, @MaxGPM, @AvgXPM, @MaxXPM, @AvgLastHits, @MaxLastHits,
         @AvgHeroDamage, @MaxHeroDamage, @DistinctHeroes, @RefreshedAt)`);
      for (const row of leagueStats) insertLeague.run({ ...row, RefreshedAt: timestamp });
      const insertWeekly = analytics.prepare(`INSERT INTO WeeklyPlayerStats VALUES
        (@LeagueId, @WeekStart, @PlayerId, @PlayerName, @Games, @Wins,
         @TotalKills, @TotalDeaths, @TotalAssists, @MaxKills, @MaxDeaths, @AvgGPM, @RefreshedAt)`);
      for (const row of weekly) insertWeekly.run({ ...row, RefreshedAt: timestamp });
      const insertPublic = analytics.prepare(`INSERT INTO PlayerRecentPublicStats VALUES
        (@PlayerId, @PlayerName, @AsOf, 30, @Games, @Wins, @TotalKills,
         @TotalDeaths, @TotalAssists, @DistinctHeroes, @LastMatchAt, @RefreshedAt)`);
      for (const row of publicStats) insertPublic.run({ ...row, AsOf: timestamp, RefreshedAt: timestamp });
      const insertMatch = analytics.prepare(`INSERT INTO CompletedMatchFacts
        (MatchId, LeagueId, PlayedDate, RadiantTeamId, DireTeamId, WinnerTeamId, Stage, RefreshedAt)
        VALUES (@MatchId, @LeagueId, @PlayedDate, @RadiantTeamId, @DireTeamId,
          @WinnerTeamId, @Stage, @RefreshedAt)
        ON CONFLICT(MatchId) DO UPDATE SET LeagueId = excluded.LeagueId,
          PlayedDate = excluded.PlayedDate, RadiantTeamId = excluded.RadiantTeamId,
          DireTeamId = excluded.DireTeamId, WinnerTeamId = excluded.WinnerTeamId,
          Stage = excluded.Stage, RefreshedAt = excluded.RefreshedAt`);
      for (const row of matches) insertMatch.run({ ...row, RefreshedAt: timestamp });

      const insertFeed = analytics.prepare(`INSERT INTO HomeFeedItems
        (ItemKey, LeagueId, FeedType, EventDate, Headline, Summary, MatchId,
         TeamId, PlayerId, RankScore, PublishedAt)
        VALUES (@ItemKey, @LeagueId, @FeedType, @EventDate, @Headline, @Summary,
          @MatchId, @TeamId, @PlayerId, @RankScore, @PublishedAt)`);
      const perLeague = new Map();
      for (const row of matches) {
        const count = perLeague.get(row.LeagueId) || 0;
        if (count >= 12) continue;
        perLeague.set(row.LeagueId, count + 1);
        insertFeed.run({ ItemKey: `match:${row.MatchId}`, LeagueId: row.LeagueId,
          FeedType: 'match_result', EventDate: row.PlayedDate,
          Headline: `${row.WinnerName} beat ${row.LoserName}`,
          Summary: row.Stage === 'g' ? 'Group stage match'
            : row.Stage === 'p' ? 'Playoff match'
              : row.Stage === 't' ? 'Tiebreaker match' : 'League match', MatchId: row.MatchId,
          TeamId: row.WinnerTeamId, PlayerId: null, RankScore: 1,
          PublishedAt: `${row.PlayedDate}T12:00:00.000Z` });
      }
      const bestWeeks = refreshLeague ? analytics.prepare(`SELECT LeagueId, WeekStart, PlayerId, PlayerName,
        Games, TotalKills FROM WeeklyPlayerStats w WHERE Games >= 2 AND
        PlayerId = (SELECT w2.PlayerId FROM WeeklyPlayerStats w2
          WHERE w2.LeagueId = w.LeagueId AND w2.WeekStart = w.WeekStart AND w2.Games >= 2
          ORDER BY w2.TotalKills DESC, w2.PlayerId LIMIT 1)`).all() : [];
      for (const row of bestWeeks) insertFeed.run({
        ItemKey: `weekly-kills:${row.LeagueId}:${row.WeekStart}`, LeagueId: row.LeagueId,
        FeedType: 'weekly_player', EventDate: row.WeekStart,
        Headline: `${row.PlayerName} led the week in kills`,
        Summary: `${row.TotalKills} kills in ${row.Games} games`, MatchId: null,
        TeamId: null, PlayerId: row.PlayerId, RankScore: 0.5,
        PublishedAt: `${row.WeekStart}T12:00:00.000Z`,
      });
    });
    apply();
    return { asOf: timestamp, scope, leaguePlayerRows: leagueStats.length,
      weeklyPlayerRows: weekly.length, recentPublicPlayerRows: publicStats.length,
      completedMatches: matches.length,
      feedItems: analytics.prepare('SELECT COUNT(*) AS n FROM HomeFeedItems').get().n,
      signupDataAvailable: lads ? tableExists(lads, 'LeagueSeasons') && tableExists(lads, 'SeasonTeamPlayers') : null };
  } finally {
    analytics?.close();
    publicDb?.close();
    lads?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flag = process.argv[2];
    const scope = flag === '--league' ? 'league' : flag === '--public' ? 'public' : 'all';
    const date = scope === 'all' ? flag : process.argv[3];
    console.log(JSON.stringify(refreshAnalytics({ scope, asOf: date || new Date().toISOString() }), null, 2));
  } catch (error) {
    console.error('Analytics refresh failed:', error);
    process.exitCode = 1;
  }
}
