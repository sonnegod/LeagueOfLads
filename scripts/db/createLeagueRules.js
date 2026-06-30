import Database from 'better-sqlite3';

const paths = process.argv.slice(2);
if (!paths.length) paths.push('./db/LadsData.db');

for (const path of paths) {
  const db = new Database(path);
  db.prepare(`CREATE TABLE IF NOT EXISTS LeagueRules (
    LeagueId INTEGER PRIMARY KEY,
    UpperBracketTeams INTEGER NOT NULL,
    LowerBracketTeams INTEGER NOT NULL,
    EliminatedTeams INTEGER NOT NULL,
    HasTiebreaker INTEGER NOT NULL DEFAULT 0,
    TiebreakerPosition INTEGER,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  db.close();
  console.log(`Ensured LeagueRules in ${path}`);
}
