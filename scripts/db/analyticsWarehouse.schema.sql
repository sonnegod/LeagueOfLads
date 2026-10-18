-- Derived EDW features. Raw timelines, events and compressed responses stay in LadsData.
-- Separate tables keep the existing Betting fact contract compatible across migration.
CREATE TABLE IF NOT EXISTS MatchContextFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, PatchId INTEGER, PatchKey TEXT,
  RadiantScore INTEGER, DireScore INTEGER, FirstBloodTime INTEGER,
  EnrichmentStatus TEXT NOT NULL, SourceObservedAtUtc TEXT, SectionsJson TEXT NOT NULL,
  FeatureVersion INTEGER NOT NULL,
  PRIMARY KEY(RunId,MatchId),
  FOREIGN KEY(RunId,MatchId) REFERENCES MatchFacts(RunId,MatchId) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS PlayerPerformanceFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, PlayerId INTEGER NOT NULL,
  LaneRole INTEGER, IsRoaming INTEGER, FinalLevel INTEGER, Denies INTEGER,
  ObserversPlaced INTEGER, SentriesPlaced INTEGER, ObserversKilled INTEGER, SentriesKilled INTEGER,
  CampsStacked INTEGER, StunSeconds REAL, NeutralKills INTEGER, AncientKills INTEGER,
  TowerKills INTEGER, RoshanKills INTEGER, CourierKills INTEGER,
  DewardsPer10Minutes REAL, DamageShare REAL, HealingShare REAL, NetWorthShare REAL,
  KillParticipation REAL,
  PRIMARY KEY(RunId,MatchId,PlayerId),
  FOREIGN KEY(RunId,MatchId,PlayerId) REFERENCES PlayerGameFacts(RunId,MatchId,PlayerId) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS PlayerEconomyCheckpoints (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, PlayerId INTEGER NOT NULL, Minute INTEGER NOT NULL,
  GoldEarned INTEGER, Experience INTEGER, LastHits INTEGER,
  PRIMARY KEY(RunId,MatchId,PlayerId,Minute),
  FOREIGN KEY(RunId,MatchId,PlayerId) REFERENCES PlayerGameFacts(RunId,MatchId,PlayerId) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS TeamEconomyCheckpoints (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL, Minute INTEGER NOT NULL,
  GoldAdvantage INTEGER, XpAdvantage INTEGER, GoldEarned INTEGER, Experience INTEGER, LastHits INTEGER,
  PRIMARY KEY(RunId,MatchId,TeamSubmissionId,Minute),
  FOREIGN KEY(RunId,MatchId,TeamSubmissionId) REFERENCES TeamGameFacts(RunId,MatchId,TeamSubmissionId) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS TeamPerformanceFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL,
  GoldSamples INTEGER NOT NULL, XpSamples INTEGER NOT NULL, GoldTimelineComplete INTEGER NOT NULL,
  MaximumGoldLead INTEGER, MaximumGoldDeficit INTEGER,
  Comeback10k INTEGER, Lost10kLead INTEGER,
  ObjectivesAvailable INTEGER NOT NULL, Towers INTEGER, Barracks INTEGER, Roshans INTEGER,
  FirstTower INTEGER, FirstRoshan INTEGER,
  TeamfightsAvailable INTEGER NOT NULL, RecordedFights INTEGER, KnownFights INTEGER,
  FightsWon INTEGER, FightsLost INTEGER, FightsDrawn INTEGER,
  PRIMARY KEY(RunId,MatchId,TeamSubmissionId),
  FOREIGN KEY(RunId,MatchId,TeamSubmissionId) REFERENCES TeamGameFacts(RunId,MatchId,TeamSubmissionId) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS TeamfightFacts (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, FightIndex INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL,
  StartSeconds INTEGER NOT NULL, EndSeconds INTEGER NOT NULL,
  Kills INTEGER, Deaths INTEGER, Damage INTEGER, GoldDelta INTEGER, XpDelta INTEGER, Buybacks INTEGER,
  Outcome TEXT NOT NULL CHECK(Outcome IN ('win','loss','draw','unknown')),
  TowersAfter INTEGER, RoshansAfter INTEGER, BarracksAfter INTEGER,
  PRIMARY KEY(RunId,MatchId,FightIndex,TeamSubmissionId),
  FOREIGN KEY(RunId,MatchId,TeamSubmissionId) REFERENCES TeamGameFacts(RunId,MatchId,TeamSubmissionId) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS PlayerItemTimings (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  MatchId INTEGER NOT NULL, PlayerId INTEGER NOT NULL, ItemKey TEXT NOT NULL, FirstPurchaseSeconds INTEGER NOT NULL,
  PRIMARY KEY(RunId,MatchId,PlayerId,ItemKey),
  FOREIGN KEY(RunId,MatchId,PlayerId) REFERENCES PlayerGameFacts(RunId,MatchId,PlayerId) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS PlayerPerformanceStats (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL, PlayerId INTEGER NOT NULL,
  Stage TEXT NOT NULL, Membership TEXT NOT NULL, Metric TEXT NOT NULL,
  Samples INTEGER NOT NULL, Total REAL, Average REAL, Minimum REAL, Maximum REAL, Variance REAL,
  PRIMARY KEY(RunId,SeasonId,TeamSubmissionId,PlayerId,Stage,Membership,Metric)
);
CREATE TABLE IF NOT EXISTS TeamPerformanceStats (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL, Stage TEXT NOT NULL, Metric TEXT NOT NULL,
  Samples INTEGER NOT NULL, Total REAL, Average REAL, Minimum REAL, Maximum REAL, Variance REAL,
  PRIMARY KEY(RunId,SeasonId,TeamSubmissionId,Stage,Metric)
);
CREATE TABLE IF NOT EXISTS PlayerHeroPatchStats (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, TeamSubmissionId INTEGER NOT NULL, PlayerId INTEGER NOT NULL,
  HeroId INTEGER NOT NULL, PatchKey TEXT NOT NULL, LaneRole INTEGER NOT NULL,
  Stage TEXT NOT NULL, Membership TEXT NOT NULL, GamesPlayed INTEGER NOT NULL, Wins INTEGER NOT NULL,
  MetricsJson TEXT NOT NULL,
  PRIMARY KEY(RunId,SeasonId,TeamSubmissionId,PlayerId,HeroId,PatchKey,LaneRole,Stage,Membership)
);
CREATE TABLE IF NOT EXISTS HeroItemStats (
  RunId INTEGER NOT NULL REFERENCES AnalyticsRuns(RunId) ON DELETE CASCADE,
  SeasonId INTEGER NOT NULL, HeroId INTEGER NOT NULL, PatchKey TEXT NOT NULL, LaneRole INTEGER NOT NULL,
  Stage TEXT NOT NULL, ItemKey TEXT NOT NULL, Samples INTEGER NOT NULL, AverageFirstPurchaseSeconds REAL,
  PRIMARY KEY(RunId,SeasonId,HeroId,PatchKey,LaneRole,Stage,ItemKey)
);
