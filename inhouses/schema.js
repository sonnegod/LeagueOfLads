export function ensureInhouseSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS InhouseSettings (
      Id INTEGER PRIMARY KEY CHECK(Id=1), LeagueId INTEGER,
      QueueMode TEXT NOT NULL DEFAULT 'fifo' CHECK(QueueMode IN ('fifo','preference')),
      DraftMode TEXT NOT NULL DEFAULT 'captain' CHECK(DraftMode IN ('captain','automatic')),
      LaunchMinutes INTEGER NOT NULL DEFAULT 15 CHECK(LaunchMinutes BETWEEN 1 AND 120),
      Version INTEGER NOT NULL DEFAULT 1
    );
    INSERT OR IGNORE INTO InhouseSettings(Id) VALUES(1);
    CREATE TABLE IF NOT EXISTS InhouseMeta (
      Id INTEGER PRIMARY KEY CHECK(Id=1), Revision INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO InhouseMeta(Id) VALUES(1);
    CREATE TABLE IF NOT EXISTS InhousePlayers (
      PlayerId INTEGER PRIMARY KEY, Name TEXT NOT NULL, RolesJson TEXT NOT NULL DEFAULT '[]',
      OffRole INTEGER NOT NULL DEFAULT 1 CHECK(OffRole IN (0,1)),
      Rating REAL NOT NULL DEFAULT 1000, Games INTEGER NOT NULL DEFAULT 0,
      Wins INTEGER NOT NULL DEFAULT 0, Losses INTEGER NOT NULL DEFAULT 0,
      PreferencesPromptedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS InhouseGames (
      InhouseId INTEGER PRIMARY KEY, Status TEXT NOT NULL CHECK(Status IN ('ready','drafting','awaiting_game','playing','completed','cancelled')),
      LeagueId INTEGER NOT NULL, QueueMode TEXT NOT NULL, DraftMode TEXT NOT NULL,
      LaunchMinutes INTEGER NOT NULL, CreatedAt INTEGER NOT NULL, Deadline INTEGER,
      Turn INTEGER NOT NULL DEFAULT 0, CaptainA INTEGER, CaptainB INTEGER,
      MatchId INTEGER UNIQUE, RadiantSide TEXT CHECK(RadiantSide IN ('A','B')),
      Winner TEXT CHECK(Winner IN ('A','B')), FormedAt INTEGER, StartedAt INTEGER, CompletedAt INTEGER,
      CancelReason TEXT
    );
    CREATE TABLE IF NOT EXISTS InhouseMembers (
      InhouseId INTEGER NOT NULL REFERENCES InhouseGames(InhouseId), PlayerId INTEGER NOT NULL REFERENCES InhousePlayers(PlayerId),
      JoinedAt INTEGER NOT NULL, RolesJson TEXT NOT NULL, OffRole INTEGER NOT NULL,
      RatingAtDraft REAL NOT NULL, GamesAtDraft INTEGER NOT NULL, Ready INTEGER NOT NULL DEFAULT 0,
      Side TEXT CHECK(Side IN ('A','B')), Position INTEGER, PickNumber INTEGER,
      RatingBefore REAL, RatingAfter REAL, RatingDelta REAL, Expected REAL, K INTEGER,
      PRIMARY KEY(InhouseId,PlayerId)
    );
    CREATE TABLE IF NOT EXISTS InhouseQueue (
      PlayerId INTEGER PRIMARY KEY REFERENCES InhousePlayers(PlayerId), JoinedAt INTEGER NOT NULL,
      InhouseId INTEGER REFERENCES InhouseGames(InhouseId)
    );
    CREATE INDEX IF NOT EXISTS idx_InhouseQueue_Order ON InhouseQueue(InhouseId,JoinedAt,PlayerId);
    CREATE INDEX IF NOT EXISTS idx_InhouseGames_Status ON InhouseGames(Status,InhouseId);
    CREATE TABLE IF NOT EXISTS InhouseChat (
      MessageId INTEGER PRIMARY KEY, InhouseId INTEGER NOT NULL REFERENCES InhouseGames(InhouseId),
      PlayerId INTEGER NOT NULL REFERENCES InhousePlayers(PlayerId), PlayerName TEXT NOT NULL,
      Body TEXT NOT NULL, SentAt INTEGER NOT NULL, ClientId TEXT NOT NULL,
      UNIQUE(InhouseId,PlayerId,ClientId)
    );
    CREATE INDEX IF NOT EXISTS idx_InhouseChat_Game_Message ON InhouseChat(InhouseId,MessageId);
    CREATE INDEX IF NOT EXISTS idx_InhouseChat_Player_Time ON InhouseChat(InhouseId,PlayerId,SentAt);
    CREATE TABLE IF NOT EXISTS InhouseAudit (
      AuditId INTEGER PRIMARY KEY, At INTEGER NOT NULL, ActorId INTEGER,
      InhouseId INTEGER, Action TEXT NOT NULL, DetailsJson TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS InhouseWorker (
      Id INTEGER PRIMARY KEY CHECK(Id=1), Owner TEXT, LeaseUntil INTEGER NOT NULL DEFAULT 0,
      LastTick INTEGER, LastSuccess INTEGER, LastError TEXT
    );
    INSERT OR IGNORE INTO InhouseWorker(Id) VALUES(1);
  `);
  db.transaction(() => {
    if (!db.pragma('table_info(InhousePlayers)').some(column => column.name === 'PreferencesPromptedAt')) {
      db.exec('ALTER TABLE InhousePlayers ADD COLUMN PreferencesPromptedAt INTEGER');
    }
  }).immediate();
}
