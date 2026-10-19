CREATE TABLE IF NOT EXISTS BettingSchema (Version INTEGER PRIMARY KEY, AppliedAtUtc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS BettingSeasons (SeasonId INTEGER PRIMARY KEY, LeagueName TEXT NOT NULL, Status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS BettingWallets (
  SeasonId INTEGER NOT NULL, UserId TEXT NOT NULL, BalanceCents INTEGER NOT NULL,
  PRIMARY KEY(SeasonId,UserId)
);
CREATE TABLE IF NOT EXISTS BettingLedger (
  LedgerId INTEGER PRIMARY KEY AUTOINCREMENT, SeasonId INTEGER NOT NULL, UserId TEXT NOT NULL,
  AmountCents INTEGER NOT NULL, Kind TEXT NOT NULL, IdempotencyKey TEXT NOT NULL UNIQUE,
  TicketId INTEGER, CreatedAtUtc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_BettingLedger_Account ON BettingLedger(SeasonId,UserId,LedgerId);
CREATE TABLE IF NOT EXISTS BettingInputSnapshots (
  SnapshotId INTEGER PRIMARY KEY AUTOINCREMENT, SeasonId INTEGER NOT NULL, AnalyticsRunId INTEGER NOT NULL,
  AsOfUtc TEXT NOT NULL, Digest TEXT NOT NULL UNIQUE, InputJson TEXT NOT NULL, CreatedAtUtc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS BettingForecasts (
  ForecastId INTEGER PRIMARY KEY AUTOINCREMENT, SnapshotId INTEGER NOT NULL, ModelVersion TEXT NOT NULL,
  Seed INTEGER NOT NULL, ValidationJson TEXT NOT NULL, ForecastJson TEXT NOT NULL, CreatedAtUtc TEXT NOT NULL,
  ForecastKey TEXT
);
CREATE TABLE IF NOT EXISTS BettingMarkets (
  MarketId INTEGER PRIMARY KEY AUTOINCREMENT, DefinitionKey TEXT NOT NULL UNIQUE, SeasonId INTEGER NOT NULL,
  EventId INTEGER, EventRevision INTEGER, Stage TEXT NOT NULL, MarketType TEXT NOT NULL,
  Scope TEXT, StatKey TEXT, PlayerId INTEGER, TeamKey INTEGER, Line REAL, GameNumber INTEGER,
  BestOf INTEGER, Title TEXT NOT NULL, RulesJson TEXT NOT NULL, RulesVersion INTEGER NOT NULL,
  ForecastId INTEGER NOT NULL, CloseAtUtc TEXT NOT NULL,
  Status TEXT NOT NULL CHECK(Status IN ('open','held','locked','settled','void')),
  QuoteVersion INTEGER NOT NULL DEFAULT 1, HoldReason TEXT, CreatedAtUtc TEXT NOT NULL, UpdatedAtUtc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_BettingMarkets_SeasonStatus ON BettingMarkets(SeasonId,Status,MarketId);
CREATE INDEX IF NOT EXISTS idx_BettingMarkets_Event ON BettingMarkets(EventId);
CREATE INDEX IF NOT EXISTS idx_BettingMarkets_Player ON BettingMarkets(SeasonId,MarketType,PlayerId,StatKey,Scope,MarketId);
CREATE TABLE IF NOT EXISTS BettingSelections (
  SelectionId INTEGER PRIMARY KEY AUTOINCREMENT, MarketId INTEGER NOT NULL REFERENCES BettingMarkets(MarketId),
  OutcomeKey TEXT NOT NULL, Label TEXT NOT NULL, Probability REAL NOT NULL,
  AnchorMicros INTEGER NOT NULL, OfferedMicros INTEGER NOT NULL, IsActive INTEGER NOT NULL DEFAULT 1,
  UNIQUE(MarketId,OutcomeKey)
);
CREATE TABLE IF NOT EXISTS BettingQuoteHistory (
  MarketId INTEGER NOT NULL, QuoteVersion INTEGER NOT NULL, QuotesJson TEXT NOT NULL, CreatedAtUtc TEXT NOT NULL,
  PRIMARY KEY(MarketId,QuoteVersion)
);
CREATE TABLE IF NOT EXISTS BettingTickets (
  TicketId INTEGER PRIMARY KEY AUTOINCREMENT, SeasonId INTEGER NOT NULL, UserId TEXT NOT NULL,
  StakeCents INTEGER NOT NULL CHECK(StakeCents > 0), RequestKey TEXT NOT NULL,
  Status TEXT NOT NULL DEFAULT 'pending', PayoutCents INTEGER NOT NULL DEFAULT 0, PlacedAtUtc TEXT NOT NULL,
  UNIQUE(UserId,RequestKey)
);
CREATE INDEX IF NOT EXISTS idx_BettingTickets_Account ON BettingTickets(SeasonId,UserId,TicketId);
CREATE TABLE IF NOT EXISTS BettingTicketLegs (
  TicketId INTEGER NOT NULL REFERENCES BettingTickets(TicketId), MarketId INTEGER NOT NULL,
  SelectionId INTEGER NOT NULL, OutcomeKey TEXT NOT NULL, QuoteVersion INTEGER NOT NULL,
  AcceptedMicros INTEGER NOT NULL, DefinitionJson TEXT NOT NULL,
  Result TEXT NOT NULL DEFAULT 'pending', Divisor INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(TicketId,MarketId)
);
CREATE INDEX IF NOT EXISTS idx_BettingTicketLegs_Market ON BettingTicketLegs(MarketId,TicketId);
CREATE TABLE IF NOT EXISTS BettingMarketSettlements (
  MarketId INTEGER NOT NULL, Revision INTEGER NOT NULL, Digest TEXT NOT NULL,
  OutcomesJson TEXT NOT NULL, EvidenceJson TEXT NOT NULL, CreatedAtUtc TEXT NOT NULL,
  PRIMARY KEY(MarketId,Revision)
);
CREATE TABLE IF NOT EXISTS BettingJobs (
  JobId INTEGER PRIMARY KEY AUTOINCREMENT, StartedAtUtc TEXT NOT NULL, CompletedAtUtc TEXT,
  Status TEXT NOT NULL, MarketsOpened INTEGER NOT NULL DEFAULT 0, MarketsSettled INTEGER NOT NULL DEFAULT 0,
  IssueCode TEXT
);
CREATE TABLE IF NOT EXISTS BettingWorkerLock (
  Id INTEGER PRIMARY KEY CHECK(Id=1), Owner TEXT NOT NULL, LeaseUntilUtc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS BettingLegacyImportIssues (
  LegacyTicketId INTEGER PRIMARY KEY, IssueCode TEXT NOT NULL, UpdatedAtUtc TEXT NOT NULL
);
-- Private daily observations preserve what Betting actually knew. They cannot
-- be backdated from today's rolling public summaries for historical validation.
CREATE TABLE IF NOT EXISTS BettingPrivateFeatureHistory (
  PlayerId INTEGER NOT NULL, ObservedDay TEXT NOT NULL, ObservedAtUtc TEXT NOT NULL,
  AsOfUtc TEXT NOT NULL, WindowStartUtc TEXT NOT NULL, SampleCount INTEGER NOT NULL,
  Wins INTEGER NOT NULL, QualityStatus TEXT NOT NULL, FeatureVersion INTEGER NOT NULL,
  PRIMARY KEY(PlayerId,ObservedDay)
);
CREATE INDEX IF NOT EXISTS idx_BettingPrivateFeatureHistory_Time ON BettingPrivateFeatureHistory(ObservedAtUtc);
