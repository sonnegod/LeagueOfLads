CREATE TABLE IF NOT EXISTS ScheduledEvents (
  EventId INTEGER PRIMARY KEY AUTOINCREMENT, SeasonId INTEGER NOT NULL,
  Team1Key INTEGER NOT NULL, Team2Key INTEGER NOT NULL CHECK (Team1Key <> Team2Key),
  Stage TEXT NOT NULL CHECK (Stage IN ('regular','tiebreaker','playoff')),
  BestOf INTEGER NOT NULL CHECK (BestOf IN (2,3,5)), ScheduledStartUtc TEXT NOT NULL,
  Timezone TEXT NOT NULL, Status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (Status IN ('scheduled','started','completed','needs_review','cancelled','forfeit','replaced')),
  Revision INTEGER NOT NULL DEFAULT 1, StartedAtUtc TEXT, SeriesId INTEGER UNIQUE,
  SourceMessageId TEXT, CreatedAtUtc TEXT NOT NULL, UpdatedAtUtc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ScheduledEvents_SeasonStart ON ScheduledEvents(SeasonId,ScheduledStartUtc);
CREATE TABLE IF NOT EXISTS ScheduleEventRevisions (
  EventId INTEGER NOT NULL, Revision INTEGER NOT NULL, SnapshotJson TEXT NOT NULL,
  ActorId TEXT, Reason TEXT NOT NULL, CreatedAtUtc TEXT NOT NULL, PRIMARY KEY(EventId,Revision)
);
CREATE TABLE IF NOT EXISTS ScheduleMessages (
  ChannelId TEXT NOT NULL, MessageId TEXT PRIMARY KEY, AuthoredAtUtc TEXT NOT NULL,
  EditedAtUtc TEXT, Content TEXT NOT NULL, ContentHash TEXT NOT NULL, ParserVersion INTEGER NOT NULL,
  ParseStatus TEXT NOT NULL, IssueCode TEXT, AssumptionsJson TEXT, EventId INTEGER,
  LastSeenAtUtc TEXT NOT NULL, Deleted INTEGER NOT NULL DEFAULT 0,SeasonId INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ScheduleMessages_Channel ON ScheduleMessages(ChannelId,MessageId);
CREATE TABLE IF NOT EXISTS DiscordScheduleCursors (ChannelId TEXT PRIMARY KEY, LastMessageId TEXT, UpdatedAtUtc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS TeamDiscordAliases (
  SeasonId INTEGER NOT NULL, RoleId TEXT NOT NULL, TeamSubmissionId INTEGER NOT NULL,
  PRIMARY KEY(SeasonId,RoleId)
);
CREATE TABLE IF NOT EXISTS SeasonBettingSetup (
  SeasonId INTEGER PRIMARY KEY, Revision INTEGER NOT NULL, RegularGamesPerTeam INTEGER NOT NULL CHECK (RegularGamesPerTeam >= 5),
  FinalizedAtUtc TEXT NOT NULL, SetupJson TEXT NOT NULL,
  Completion TEXT NOT NULL DEFAULT 'normal' CHECK (Completion IN ('normal','shortened','canceled')),
  RegularSeasonComplete INTEGER NOT NULL DEFAULT 0, UpdatedAtUtc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS BettingOfficialOutcomes (
  SeasonId INTEGER NOT NULL, OutcomeType TEXT NOT NULL, TeamSubmissionId INTEGER NOT NULL,
  OutcomeValue TEXT NOT NULL, Revision INTEGER NOT NULL DEFAULT 1, UpdatedAtUtc TEXT NOT NULL,
  PRIMARY KEY(SeasonId,OutcomeType,TeamSubmissionId)
);
CREATE TABLE IF NOT EXISTS SeasonRosterChanges (
  ChangeId INTEGER PRIMARY KEY AUTOINCREMENT, SeasonId INTEGER NOT NULL, PlayerId INTEGER NOT NULL,
  FromTeamKey INTEGER, ToTeamKey INTEGER, EffectiveAtUtc TEXT NOT NULL,
  Kind TEXT NOT NULL CHECK(Kind IN ('permanent','data_correction')), Reason TEXT NOT NULL,
  ActorId TEXT, CreatedAtUtc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS TeamRosterMembershipHistory (
  MembershipId INTEGER PRIMARY KEY AUTOINCREMENT, TeamSubmissionId INTEGER NOT NULL, PlayerId INTEGER NOT NULL,
  Slot INTEGER NOT NULL, EffectiveFromUtc TEXT NOT NULL, EffectiveToUtc TEXT, FromEstimated INTEGER NOT NULL DEFAULT 0,
  UNIQUE(TeamSubmissionId,PlayerId,EffectiveFromUtc)
);
CREATE INDEX IF NOT EXISTS idx_RosterMembershipHistory_Interval ON TeamRosterMembershipHistory(TeamSubmissionId,PlayerId,EffectiveFromUtc,EffectiveToUtc);
CREATE TABLE IF NOT EXISTS OfficialMatchStatus (
  MatchId INTEGER PRIMARY KEY, SeasonId INTEGER NOT NULL,
  Status TEXT NOT NULL CHECK(Status IN ('official','superseded','abandoned')),
  ReplacementMatchId INTEGER, StageOverride TEXT CHECK(StageOverride IN ('regular','tiebreaker','playoff')),
  Reason TEXT NOT NULL, ActorId TEXT, UpdatedAtUtc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS BettingRefreshState (
  Id INTEGER PRIMARY KEY CHECK(Id=1),RequestedRevision INTEGER NOT NULL DEFAULT 0,
  CompletedRevision INTEGER NOT NULL DEFAULT 0,RequestedAtUtc TEXT,
  LastAttemptAtUtc TEXT,LastCompletedAtUtc TEXT,ConsecutiveFailures INTEGER NOT NULL DEFAULT 0,
  LastErrorCode TEXT,NextRetryAtUtc TEXT
);
INSERT OR IGNORE INTO BettingRefreshState(Id) VALUES(1);
CREATE TABLE IF NOT EXISTS DiscordSchedulePollLocks (
  ChannelId TEXT PRIMARY KEY,Owner TEXT NOT NULL,LeaseUntilUtc TEXT NOT NULL
);
