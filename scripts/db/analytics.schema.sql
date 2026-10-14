CREATE TABLE IF NOT EXISTS AnalyticsMigrations (
  Version INTEGER PRIMARY KEY, AppliedAtUtc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS AnalyticsRuns (
  RunId INTEGER PRIMARY KEY AUTOINCREMENT,
  StartedAtUtc TEXT NOT NULL, FinishedAtUtc TEXT, AsOfUtc TEXT NOT NULL,
  Version INTEGER NOT NULL, FirstSeasonId INTEGER,
  Status TEXT NOT NULL CHECK (Status IN ('running', 'complete', 'failed')),
  FailureCode TEXT, MatchCount INTEGER NOT NULL DEFAULT 0, PlayerGameCount INTEGER NOT NULL DEFAULT 0,
  IssueCount INTEGER NOT NULL DEFAULT 0, DurationMs INTEGER,
  PeakRssBytes INTEGER,
  Scope TEXT NOT NULL DEFAULT 'signup_era', SelectedSeasonId INTEGER, PreviewLeagueId INTEGER
);
CREATE TABLE IF NOT EXISTS AnalyticsState (
  Id INTEGER PRIMARY KEY CHECK (Id = 1), PublishedRunId INTEGER REFERENCES AnalyticsRuns(RunId)
);
INSERT OR IGNORE INTO AnalyticsState (Id) VALUES (1);
CREATE TABLE IF NOT EXISTS AnalyticsBuildLock (
  Id INTEGER PRIMARY KEY CHECK (Id = 1), Owner TEXT NOT NULL, LeaseUntilUtc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS SourceSnapshots (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SourceName TEXT NOT NULL, CapturedAtUtc TEXT NOT NULL, LastSuccessAtUtc TEXT,
  LastSourceRunId INTEGER, LatestStatus TEXT NOT NULL, IsStale INTEGER NOT NULL,
  PRIMARY KEY (RunId, SourceName)
);
CREATE TABLE IF NOT EXISTS DataQualityIssues (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  EntityType TEXT NOT NULL, EntityId TEXT NOT NULL, Code TEXT NOT NULL,
  PRIMARY KEY (RunId, EntityType, EntityId, Code)
);
CREATE TABLE IF NOT EXISTS SeasonFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, LeagueId INTEGER, LeagueName TEXT NOT NULL, Status TEXT NOT NULL,
  RulesJson TEXT, GroupEndMatchId INTEGER, TiebreakerEndMatchId INTEGER,
  PRIMARY KEY (RunId, SeasonId)
);
CREATE TABLE IF NOT EXISTS TeamFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  TeamSubmissionId INTEGER NOT NULL, SeasonId INTEGER NOT NULL, TeamId INTEGER,
  TeamName TEXT NOT NULL, GroupId INTEGER, IsManual INTEGER NOT NULL,
  PRIMARY KEY (RunId, TeamSubmissionId)
);
CREATE TABLE IF NOT EXISTS PlayerFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  PlayerId INTEGER NOT NULL, PlayerName TEXT NOT NULL,
  PRIMARY KEY (RunId, PlayerId)
);
CREATE TABLE IF NOT EXISTS RosterMembership (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  TeamSubmissionId INTEGER NOT NULL, PlayerId INTEGER NOT NULL, Slot INTEGER NOT NULL,
  EffectiveFromUtc TEXT, EffectiveToUtc TEXT, FromEstimated INTEGER NOT NULL,
  MembershipSource TEXT NOT NULL CHECK (MembershipSource IN ('finalized', 'submission')),
  PRIMARY KEY (RunId, TeamSubmissionId, PlayerId)
);
CREATE TABLE IF NOT EXISTS MatchFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, SeasonId INTEGER NOT NULL, LeagueId INTEGER NOT NULL,
  SeriesId INTEGER, Stage TEXT NOT NULL CHECK (Stage IN ('regular', 'tiebreaker', 'playoff', 'unknown')),
  StartedAtUtc TEXT, RecordedDate TEXT, TimeSource TEXT NOT NULL,
  DurationSeconds INTEGER NOT NULL, WinnerTeamId INTEGER NOT NULL, SourceObservedAtUtc TEXT,
  PRIMARY KEY (RunId, MatchId)
);
CREATE INDEX IF NOT EXISTS idx_AnalyticsSeasonMatches ON MatchFacts(RunId, SeasonId, Stage, MatchId);
CREATE TABLE IF NOT EXISTS TeamGameFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL, OpponentSubmissionId INTEGER NOT NULL,
  TeamId INTEGER NOT NULL, Won INTEGER NOT NULL CHECK (Won IN (0, 1)), Side TEXT NOT NULL,
  PRIMARY KEY (RunId, MatchId, TeamSubmissionId),
  FOREIGN KEY (RunId, MatchId) REFERENCES MatchFacts(RunId, MatchId) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_AnalyticsTeamGames ON TeamGameFacts(RunId, TeamSubmissionId, MatchId);
