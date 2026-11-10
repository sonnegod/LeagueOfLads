const initialized=new WeakSet();
export function ensureMatchResultsSchema(db) {
  if(initialized.has(db))return;
  db.exec(`CREATE TABLE IF NOT EXISTS MatchResultsSettings (
    Id INTEGER PRIMARY KEY CHECK(Id=1),Enabled INTEGER NOT NULL DEFAULT 0,
    PlayoffBestOf INTEGER NOT NULL DEFAULT 3,GrandFinalBestOf INTEGER,
    Revision INTEGER NOT NULL DEFAULT 1);
    INSERT OR IGNORE INTO MatchResultsSettings(Id) VALUES(1);
    CREATE TABLE IF NOT EXISTS TrackedLeagueMatches (
      MatchId INTEGER PRIMARY KEY,LeagueId INTEGER NOT NULL,SeriesId INTEGER,EventId INTEGER,Stage TEXT NOT NULL,
      TeamRad INTEGER,TeamDire INTEGER,FirstSeenAt TEXT NOT NULL,LastSeenAt TEXT NOT NULL,
      MissingSince TEXT,StartedAt TEXT,ResultStatus TEXT NOT NULL DEFAULT 'live',
      EnrichmentStatus TEXT NOT NULL DEFAULT 'pending',AttemptCount INTEGER NOT NULL DEFAULT 0,
      NextAttemptAt TEXT,LeaseOwner TEXT,LeaseUntil TEXT,LastAttemptAt TEXT,LastError TEXT,
      ParseJobId TEXT,ParseRequestedAt TEXT,ImportedAt TEXT,ManualRequested INTEGER NOT NULL DEFAULT 0,
      WorkerEligible INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_TrackedLeagueMatches_Due ON TrackedLeagueMatches(ResultStatus,NextAttemptAt);
    CREATE TABLE IF NOT EXISTS SeriesLifecycle (
      SeriesId INTEGER PRIMARY KEY,EventId INTEGER UNIQUE,BestOf INTEGER,FormatSource TEXT NOT NULL,BracketMatchId TEXT,
      Status TEXT NOT NULL DEFAULT 'in_progress',Team1Wins INTEGER NOT NULL DEFAULT 0,Team2Wins INTEGER NOT NULL DEFAULT 0,
      UpdatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS MatchResultsState (
      Id INTEGER PRIMARY KEY CHECK(Id=1),Revision INTEGER NOT NULL DEFAULT 0,
      DerivedRevision INTEGER NOT NULL DEFAULT 0,LastTickAt TEXT,LastSuccessAt TEXT,LastError TEXT);
    INSERT OR IGNORE INTO MatchResultsState(Id) VALUES(1);
    CREATE TABLE IF NOT EXISTS MatchResultsRunLock (
      Id INTEGER PRIMARY KEY CHECK(Id=1),Owner TEXT,Mode TEXT,LeaseUntil TEXT,RequestedBy TEXT,RequestUntil TEXT);
    INSERT OR IGNORE INTO MatchResultsRunLock(Id) VALUES(1);`);
  if(!db.pragma('table_info(TrackedLeagueMatches)').some(column=>column.name==='WorkerEligible')) {
    db.exec("ALTER TABLE TrackedLeagueMatches ADD COLUMN WorkerEligible INTEGER NOT NULL DEFAULT 0;UPDATE TrackedLeagueMatches SET WorkerEligible=1 WHERE ResultStatus='live'");
  }
  initialized.add(db);
}
export const hasTable=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
export function resultsChanged(db) {
  db.prepare('UPDATE MatchResultsState SET Revision=Revision+1 WHERE Id=1').run();
}
