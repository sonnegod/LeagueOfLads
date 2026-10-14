// Shared by ingestion jobs, not imported by browser code. Never records raw API bodies.
export function ensureSourceMetadata(db) {
  if (!db.inTransaction && db.name !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS SourceLoadRuns (
    SourceRunId INTEGER PRIMARY KEY AUTOINCREMENT,
    SourceName TEXT NOT NULL,
    StartedAtUtc TEXT NOT NULL,
    FinishedAtUtc TEXT,
    Status TEXT NOT NULL CHECK (Status IN ('running', 'complete', 'partial', 'failed')),
    RecordsSeen INTEGER NOT NULL DEFAULT 0,
    FailedItems INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_SourceLoadRuns_Source ON SourceLoadRuns(SourceName, SourceRunId DESC);`);
  for (const [table, index, columns] of [
    ['MatchLeague', 'idx_AnalyticsSource_LeagueMatches', 'LeagueId, MatchId'],
    ['MatchPlayer', 'idx_AnalyticsSource_PlayerGames', 'MatchId, PlayerId'],
    ['MatchTeamPlayer', 'idx_AnalyticsSource_PlayerTeams', 'MatchId, PlayerId'],
    ['SeriesMatch', 'idx_AnalyticsSource_SeriesLinks', 'MatchId'],
  ]) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index} ON ${table}(${columns});`);
    }
  }
}

export function startSourceLoad(db, sourceName, at = new Date().toISOString()) {
  ensureSourceMetadata(db);
  return Number(db.prepare(`INSERT INTO SourceLoadRuns (SourceName, StartedAtUtc, Status)
    VALUES (?, ?, 'running')`).run(sourceName, at).lastInsertRowid);
}

export function finishSourceLoad(db, runId, { records = 0, failures = 0, failed = false,
  at = new Date().toISOString() } = {}) {
  db.prepare(`UPDATE SourceLoadRuns SET FinishedAtUtc = ?, Status = ?, RecordsSeen = ?, FailedItems = ?
    WHERE SourceRunId = ? AND Status = 'running'`).run(at,
    failed ? 'failed' : failures ? 'partial' : 'complete', records, failures, runId);
}

export function ensureMatchSourceDetails(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS MatchSourceDetails (
    MatchId INTEGER PRIMARY KEY,
    StartedAtUtc TEXT NOT NULL,
    ObservedAtUtc TEXT NOT NULL,
    Source TEXT NOT NULL
  );`);
}

export function recordMatchStart(db, matchId, epochSeconds, source, observedAt = new Date().toISOString()) {
  const seconds = Number(epochSeconds);
  if (epochSeconds === null || epochSeconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return false;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return false;
  ensureMatchSourceDetails(db);
  const startedAt = date.toISOString();
  db.prepare(`INSERT INTO MatchSourceDetails (MatchId, StartedAtUtc, ObservedAtUtc, Source)
    VALUES (?, ?, ?, ?) ON CONFLICT(MatchId) DO UPDATE SET
    StartedAtUtc = excluded.StartedAtUtc, ObservedAtUtc = excluded.ObservedAtUtc, Source = excluded.Source`)
    .run(matchId, startedAt, observedAt, source);
  db.prepare('UPDATE MatchLeague SET DatePlayed = ? WHERE MatchId = ?').run(startedAt, matchId);
  return true;
}

export function ensurePublicAvailability(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS PublicMatchAvailability (
    MatchId INTEGER NOT NULL, PlayerId INTEGER NOT NULL, FirstObservedAtUtc TEXT NOT NULL,
    PRIMARY KEY (MatchId, PlayerId)
  );`);
}
