import { buildGroupResults } from './groupResults.js';

// Shared by scheduled standings updates and synchronous match corrections.
// A nested transaction keeps these derived rows atomic with an editor save.
export function rebuildLeagueGroupStandings(db, leagueId) {
  return db.transaction(() => {
    const groups = db.prepare('SELECT GroupId FROM GroupNames WHERE LeagueId=?').all(leagueId);
    if (!groups.length) return;
    const matches = db.prepare(`SELECT mt.TeamRad,mt.TeamDire,mt.WinnerId
      FROM MatchLeague ml JOIN MatchTeam mt ON mt.MatchId=ml.MatchId
      LEFT JOIN LeagueStageBoundaries b ON b.LeagueId=ml.LeagueId
      WHERE ml.LeagueId=? AND mt.WinnerId IN (mt.TeamRad,mt.TeamDire)
        AND (b.GroupEndMatchId IS NULL OR mt.MatchId<=b.GroupEndMatchId)`).all(leagueId);
    db.prepare('UPDATE LeagueStandings SET Wins=0,Losses=0 WHERE LeagueId=?').run(leagueId);
    db.prepare('UPDATE Neustadtl SET Score=0 WHERE LeagueId=?').run(leagueId);
    const standing = db.prepare(`INSERT INTO LeagueStandings(LeagueId,TeamId,Wins,Losses) VALUES(?,?,?,?)
      ON CONFLICT(LeagueId,TeamId) DO UPDATE SET Wins=excluded.Wins,Losses=excluded.Losses`);
    const neustadtl = db.prepare(`INSERT INTO Neustadtl(LeagueId,TeamId,Score) VALUES(?,?,?)
      ON CONFLICT(TeamId,LeagueId) DO UPDATE SET Score=excluded.Score`);
    const teams = db.prepare('SELECT TeamId FROM LeagueGroups WHERE LeagueId=? AND GroupId=?');
    const overrides = db.prepare(`SELECT TeamA,TeamB,WinsA,WinsB,BaseWinsA,BaseWinsB
      FROM GroupResultOverrides WHERE LeagueId=? AND GroupId=?`);
    for (const group of groups) {
      const result = buildGroupResults(teams.all(leagueId,group.GroupId),matches,overrides.all(leagueId,group.GroupId));
      for (const row of result.teams) {
        standing.run(leagueId,row.TeamId,row.Wins,row.Losses);
        neustadtl.run(leagueId,row.TeamId,row.Score);
      }
    }
  })();
}
