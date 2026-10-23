export function ensureRequestSchema(db) {
  db.transaction(()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS Comments (
      ProblemId INTEGER PRIMARY KEY AUTOINCREMENT,UserId INTEGER,Comment VARCHAR(128),CreatedAtUtc TEXT
    )`);
    if(!db.pragma('table_info(Comments)').some(column=>column.name==='CreatedAtUtc'))
      db.exec('ALTER TABLE Comments ADD COLUMN CreatedAtUtc TEXT');
    // Earlier requests never recorded their submission time; keep it unknown.
  })();
}

export function readRequests(db) {
  return db.prepare(`SELECT c.ProblemId,c.UserId,
    COALESCE(CAST(pi.PlayerName AS TEXT),'Unknown player') AS PlayerName,c.Comment,c.CreatedAtUtc
    FROM Comments c LEFT JOIN PlayerInfo pi ON pi.PlayerId=c.UserId ORDER BY c.ProblemId DESC`).all();
}

export function recordRequest(db,userId,comment,at=new Date().toISOString()) {
  return db.prepare('INSERT INTO Comments(UserId,Comment,CreatedAtUtc) VALUES(?,?,?)').run(userId,comment,at);
}
