import Database from 'better-sqlite3';

export function readLeagueCatalog(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT li.LeagueId AS leagueId, li.LeagueName AS leagueName,
      li.Active AS active, COUNT(ml.MatchId) AS matches
      FROM LeagueInfo li LEFT JOIN MatchLeague ml ON ml.LeagueId = li.LeagueId
      GROUP BY li.LeagueId ORDER BY li.LeagueId DESC`).all();
  } finally { db.close(); }
}
