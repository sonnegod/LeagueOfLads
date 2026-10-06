// Analytics.db is a derived store. Its private feature tables must never be
// serialized directly by public homepage or betting endpoints.
export function ensureAnalyticsSchema(db) {
  // SQLite does not enforce foreign keys unless this is enabled per connection.
  db.pragma('foreign_keys = ON');
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('Enable foreign keys before starting a transaction');
  }

  db.transaction(() => {
    const oldForecastTable = db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'MarketRecommendations'`).get();
    const newForecastTable = db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'ModelForecasts'`).get();
    if (oldForecastTable && newForecastTable) {
      throw new Error('Both old and new forecast tables exist; resolve the schema before continuing');
    }
    if (oldForecastTable) {
      db.exec(`ALTER TABLE MarketRecommendations RENAME TO ModelForecasts;
        ALTER TABLE ModelForecasts RENAME COLUMN RecommendationId TO ForecastId;
        DROP INDEX IF EXISTS idx_MarketRecommendations_Market;
        DROP TRIGGER IF EXISTS trg_MarketRecommendations_NoInsertAfterComplete;
        DROP TRIGGER IF EXISTS trg_MarketRecommendations_NoUpdateAfterComplete;
        DROP TRIGGER IF EXISTS trg_MarketRecommendations_NoDeleteAfterComplete;`);
    }
    db.exec(`
    CREATE TABLE IF NOT EXISTS AnalyticsRuns (
      RunId INTEGER PRIMARY KEY,
      RunKey TEXT NOT NULL UNIQUE CHECK (length(trim(RunKey)) > 0),
      SeasonId INTEGER NOT NULL CHECK (SeasonId > 0),
      CutoffAt TEXT NOT NULL,
      PublicDataCutoffAt TEXT,
      LeagueDataCutoffAt TEXT,
      PublicLookbackDays INTEGER NOT NULL DEFAULT 30 CHECK (PublicLookbackDays > 0),
      ModelVersion TEXT NOT NULL CHECK (length(trim(ModelVersion)) > 0),
      RosterFingerprint TEXT NOT NULL CHECK (length(trim(RosterFingerprint)) > 0),
      Status TEXT NOT NULL DEFAULT 'building'
        CHECK (Status IN ('building', 'complete', 'failed')),
      CreatedAt TEXT NOT NULL,
      CompletedAt TEXT,
      CHECK (Status <> 'complete' OR CompletedAt IS NOT NULL)
    );

    CREATE INDEX IF NOT EXISTS idx_AnalyticsRuns_SeasonStatus
      ON AnalyticsRuns (SeasonId, Status, CutoffAt DESC);

    CREATE TRIGGER IF NOT EXISTS trg_AnalyticsRuns_ImmutableMetadata
    BEFORE UPDATE OF RunKey, SeasonId, CutoffAt, PublicDataCutoffAt,
      LeagueDataCutoffAt, PublicLookbackDays, ModelVersion, RosterFingerprint, CreatedAt
    ON AnalyticsRuns
    BEGIN
      SELECT RAISE(ABORT, 'analytics run metadata is immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_AnalyticsRuns_CompletedImmutable
    BEFORE UPDATE ON AnalyticsRuns WHEN OLD.Status = 'complete'
    BEGIN
      SELECT RAISE(ABORT, 'completed analytics runs are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_AnalyticsRuns_NoDeleteCompleted
    BEFORE DELETE ON AnalyticsRuns WHEN OLD.Status = 'complete'
    BEGIN
      SELECT RAISE(ABORT, 'completed analytics runs cannot be deleted');
    END;

    CREATE TABLE IF NOT EXISTS PreseasonTeamFeatures (
      RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
      TeamSubmissionId INTEGER NOT NULL CHECK (TeamSubmissionId > 0),
      TeamName TEXT NOT NULL CHECK (length(trim(TeamName)) > 0),
      IsManual INTEGER NOT NULL CHECK (IsManual IN (0, 1)),
      RosterSize INTEGER NOT NULL CHECK (RosterSize BETWEEN 0 AND 5),
      MMRSource TEXT NOT NULL CHECK (MMRSource IN ('roster', 'manual')),
      AverageMMR REAL NOT NULL CHECK (AverageMMR > 0),
      MMRStdDev REAL CHECK (MMRStdDev >= 0),
      PriorLeagueGames INTEGER NOT NULL DEFAULT 0 CHECK (PriorLeagueGames >= 0),
      RecentPublicGames INTEGER NOT NULL DEFAULT 0 CHECK (RecentPublicGames >= 0),
      StrengthScore REAL,
      Confidence REAL NOT NULL CHECK (Confidence BETWEEN 0 AND 1),
      PRIMARY KEY (RunId, TeamSubmissionId),
      CHECK ((IsManual = 1 AND MMRSource = 'manual' AND RosterSize = 0)
        OR (IsManual = 0 AND MMRSource = 'roster' AND RosterSize > 0))
    );

    CREATE TABLE IF NOT EXISTS PreseasonPlayerFeatures (
      RunId INTEGER NOT NULL,
      TeamSubmissionId INTEGER NOT NULL,
      PlayerId INTEGER NOT NULL CHECK (PlayerId > 0),
      PlayerName TEXT,
      SignupMMR INTEGER NOT NULL CHECK (SignupMMR > 0),
      PriorLeagueGames INTEGER NOT NULL DEFAULT 0 CHECK (PriorLeagueGames >= 0),
      PriorLeagueWins INTEGER NOT NULL DEFAULT 0 CHECK (PriorLeagueWins >= 0),
      PriorLeagueAvgGPM REAL CHECK (PriorLeagueAvgGPM >= 0),
      PriorLeagueAvgLastHits REAL CHECK (PriorLeagueAvgLastHits >= 0),
      RecentPublicGames INTEGER NOT NULL DEFAULT 0 CHECK (RecentPublicGames >= 0),
      RecentPublicWins INTEGER NOT NULL DEFAULT 0 CHECK (RecentPublicWins >= 0),
      RecentPublicKills INTEGER NOT NULL DEFAULT 0 CHECK (RecentPublicKills >= 0),
      RecentPublicDeaths INTEGER NOT NULL DEFAULT 0 CHECK (RecentPublicDeaths >= 0),
      RecentPublicAssists INTEGER NOT NULL DEFAULT 0 CHECK (RecentPublicAssists >= 0),
      RecentPublicHeroCount INTEGER NOT NULL DEFAULT 0 CHECK (RecentPublicHeroCount >= 0),
      Confidence REAL NOT NULL CHECK (Confidence BETWEEN 0 AND 1),
      PRIMARY KEY (RunId, TeamSubmissionId, PlayerId),
      FOREIGN KEY (RunId, TeamSubmissionId)
        REFERENCES PreseasonTeamFeatures(RunId, TeamSubmissionId) ON DELETE CASCADE,
      CHECK (PriorLeagueWins <= PriorLeagueGames),
      CHECK (RecentPublicWins <= RecentPublicGames),
      CHECK (RecentPublicHeroCount <= RecentPublicGames)
    );

    CREATE INDEX IF NOT EXISTS idx_PreseasonPlayerFeatures_Player
      ON PreseasonPlayerFeatures (PlayerId, RunId);

    -- MarketKey includes the phase, e.g. regular:season_kills or playoffs:game_gpm.
    CREATE TABLE IF NOT EXISTS ModelForecasts (
      ForecastId INTEGER PRIMARY KEY,
      RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
      MarketKey TEXT NOT NULL CHECK (length(trim(MarketKey)) > 0),
      OutcomeKey TEXT NOT NULL CHECK (length(trim(OutcomeKey)) > 0),
      TeamSubmissionId INTEGER,
      LineValue REAL,
      FairProbability REAL NOT NULL CHECK (FairProbability > 0 AND FairProbability <= 1),
      SuggestedDecimalOdds REAL NOT NULL CHECK (SuggestedDecimalOdds >= 1),
      Confidence REAL NOT NULL CHECK (Confidence BETWEEN 0 AND 1),
      GeneratedAt TEXT NOT NULL,
      UNIQUE (RunId, MarketKey, OutcomeKey),
      FOREIGN KEY (RunId, TeamSubmissionId)
        REFERENCES PreseasonTeamFeatures(RunId, TeamSubmissionId)
    );

    CREATE INDEX IF NOT EXISTS idx_ModelForecasts_Market
      ON ModelForecasts (MarketKey, RunId);

    -- Historical-cohort model sandbox. These are never offered betting markets.
    CREATE TABLE IF NOT EXISTS SampleModelRuns (
      SampleRunId INTEGER PRIMARY KEY,
      RunKey TEXT NOT NULL UNIQUE,
      SourceLeagueId INTEGER NOT NULL CHECK (SourceLeagueId > 0),
      SourceLeagueName TEXT NOT NULL,
      AsOf TEXT NOT NULL,
      ModelVersion TEXT NOT NULL,
      MinimumLeagueGames INTEGER NOT NULL CHECK (MinimumLeagueGames > 0),
      MinimumPlayoffGames INTEGER CHECK (MinimumPlayoffGames > 0),
      Simulations INTEGER NOT NULL CHECK (Simulations > 0),
      EligiblePlayers INTEGER NOT NULL CHECK (EligiblePlayers > 0),
      Assumption TEXT NOT NULL,
      CreatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS SamplePlayerForecasts (
      SampleRunId INTEGER NOT NULL REFERENCES SampleModelRuns(SampleRunId),
      Phase TEXT NOT NULL DEFAULT 'overall'
        CHECK (Phase IN ('overall', 'regular', 'playoffs')),
      MetricKey TEXT NOT NULL,
      PlayerId INTEGER NOT NULL CHECK (PlayerId > 0),
      PlayerName TEXT NOT NULL,
      PriorLeagueGames INTEGER NOT NULL CHECK (PriorLeagueGames > 0),
      RecentPublicGames INTEGER NOT NULL CHECK (RecentPublicGames >= 0),
      ProjectedGames INTEGER NOT NULL CHECK (ProjectedGames > 0),
      LeaguePerGame REAL NOT NULL CHECK (LeaguePerGame >= 0),
      PublicPerGame REAL CHECK (PublicPerGame >= 0),
      ProjectedValue REAL NOT NULL CHECK (ProjectedValue >= 0),
      WinProbability REAL NOT NULL CHECK (WinProbability BETWEEN 0 AND 1),
      IllustrativeFairOdds REAL CHECK (IllustrativeFairOdds >= 1),
      Rank INTEGER NOT NULL CHECK (Rank > 0),
      PRIMARY KEY (SampleRunId, MetricKey, PlayerId)
    );
    CREATE INDEX IF NOT EXISTS idx_SamplePlayerForecasts_Leaders
      ON SamplePlayerForecasts (SampleRunId, MetricKey, Rank);

    CREATE TABLE IF NOT EXISTS PlayerLeagueStats (
      LeagueId INTEGER NOT NULL CHECK (LeagueId > 0),
      PlayerId INTEGER NOT NULL CHECK (PlayerId > 0),
      PlayerName TEXT NOT NULL,
      LastMatchDate TEXT,
      Games INTEGER NOT NULL CHECK (Games >= 0),
      Wins INTEGER NOT NULL CHECK (Wins BETWEEN 0 AND Games),
      TotalKills INTEGER NOT NULL CHECK (TotalKills >= 0),
      TotalDeaths INTEGER NOT NULL CHECK (TotalDeaths >= 0),
      TotalAssists INTEGER NOT NULL CHECK (TotalAssists >= 0),
      MaxKills INTEGER NOT NULL CHECK (MaxKills >= 0),
      MaxDeaths INTEGER NOT NULL CHECK (MaxDeaths >= 0),
      MaxAssists INTEGER NOT NULL CHECK (MaxAssists >= 0),
      AvgGPM REAL CHECK (AvgGPM >= 0),
      MaxGPM INTEGER CHECK (MaxGPM >= 0),
      AvgXPM REAL CHECK (AvgXPM >= 0),
      MaxXPM INTEGER CHECK (MaxXPM >= 0),
      AvgLastHits REAL CHECK (AvgLastHits >= 0),
      MaxLastHits INTEGER CHECK (MaxLastHits >= 0),
      AvgHeroDamage REAL CHECK (AvgHeroDamage >= 0),
      MaxHeroDamage INTEGER CHECK (MaxHeroDamage >= 0),
      DistinctHeroes INTEGER NOT NULL CHECK (DistinctHeroes >= 0),
      RefreshedAt TEXT NOT NULL,
      PRIMARY KEY (LeagueId, PlayerId)
    );
    CREATE INDEX IF NOT EXISTS idx_PlayerLeagueStats_LeagueKills
      ON PlayerLeagueStats (LeagueId, TotalKills DESC);

    -- Private betting-model input. Never query this table from homepage routes.
    CREATE TABLE IF NOT EXISTS PlayerRecentPublicStats (
      PlayerId INTEGER PRIMARY KEY CHECK (PlayerId > 0),
      PlayerName TEXT NOT NULL,
      AsOf TEXT NOT NULL,
      LookbackDays INTEGER NOT NULL CHECK (LookbackDays > 0),
      Games INTEGER NOT NULL CHECK (Games >= 0),
      Wins INTEGER NOT NULL CHECK (Wins BETWEEN 0 AND Games),
      TotalKills INTEGER NOT NULL CHECK (TotalKills >= 0),
      TotalDeaths INTEGER NOT NULL CHECK (TotalDeaths >= 0),
      TotalAssists INTEGER NOT NULL CHECK (TotalAssists >= 0),
      DistinctHeroes INTEGER NOT NULL CHECK (DistinctHeroes BETWEEN 0 AND Games),
      LastMatchAt TEXT,
      RefreshedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS WeeklyPlayerStats (
      LeagueId INTEGER NOT NULL CHECK (LeagueId > 0),
      WeekStart TEXT NOT NULL,
      PlayerId INTEGER NOT NULL CHECK (PlayerId > 0),
      PlayerName TEXT NOT NULL,
      Games INTEGER NOT NULL CHECK (Games > 0),
      Wins INTEGER NOT NULL CHECK (Wins BETWEEN 0 AND Games),
      TotalKills INTEGER NOT NULL CHECK (TotalKills >= 0),
      TotalDeaths INTEGER NOT NULL CHECK (TotalDeaths >= 0),
      TotalAssists INTEGER NOT NULL CHECK (TotalAssists >= 0),
      MaxKills INTEGER NOT NULL CHECK (MaxKills >= 0),
      MaxDeaths INTEGER NOT NULL CHECK (MaxDeaths >= 0),
      AvgGPM REAL CHECK (AvgGPM >= 0),
      RefreshedAt TEXT NOT NULL,
      PRIMARY KEY (LeagueId, WeekStart, PlayerId)
    );
    CREATE INDEX IF NOT EXISTS idx_WeeklyPlayerStats_LeagueWeek
      ON WeeklyPlayerStats (LeagueId, WeekStart DESC, TotalKills DESC);

    -- These two tables contain only public match/feed facts, never signup ratings.
    CREATE TABLE IF NOT EXISTS CompletedMatchFacts (
      MatchId INTEGER PRIMARY KEY CHECK (MatchId > 0),
      LeagueId INTEGER NOT NULL CHECK (LeagueId > 0),
      PlayedDate TEXT NOT NULL,
      RadiantTeamId INTEGER NOT NULL CHECK (RadiantTeamId > 0),
      DireTeamId INTEGER NOT NULL CHECK (DireTeamId > 0),
      WinnerTeamId INTEGER NOT NULL CHECK (WinnerTeamId > 0),
      Stage TEXT,
      PreMatchRadiantWinProbability REAL
        CHECK (PreMatchRadiantWinProbability BETWEEN 0 AND 1),
      RefreshedAt TEXT NOT NULL,
      CHECK (RadiantTeamId <> DireTeamId),
      CHECK (WinnerTeamId IN (RadiantTeamId, DireTeamId))
    );

    CREATE INDEX IF NOT EXISTS idx_CompletedMatchFacts_LeagueDate
      ON CompletedMatchFacts (LeagueId, PlayedDate DESC, MatchId DESC);

    CREATE TABLE IF NOT EXISTS HomeFeedItems (
      FeedItemId INTEGER PRIMARY KEY,
      ItemKey TEXT NOT NULL UNIQUE CHECK (length(trim(ItemKey)) > 0),
      LeagueId INTEGER NOT NULL CHECK (LeagueId > 0),
      FeedType TEXT NOT NULL CHECK (length(trim(FeedType)) > 0),
      EventDate TEXT NOT NULL,
      Headline TEXT NOT NULL CHECK (length(trim(Headline)) > 0),
      Summary TEXT,
      MatchId INTEGER REFERENCES CompletedMatchFacts(MatchId) ON DELETE SET NULL,
      TeamId INTEGER CHECK (TeamId > 0),
      PlayerId INTEGER CHECK (PlayerId > 0),
      RankScore REAL NOT NULL DEFAULT 0,
      PublishedAt TEXT NOT NULL,
      ExpiresAt TEXT,
      CHECK (ExpiresAt IS NULL OR ExpiresAt > PublishedAt)
    );

    CREATE INDEX IF NOT EXISTS idx_HomeFeedItems_LeaguePublished
      ON HomeFeedItems (LeagueId, PublishedAt DESC, RankScore DESC);
    `);

    // Older sample runs predate phase-specific markets; retain them as overall previews.
    if (!db.pragma('table_info(SamplePlayerForecasts)').some(column => column.name === 'Phase')) {
      db.exec(`ALTER TABLE SamplePlayerForecasts ADD COLUMN Phase TEXT NOT NULL DEFAULT 'overall'
        CHECK (Phase IN ('overall', 'regular', 'playoffs'))`);
    }
    if (!db.pragma('table_info(SampleModelRuns)').some(column => column.name === 'MinimumPlayoffGames')) {
      db.exec(`ALTER TABLE SampleModelRuns ADD COLUMN MinimumPlayoffGames INTEGER
        CHECK (MinimumPlayoffGames > 0)`);
    }
    if (!db.pragma('table_info(PreseasonPlayerFeatures)').some(column => column.name === 'PlayerName')) {
      db.exec('ALTER TABLE PreseasonPlayerFeatures ADD COLUMN PlayerName TEXT');
    }
    if (!db.pragma('table_info(ModelForecasts)').some(column => column.name === 'LineValue')) {
      db.exec('ALTER TABLE ModelForecasts ADD COLUMN LineValue REAL');
    }

    // A completed run is an audit snapshot. Recalculation creates a new RunKey.
    for (const table of [
      'PreseasonTeamFeatures', 'PreseasonPlayerFeatures', 'ModelForecasts',
    ]) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_${table}_NoInsertAfterComplete
        BEFORE INSERT ON ${table}
        WHEN (SELECT Status FROM AnalyticsRuns WHERE RunId = NEW.RunId) = 'complete'
        BEGIN
          SELECT RAISE(ABORT, 'completed analytics run data is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_${table}_NoUpdateAfterComplete
        BEFORE UPDATE ON ${table}
        WHEN (SELECT Status FROM AnalyticsRuns WHERE RunId = OLD.RunId) = 'complete'
          OR (SELECT Status FROM AnalyticsRuns WHERE RunId = NEW.RunId) = 'complete'
        BEGIN
          SELECT RAISE(ABORT, 'completed analytics run data is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_${table}_NoDeleteAfterComplete
        BEFORE DELETE ON ${table}
        WHEN (SELECT Status FROM AnalyticsRuns WHERE RunId = OLD.RunId) = 'complete'
        BEGIN
          SELECT RAISE(ABORT, 'completed analytics run data is immutable');
        END;
      `);
    }
  })();
}