CREATE TABLE IF NOT EXISTS PlayerGameFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, PlayerId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL,
  HeroId INTEGER NOT NULL, Won INTEGER NOT NULL,
  Membership TEXT NOT NULL CHECK (Membership IN ('rostered', 'stand_in', 'unknown')),
  Kills INTEGER, Deaths INTEGER, Assists INTEGER, LastHits INTEGER,
  GPM REAL, XPM REAL, NetWorth REAL, HeroDamage REAL, TowerDamage REAL, Healing REAL,
  PRIMARY KEY (RunId, MatchId, PlayerId),
  FOREIGN KEY (RunId, MatchId) REFERENCES MatchFacts(RunId, MatchId) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_AnalyticsPlayerGames ON PlayerGameFacts(RunId, PlayerId, TeamSubmissionId, Membership);
CREATE TABLE IF NOT EXISTS RosterMembershipIntervals (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  TeamSubmissionId INTEGER NOT NULL,PlayerId INTEGER NOT NULL,Slot INTEGER NOT NULL,
  EffectiveFromUtc TEXT NOT NULL,EffectiveToUtc TEXT,FromEstimated INTEGER NOT NULL,
  PRIMARY KEY(RunId,TeamSubmissionId,PlayerId,EffectiveFromUtc)
);
CREATE TABLE IF NOT EXISTS PlayerTeamSeasonStats (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL, PlayerId INTEGER NOT NULL,
  Stage TEXT NOT NULL, Membership TEXT NOT NULL, GamesPlayed INTEGER NOT NULL, Wins INTEGER NOT NULL,
  TeamGames INTEGER NOT NULL, MarketEligible INTEGER NOT NULL,
  PRIMARY KEY (RunId, SeasonId, TeamSubmissionId, PlayerId, Stage, Membership)
);
CREATE TABLE IF NOT EXISTS PlayerMetricStats (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL, PlayerId INTEGER NOT NULL,
  Stage TEXT NOT NULL, Membership TEXT NOT NULL, Metric TEXT NOT NULL,
  Samples INTEGER NOT NULL, Total REAL, Average REAL, Minimum REAL, Maximum REAL, Variance REAL,
  RecentSamples INTEGER NOT NULL, RecentAverage REAL,
  PRIMARY KEY (RunId, SeasonId, TeamSubmissionId, PlayerId, Stage, Membership, Metric)
);
CREATE TABLE IF NOT EXISTS TeamSeasonStats (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL, Stage TEXT NOT NULL,
  GamesPlayed INTEGER NOT NULL, Wins INTEGER NOT NULL, Losses INTEGER NOT NULL,
  PRIMARY KEY (RunId, SeasonId, TeamSubmissionId, Stage)
);
CREATE TABLE IF NOT EXISTS PrivatePlayerFeatures (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  PlayerId INTEGER NOT NULL, WindowStartUtc TEXT NOT NULL, AsOfUtc TEXT NOT NULL,
  SampleCount INTEGER NOT NULL, Wins INTEGER NOT NULL,
  AverageKills REAL, AverageDeaths REAL, AverageAssists REAL,
  FeatureVersion INTEGER NOT NULL, QualityStatus TEXT NOT NULL,
  PRIMARY KEY (RunId, PlayerId)
);
CREATE TABLE IF NOT EXISTS MetricDefinitions (
  Metric TEXT PRIMARY KEY, Version INTEGER NOT NULL, Unit TEXT NOT NULL,
  AllowsSeasonTotal INTEGER NOT NULL, AllowsSeasonAverage INTEGER NOT NULL,
  Definition TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS PrivateRosterInputs (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  TeamSubmissionId INTEGER NOT NULL, PlayerId INTEGER NOT NULL,
  SignupMMR REAL, InputSource TEXT NOT NULL,
  PRIMARY KEY (RunId, TeamSubmissionId, PlayerId)
);
CREATE TABLE IF NOT EXISTS PrivateTeamFeatures (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  TeamSubmissionId INTEGER NOT NULL, SeasonId INTEGER NOT NULL,
  AverageSignupMMR REAL, RosterSamples INTEGER NOT NULL,
  FeatureVersion INTEGER NOT NULL, QualityStatus TEXT NOT NULL,
  PRIMARY KEY (RunId, TeamSubmissionId)
);

-- Content survives fact-generation retention. Run references are provenance,
-- deliberately not cascading foreign keys to the two retained generations.
CREATE TABLE IF NOT EXISTS HeroFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  HeroId INTEGER NOT NULL, HeroName TEXT NOT NULL,
  PRIMARY KEY (RunId, HeroId)
);
CREATE TABLE IF NOT EXISTS ChampionFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL,
  PRIMARY KEY (RunId, SeasonId)
);
CREATE TABLE IF NOT EXISTS GroupFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, GroupId INTEGER NOT NULL, GroupName TEXT NOT NULL,
  PRIMARY KEY (RunId, SeasonId, GroupId)
);
CREATE TABLE IF NOT EXISTS SeriesFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeriesId INTEGER NOT NULL, SeasonId INTEGER NOT NULL, Team1Id INTEGER NOT NULL, Team2Id INTEGER NOT NULL,
  BestOf INTEGER CHECK (BestOf IN (3, 5)), RoundLabel TEXT, SourceMatchCount INTEGER NOT NULL,
  PRIMARY KEY (RunId, SeriesId)
);
CREATE TABLE IF NOT EXISTS HighlightSettings (
  Id INTEGER PRIMARY KEY CHECK (Id = 1), Paused INTEGER NOT NULL DEFAULT 0 CHECK (Paused IN (0, 1)),
  UpdatedAtUtc TEXT, UpdatedBy TEXT
);
INSERT OR IGNORE INTO HighlightSettings (Id) VALUES (1);
CREATE TABLE IF NOT EXISTS HighlightMatchHistory (
  SeasonId INTEGER NOT NULL, MatchId INTEGER NOT NULL, FirstSeenAtUtc TEXT NOT NULL,
  PRIMARY KEY (SeasonId, MatchId)
);
CREATE TABLE IF NOT EXISTS HighlightEvents (
  HighlightId INTEGER PRIMARY KEY AUTOINCREMENT, Fingerprint TEXT NOT NULL UNIQUE,
  SeasonId INTEGER NOT NULL, LeagueId INTEGER NOT NULL, LeagueName TEXT NOT NULL,
  Category TEXT NOT NULL, Period TEXT NOT NULL, Stage TEXT NOT NULL,
  SubjectKey TEXT NOT NULL, TeamSubmissionId INTEGER, PlayerId INTEGER,
  Title TEXT NOT NULL, Body TEXT NOT NULL, EvidenceJson TEXT NOT NULL,
  Score REAL NOT NULL, OccurredAtUtc TEXT, EligibleAtUtc TEXT NOT NULL,
  GeneratedRunId INTEGER NOT NULL, SourceHash TEXT NOT NULL, Revision INTEGER NOT NULL DEFAULT 1,
  Status TEXT NOT NULL CHECK (Status IN ('candidate', 'published', 'withdrawn')),
  FirstPublishedAtUtc TEXT, PublishedDayLocal TEXT, UpdatedAtUtc TEXT NOT NULL,
  Hidden INTEGER NOT NULL DEFAULT 0 CHECK (Hidden IN (0, 1)), TitleOverride TEXT, BodyOverride TEXT,
  OverrideNeedsReview INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_HighlightFeed ON HighlightEvents(Status, Hidden, HighlightId DESC);
CREATE INDEX IF NOT EXISTS idx_HighlightSeason ON HighlightEvents(SeasonId, Status);
CREATE INDEX IF NOT EXISTS idx_HighlightDailyQuota ON HighlightEvents(PublishedDayLocal, Period);
CREATE TABLE IF NOT EXISTS HighlightRevisions (
  RevisionId INTEGER PRIMARY KEY AUTOINCREMENT, HighlightId INTEGER NOT NULL REFERENCES HighlightEvents(HighlightId),
  Revision INTEGER NOT NULL, RunId INTEGER, ChangedAtUtc TEXT NOT NULL, Reason TEXT NOT NULL,
  Title TEXT NOT NULL, Body TEXT NOT NULL, EvidenceJson TEXT NOT NULL, Status TEXT NOT NULL,
  Hidden INTEGER NOT NULL, ActorId TEXT,
  UNIQUE (HighlightId, Revision)
);
