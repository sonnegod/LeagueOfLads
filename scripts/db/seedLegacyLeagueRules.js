import Database from 'better-sqlite3';

const paths = process.argv.slice(2);
if (!paths.length) paths.push('./db/LadsData.db');
const leagueIds = [19264, 18664];

for (const path of paths) {
  const db = new Database(path);
  const insert = db.prepare(`INSERT INTO LeagueRules
    (LeagueId, UpperBracketTeams, LowerBracketTeams, EliminatedTeams, HasTiebreaker, TiebreakerPosition)
    VALUES (?, 2, 5, 2, 1, 3)
    ON CONFLICT(LeagueId) DO NOTHING`);
  const seed = db.transaction(() => leagueIds.forEach((leagueId) => insert.run(leagueId)));
  seed();
  db.close();
  console.log(`Seeded legacy rules in ${path}`);
}
