-- Schema only, exported from LadsData.db. No league, team, match, or user data is included.
-- Regenerate with: node scripts/db/exportLadsDataSchema.js db/LadsData.db scripts/db/ladsData.schema.sql

-- table: Admins
CREATE TABLE Admins (
    AdminPlayerId INTEGER PRIMARY KEY NOT NULL,
    AdminPlayerName TEXT NOT NULL,
    HeadAdmin INTEGER NOT NULL DEFAULT 0 CHECK (HeadAdmin IN (0, 1))
);

-- table: AdminAuditLog
CREATE TABLE AdminAuditLog (
    AuditLogId INTEGER PRIMARY KEY AUTOINCREMENT,
    Type       STRING,
    Message    STRING,
    ActorAdminId INTEGER,
    ActorAdminName TEXT,
    CreatedAt TEXT
);

-- table: AdjustedPlayers
CREATE TABLE AdjustedPlayers (
    PlayerId INTEGER PRIMARY KEY NOT NULL REFERENCES PlayerInfo(PlayerId),
    AdjustedMMR INTEGER NOT NULL CHECK (AdjustedMMR > 5500),
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
);

-- table: Comments
CREATE TABLE Comments (ProblemId INTEGER PRIMARY KEY AUTOINCREMENT, UserId INTEGER, Comment VARCHAR (128), CreatedAtUtc TEXT);

-- table: ChampionshipRosterPlayers
CREATE TABLE ChampionshipRosterPlayers (
    SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
    TeamId INTEGER NOT NULL,
    PlayerId INTEGER NOT NULL,
    Slot INTEGER NOT NULL CHECK (Slot BETWEEN 0 AND 4),
    UpdatedAt TEXT NOT NULL,
    PRIMARY KEY (SeasonId, TeamId, PlayerId),
    UNIQUE (SeasonId, TeamId, Slot)
);

-- table: DraftAccess
CREATE TABLE DraftAccess (
  PlayerId INTEGER PRIMARY KEY,
  FOREIGN KEY (PlayerId) REFERENCES PlayerInfo(PlayerId) ON DELETE CASCADE
);

-- table: GroupNames
CREATE TABLE GroupNames (
    UID       INTEGER PRIMARY KEY AUTOINCREMENT,
    LeagueId  INTEGER,
    GroupId   INTEGER,
    GroupName TEXT,
    UNIQUE (
        LeagueId,
        GroupId
    )
);

-- table: HeadToHead
CREATE TABLE HeadToHead (
    LeagueId INTEGER,
    TeamAId INTEGER,
    TeamBId INTEGER,
    WinsA INTEGER DEFAULT 0,
    WinsB INTEGER DEFAULT 0,
    PRIMARY KEY (LeagueId, TeamAId, TeamBId)
);

-- table: HeroInfo
CREATE TABLE HeroInfo (HeroId INTEGER UNIQUE NOT NULL PRIMARY KEY, HeroName STRING (40) NOT NULL);

-- table: LeagueGroups
CREATE TABLE LeagueGroups (
    UID      INTEGER PRIMARY KEY AUTOINCREMENT,
    LeagueId INTEGER NOT NULL,
    TeamId   INTEGER NOT NULL,
    GroupId  INTEGER NOT NULL,
    UNIQUE (
        LeagueId,
        TeamId
    )
);

-- table: LeagueInfo
CREATE TABLE LeagueInfo (LeagueId INTEGER PRIMARY KEY NOT NULL UNIQUE, LeagueName VARCHAR (60) NOT NULL, Active INTEGER NOT NULL);

-- table: LeagueRules
CREATE TABLE LeagueRules (
            LeagueId INTEGER PRIMARY KEY,
            UpperBracketTeams INTEGER NOT NULL,
            LowerBracketTeams INTEGER NOT NULL,
            EliminatedTeams INTEGER NOT NULL,
            HasTiebreaker INTEGER NOT NULL DEFAULT 0,
            TiebreakerPosition INTEGER,
            QualificationJson TEXT,
            UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

-- table: LeagueQualificationStages
CREATE TABLE LeagueQualificationStages (
    LeagueId INTEGER PRIMARY KEY,
    SnapshotJson TEXT NOT NULL,
    ResultsJson TEXT,
    StartedAtUtc TEXT NOT NULL,
    FinalizedAtUtc TEXT
);

-- table: LeagueStageBoundaries
CREATE TABLE LeagueStageBoundaries (
    LeagueId             INTEGER PRIMARY KEY
                                 NOT NULL,
    GroupEndMatchId      INTEGER NOT NULL,
    TieBreakerEndMatchId INTEGER
);

-- table: LeagueStandings
CREATE TABLE LeagueStandings (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    LeagueId INTEGER,
    TeamId INTEGER,
    Wins INTEGER DEFAULT 0,
    Losses INTEGER DEFAULT 0,
    UNIQUE(LeagueId, TeamId)  -- composite unique constraint
);

-- table: LiveMatchCurrentDraft
CREATE TABLE LiveMatchCurrentDraft (
                MatchId INTEGER NOT NULL,
                RadiantPicksJson TEXT NOT NULL DEFAULT '[]',
                DirePicksJson TEXT NOT NULL DEFAULT '[]',
                RadiantBansJson TEXT NOT NULL DEFAULT '[]',
                DireBansJson TEXT NOT NULL DEFAULT '[]',
                DraftJson TEXT NOT NULL,
                LastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (MatchId)
            );

-- table: LiveMatchCurrentPlayer
CREATE TABLE LiveMatchCurrentPlayer (
                MatchId INTEGER NOT NULL,
                AccountId INTEGER NOT NULL,
                PlayerName TEXT,
                Team INTEGER,
                PlayerSlot INTEGER,
                HeroId INTEGER,
                Kills INTEGER,
                Deaths INTEGER,
                Assists INTEGER,
                LastHits INTEGER,
                Denies INTEGER,
                Gold INTEGER,
                Level INTEGER,
                GPM INTEGER,
                XPM INTEGER,
                NetWorth INTEGER,
                RespawnTimer INTEGER,
                PositionX REAL,
                PositionY REAL,
                LastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (MatchId, AccountId)
            );

-- table: LiveMatchCurrentState
CREATE TABLE LiveMatchCurrentState (
    MatchId INTEGER PRIMARY KEY,
    LeagueId INTEGER NOT NULL,
    LobbyId INTEGER,
    RadiantTeamId INTEGER,
    DireTeamId INTEGER,
    RadiantTeamName TEXT,
    DireTeamName TEXT,
    RadiantScore INTEGER,
    DireScore INTEGER,
    GameDuration REAL,
    StreamDelaySeconds INTEGER,
    SnapshotHash TEXT NOT NULL,
    LastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
, RadiantTowerState INTEGER, DireTowerState INTEGER, RadiantBarracksState INTEGER, DireBarracksState INTEGER);

-- table: LiveMatchSnapshotDraft
CREATE TABLE LiveMatchSnapshotDraft (
                SnapshotId INTEGER NOT NULL,
                MatchId INTEGER NOT NULL,
                RadiantPicksJson TEXT NOT NULL DEFAULT '[]',
                DirePicksJson TEXT NOT NULL DEFAULT '[]',
                RadiantBansJson TEXT NOT NULL DEFAULT '[]',
                DireBansJson TEXT NOT NULL DEFAULT '[]',
                DraftJson TEXT NOT NULL,
                PRIMARY KEY (SnapshotId)
            );

-- table: LiveMatchSnapshotPlayer
CREATE TABLE LiveMatchSnapshotPlayer (
                SnapshotId INTEGER NOT NULL,
                MatchId INTEGER NOT NULL,
                AccountId INTEGER NOT NULL,
                PlayerName TEXT,
                Team INTEGER,
                PlayerSlot INTEGER,
                HeroId INTEGER,
                Kills INTEGER,
                Deaths INTEGER,
                Assists INTEGER,
                LastHits INTEGER,
                Denies INTEGER,
                Gold INTEGER,
                Level INTEGER,
                GPM INTEGER,
                XPM INTEGER,
                NetWorth INTEGER,
                RespawnTimer INTEGER,
                PositionX REAL,
                PositionY REAL,
                PRIMARY KEY (SnapshotId, AccountId)
            );

-- table: LiveMatchSnapshots
CREATE TABLE LiveMatchSnapshots (
    SnapshotId INTEGER PRIMARY KEY AUTOINCREMENT,
    MatchId INTEGER NOT NULL,
    LeagueId INTEGER NOT NULL,
    LobbyId INTEGER,
    RadiantTeamId INTEGER,
    DireTeamId INTEGER,
    RadiantTeamName TEXT,
    DireTeamName TEXT,
    RadiantScore INTEGER,
    DireScore INTEGER,
    GameDuration REAL,
    StreamDelaySeconds INTEGER,
    SnapshotHash TEXT NOT NULL,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
, RadiantTowerState INTEGER, DireTowerState INTEGER, RadiantBarracksState INTEGER, DireBarracksState INTEGER);

-- table: Logins
CREATE TABLE Logins (
    UID           INTEGER  PRIMARY KEY AUTOINCREMENT
                           UNIQUE,
    Username      CHAR     NOT NULL,
    SteamID       INTEGER  NOT NULL
                           UNIQUE,
    LastLoginDate DATETIME NOT NULL,
    FirstLoginAtUtc TEXT,
    NameConfirmedAtUtc TEXT,
    NameConfirmationRequired INTEGER NOT NULL DEFAULT 0 CHECK (NameConfirmationRequired IN (0, 1))
);

-- table: PlayerLoginMigrations
CREATE TABLE IF NOT EXISTS PlayerLoginMigrations (
    Version INTEGER PRIMARY KEY,
    AppliedAtUtc TEXT NOT NULL
);

-- table: SourceLoadRuns
-- Ingestion provenance is additive; the jobs create these tables/indexes on
-- existing databases without modifying old match dates or inventing load times.
CREATE TABLE IF NOT EXISTS SourceLoadRuns (
    SourceRunId INTEGER PRIMARY KEY AUTOINCREMENT,
    SourceName TEXT NOT NULL,
    StartedAtUtc TEXT NOT NULL,
    FinishedAtUtc TEXT,
    Status TEXT NOT NULL CHECK (Status IN ('running', 'complete', 'partial', 'failed')),
    RecordsSeen INTEGER NOT NULL DEFAULT 0,
    FailedItems INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_SourceLoadRuns_Source ON SourceLoadRuns(SourceName, SourceRunId DESC);
-- table: MatchSourceDetails
CREATE TABLE IF NOT EXISTS MatchSourceDetails (
    MatchId INTEGER PRIMARY KEY,
    StartedAtUtc TEXT NOT NULL,
    ObservedAtUtc TEXT NOT NULL,
    Source TEXT NOT NULL
);
-- table: MatchLeague
CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY NOT NULL, LeagueId INTEGER REFERENCES LeagueInfo (LeagueId) NOT NULL, DatePlayed DATETIME);

-- table: MatchPlayer
CREATE TABLE MatchPlayer (MatchId INTEGER REFERENCES MatchTeam (MatchId) NOT NULL, PlayerId INTEGER NOT NULL, HeroId INTEGER REFERENCES HeroInfo (HeroId) NOT NULL, Kills INTEGER (4) NOT NULL, Deaths INTEGER (4) NOT NULL, Assists INTEGER (4) NOT NULL, Networth INTEGER, Lasthits INTEGER NOT NULL, HeroDamage INTEGER, GPM INTEGER (5) NOT NULL, XPM INTEGER (5) NOT NULL, Winner BOOLEAN, Healing INTEGER (8), TowerDamage INTEGER, PlayerSlot INTEGER, Denies INTEGER, FinalLevel INTEGER, LaneRole INTEGER, IsRoaming INTEGER, ObserversPlaced INTEGER, SentriesPlaced INTEGER, ObserversKilled INTEGER, SentriesKilled INTEGER, CampsStacked INTEGER, StunSeconds REAL, NeutralKills INTEGER, AncientKills INTEGER, TowerKills INTEGER, RoshanKills INTEGER, CourierKills INTEGER);

-- table: MatchTeam
CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY NOT NULL UNIQUE, TeamRad INTEGER NOT NULL, TeamDire INTEGER NOT NULL, WinnerId INTEGER NOT NULL, SeriesId INTEGER NOT NULL, Rehost INTEGER NOT NULL DEFAULT (0), Duration INTEGER, StartTimeUtc INTEGER, PatchId INTEGER REFERENCES Patches(PatchId), RadiantScore INTEGER, DireScore INTEGER, FirstBloodTime INTEGER);

-- table: MatchTeamPlayer
CREATE TABLE MatchTeamPlayer (UID INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, MatchId INTEGER NOT NULL, PlayerId INTEGER NOT NULL, TeamId INTEGER NOT NULL);

-- table: Neustadtl
CREATE TABLE Neustadtl (TeamId INTEGER, Score REAL, LeagueId INTEGER, UID INTEGER PRIMARY KEY AUTOINCREMENT, UNIQUE (TeamId, LeagueId));

-- table: NeustadtlLegacy
CREATE TABLE NeustadtlLegacy (
    UID      INTEGER PRIMARY KEY AUTOINCREMENT,
    LeagueId INTEGER,
    TeamId   INTEGER,
    Score    INTEGER
);

-- table: PickInfo
CREATE TABLE PickInfo (MatchId INTEGER NOT NULL, IsPick BOOLEAN NOT NULL, Hero_Id INTEGER NOT NULL, OrderNum INTEGER NOT NULL, Team INTEGER);

-- Draft-only remakes stay outside played-match tables. Picks/bans are attached
-- to the real game in PickInfo, with the original source ID retained here.
CREATE TABLE IF NOT EXISTS RemakeDraftSources (
    SourceMatchId INTEGER PRIMARY KEY, LeagueId INTEGER NOT NULL, StartTime INTEGER NOT NULL,
    TeamRad INTEGER NOT NULL, TeamDire INTEGER NOT NULL, DraftJson TEXT NOT NULL, CollectedAtUtc TEXT NOT NULL, DiscardedAtUtc TEXT
);
CREATE INDEX IF NOT EXISTS idx_RemakeDraftSources_LeagueTime ON RemakeDraftSources(LeagueId, StartTime);
CREATE TABLE IF NOT EXISTS MatchDraftSources (
    MatchId INTEGER PRIMARY KEY, SourceMatchId INTEGER NOT NULL UNIQUE,
    SideSwapped INTEGER NOT NULL CHECK (SideSwapped IN (0, 1)), LinkedAtUtc TEXT NOT NULL
);

-- table: PlayerInfo
CREATE TABLE PlayerInfo (PlayerId INTEGER UNIQUE PRIMARY KEY, PlayerName STRING (40) NOT NULL, LastDateChanged TEXT);

-- table: PlayoffBracket
CREATE TABLE PlayoffBracket (
    LeagueId         INTEGER PRIMARY KEY
                             UNIQUE,
    PlayoffStructure TEXT
);

-- table: PlayoffSeeding
CREATE TABLE PlayoffSeeding (
    UID      INTEGER PRIMARY KEY AUTOINCREMENT,
    LeagueId INTEGER,
    TeamId   INTEGER,
    Seed     INTEGER,
    Bracket  TEXT
);

-- table: ScheduledSeries
CREATE TABLE ScheduledSeries (
    UID   INTEGER PRIMARY KEY AUTOINCREMENT
                  UNIQUE,
    Team1 INTEGER,
    Team2 INTEGER,
    Date  TEXT,
    UNIQUE (
        Team1,
        Team2,
        Date
    )
);

-- table: SeriesInfo
CREATE TABLE SeriesInfo (
    SeriesId    INTEGER PRIMARY KEY AUTOINCREMENT
                        UNIQUE
                        NOT NULL,
    Team1       INTEGER NOT NULL,
    Team2       INTEGER NOT NULL,
    DateCreated TEXT,
    LeagueId    INTEGER,
    Stage       STRING
);

-- table: SeriesMatch
CREATE TABLE SeriesMatch (
    UID         INTEGER PRIMARY KEY AUTOINCREMENT,
    SeriesId    INTEGER,
    MatchId     INTEGER,
    DateCreated TEXT
);

-- table: Team
CREATE TABLE Team (TeamId INTEGER UNIQUE NOT NULL REFERENCES TeamInfo (TeamId) PRIMARY KEY, PlayerId INTEGER (20) NOT NULL UNIQUE REFERENCES PlayerInfo (PlayerId), CurrentRowInd INTEGER (1) NOT NULL);

-- table: TeamInfo
CREATE TABLE TeamInfo (TeamId INTEGER UNIQUE NOT NULL PRIMARY KEY, TeamName STRING (60) NOT NULL);

-- table: LeagueSeasons
CREATE TABLE LeagueSeasons (
    SeasonId INTEGER PRIMARY KEY AUTOINCREMENT,
    LeagueName TEXT NOT NULL,
    Status TEXT NOT NULL CHECK (Status IN ('draft', 'signup_open', 'signup_closed', 'active', 'ended')),
    SignupTitle TEXT,
    SignupDescription TEXT,
    ExternalLeagueId INTEGER UNIQUE,
    ChampionTeamId INTEGER,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    EndedAt TEXT
);

-- table: SeasonGroups
CREATE TABLE SeasonGroups (
    GroupId INTEGER PRIMARY KEY AUTOINCREMENT,
    SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
    GroupName TEXT NOT NULL COLLATE NOCASE,
    SortOrder INTEGER NOT NULL,
    UNIQUE (SeasonId, GroupName)
);

-- table: SeasonTeams
CREATE TABLE SeasonTeams (
    TeamSubmissionId INTEGER PRIMARY KEY AUTOINCREMENT,
    SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
    CaptainId INTEGER,
    TeamName TEXT NOT NULL,
    IsManual INTEGER NOT NULL DEFAULT 0 CHECK (IsManual IN (0, 1)),
    ManualAverageMMR INTEGER,
    GroupId INTEGER REFERENCES SeasonGroups(GroupId),
    ExternalTeamId INTEGER,
    SubmittedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
);

-- table: SeasonTeamPlayers
CREATE TABLE SeasonTeamPlayers (
    TeamSubmissionId INTEGER NOT NULL REFERENCES SeasonTeams(TeamSubmissionId),
    PlayerId INTEGER NOT NULL REFERENCES PlayerInfo(PlayerId),
    Slot INTEGER NOT NULL,
    MMR INTEGER NOT NULL,
    DotaProfileUrl TEXT NOT NULL,
    ScreenshotMime TEXT NOT NULL,
    ScreenshotData BLOB NOT NULL,
    PRIMARY KEY (TeamSubmissionId, PlayerId),
    UNIQUE (TeamSubmissionId, Slot)
);

-- table: SeasonSignupDrafts (temporary, unpublished signup uploads)
CREATE TABLE SeasonSignupDrafts (
    DraftId TEXT PRIMARY KEY,
    SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
    CaptainId INTEGER NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
);

-- table: SeasonSignupDraftPlayers
CREATE TABLE SeasonSignupDraftPlayers (
    DraftId TEXT NOT NULL REFERENCES SeasonSignupDrafts(DraftId),
    Slot INTEGER NOT NULL CHECK (Slot BETWEEN 0 AND 4),
    PlayerId INTEGER NOT NULL,
    PlayerName TEXT NOT NULL,
    MMR INTEGER NOT NULL,
    DotaProfileUrl TEXT NOT NULL,
    ScreenshotMime TEXT NOT NULL,
    ScreenshotData BLOB NOT NULL,
    PRIMARY KEY (DraftId, Slot),
    UNIQUE (DraftId, PlayerId)
);

-- table: SignupMMRs
CREATE TABLE SignupMMRs (
    SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
    TeamSubmissionId INTEGER NOT NULL REFERENCES SeasonTeams(TeamSubmissionId),
    PlayerId INTEGER NOT NULL REFERENCES PlayerInfo(PlayerId),
    SignupMMR INTEGER NOT NULL,
    PRIMARY KEY (TeamSubmissionId, PlayerId)
);

-- table: SeasonLeagueRules
CREATE TABLE SeasonLeagueRules (
    SeasonId INTEGER PRIMARY KEY REFERENCES LeagueSeasons(SeasonId),
    UpperBracketTeams INTEGER NOT NULL,
    LowerBracketTeams INTEGER NOT NULL,
    EliminatedTeams INTEGER NOT NULL,
    HasTiebreaker INTEGER NOT NULL,
    TiebreakerPosition INTEGER
);

-- table: TempSeriesInfo
CREATE TABLE TempSeriesInfo (
    SeriesId    INTEGER PRIMARY KEY AUTOINCREMENT
                        UNIQUE
                        NOT NULL,
    Team1       INTEGER NOT NULL,
    Team2       INTEGER NOT NULL,
    DateCreated TEXT,
    Stage       TEXT,
    LeagueId    INTEGER
);

CREATE UNIQUE INDEX idx_LeagueSeasons_Current ON LeagueSeasons ((1)) WHERE Status <> 'ended';
CREATE INDEX idx_SeasonTeams_Season ON SeasonTeams(SeasonId);
CREATE INDEX idx_SeasonGroups_Season ON SeasonGroups(SeasonId);

-- index: idx_DraftAccess_PlayerId
CREATE INDEX idx_DraftAccess_PlayerId ON DraftAccess(PlayerId);

-- index: idx_LiveMatchSnapshotDraft_MatchId_SnapshotId
CREATE INDEX idx_LiveMatchSnapshotDraft_MatchId_SnapshotId
            ON LiveMatchSnapshotDraft (MatchId, SnapshotId);

-- index: idx_LiveMatchSnapshotPlayer_MatchId_SnapshotId
CREATE INDEX idx_LiveMatchSnapshotPlayer_MatchId_SnapshotId
            ON LiveMatchSnapshotPlayer (MatchId, SnapshotId);

-- index: idx_LiveMatchSnapshots_CreatedAt
CREATE INDEX idx_LiveMatchSnapshots_CreatedAt
            ON LiveMatchSnapshots (CreatedAt);

-- index: idx_LiveMatchSnapshots_LeagueId_CreatedAt
CREATE INDEX idx_LiveMatchSnapshots_LeagueId_CreatedAt
ON LiveMatchSnapshots (LeagueId, CreatedAt);

-- index: idx_LiveMatchSnapshots_MatchId_CreatedAt
CREATE INDEX idx_LiveMatchSnapshots_MatchId_CreatedAt
ON LiveMatchSnapshots (MatchId, CreatedAt);

-- index: neustadtl_team_league
CREATE UNIQUE INDEX neustadtl_team_league ON Neustadtl (TeamId, LeagueId);

-- table: TeamRosterPlayers
CREATE TABLE TeamRosterPlayers (
    TeamSubmissionId INTEGER NOT NULL REFERENCES SeasonTeams(TeamSubmissionId),
    PlayerId INTEGER NOT NULL REFERENCES PlayerInfo(PlayerId),
    Slot INTEGER NOT NULL CHECK (Slot BETWEEN 0 AND 4),
    FinalizedAt TEXT NOT NULL,
    PRIMARY KEY (TeamSubmissionId, PlayerId),
    UNIQUE (TeamSubmissionId, Slot)
);

-- index: idx_SeasonTeams_ExternalTeam
CREATE INDEX idx_SeasonTeams_ExternalTeam ON SeasonTeams(ExternalTeamId, SeasonId);

-- table: TeamRosterPeriods
CREATE TABLE TeamRosterPeriods (
    TeamSubmissionId INTEGER PRIMARY KEY REFERENCES SeasonTeams(TeamSubmissionId),
    EffectiveFrom TEXT,
    EffectiveTo TEXT,
    FromEstimated INTEGER NOT NULL DEFAULT 0 CHECK (FromEstimated IN (0, 1))
);

-- table: DraftGodDrafts
CREATE TABLE DraftGodDrafts (
    DraftId INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT NOT NULL,
    StateJson TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
);

-- table: DraftGodHeroProfiles
CREATE TABLE DraftGodHeroProfiles (
    HeroId INTEGER PRIMARY KEY REFERENCES HeroInfo(HeroId),
    RolesJson TEXT NOT NULL,
    TagsJson TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
);

-- index: idx_MatchLeague_LeagueId_MatchId
CREATE INDEX idx_MatchLeague_LeagueId_MatchId ON MatchLeague(LeagueId, MatchId);

-- index: idx_MatchTeamPlayer_MatchId_PlayerId_TeamId
CREATE INDEX idx_MatchTeamPlayer_MatchId_PlayerId_TeamId ON MatchTeamPlayer(MatchId, PlayerId, TeamId);

-- index: idx_MatchPlayer_MatchId_PlayerId
CREATE INDEX idx_MatchPlayer_MatchId_PlayerId ON MatchPlayer(MatchId, PlayerId);

-- index: idx_PickInfo_MatchId
CREATE INDEX idx_PickInfo_MatchId ON PickInfo(MatchId);

-- Private draft meta and compact timeline intelligence
CREATE TABLE IF NOT EXISTS DraftGodPatches (
    PatchKey TEXT PRIMARY KEY, StartsAt TEXT NOT NULL, Major INTEGER NOT NULL,
    NotesKnown INTEGER NOT NULL DEFAULT 0, ChangesJson TEXT NOT NULL DEFAULT '{}',
    Source TEXT NOT NULL, SyncedAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_DraftGodPatches_Start ON DraftGodPatches(StartsAt);
    CREATE TABLE IF NOT EXISTS DraftGodMetaOverrides (
      PatchKey TEXT NOT NULL REFERENCES DraftGodPatches(PatchKey), HeroId INTEGER NOT NULL DEFAULT 0,
      Transfer REAL NOT NULL CHECK (Transfer BETWEEN 0 AND 1), Note TEXT NOT NULL, UpdatedAt TEXT NOT NULL,
      PRIMARY KEY(PatchKey,HeroId));
    CREATE TABLE IF NOT EXISTS DraftGodHeroProfileVersions (
      HeroId INTEGER NOT NULL, PatchKey TEXT NOT NULL REFERENCES DraftGodPatches(PatchKey),
      RolesJson TEXT NOT NULL, TagsJson TEXT NOT NULL, UpdatedAt TEXT NOT NULL, PRIMARY KEY(HeroId,PatchKey));
    CREATE TABLE IF NOT EXISTS DraftGodMatchTelemetry (
      MatchId INTEGER PRIMARY KEY, StartAt TEXT, PatchId INTEGER, ParseVersion INTEGER,
      SummaryJson TEXT, Status TEXT NOT NULL, CheckedAt TEXT NOT NULL, LastSuccessAt TEXT);
    CREATE INDEX IF NOT EXISTS idx_DraftGodTelemetry_Status ON DraftGodMatchTelemetry(Status,CheckedAt);

-- Shared match warehouse expansion (consumer-independent)
CREATE TABLE IF NOT EXISTS Patches (
  PatchId INTEGER PRIMARY KEY, PatchKey TEXT NOT NULL UNIQUE, StartsAt TEXT NOT NULL,
  Major INTEGER NOT NULL, Source TEXT NOT NULL, SyncedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_Patches_Start ON Patches(StartsAt);

  CREATE TABLE IF NOT EXISTS MatchTeamTimeline (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), TimeSeconds INTEGER NOT NULL,
    RadiantGoldAdvantage INTEGER, RadiantXpAdvantage INTEGER, PRIMARY KEY(MatchId,TimeSeconds));
  CREATE TABLE IF NOT EXISTS MatchPlayerTimeline (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), PlayerId INTEGER NOT NULL, TimeSeconds INTEGER NOT NULL,
    Gold INTEGER, Experience INTEGER, LastHits INTEGER, PRIMARY KEY(MatchId,PlayerId,TimeSeconds));
  CREATE TABLE IF NOT EXISTS MatchPlayerPurchases (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), PlayerId INTEGER NOT NULL, EventIndex INTEGER NOT NULL,
    TimeSeconds INTEGER NOT NULL, ItemKey TEXT NOT NULL, PRIMARY KEY(MatchId,PlayerId,EventIndex));
  CREATE TABLE IF NOT EXISTS MatchPlayerAbilityUpgrades (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), PlayerId INTEGER NOT NULL,
    UpgradeIndex INTEGER NOT NULL CHECK(UpgradeIndex>=0), AbilityId INTEGER NOT NULL CHECK(AbilityId>0),
    PRIMARY KEY(MatchId,PlayerId,UpgradeIndex));
  CREATE TABLE IF NOT EXISTS MatchObjectives (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), EventIndex INTEGER NOT NULL,
    TimeSeconds INTEGER NOT NULL, Type TEXT NOT NULL, PlayerId INTEGER, PlayerSlot INTEGER,
    TeamSide INTEGER, Target TEXT, SourceJson TEXT NOT NULL, PRIMARY KEY(MatchId,EventIndex));
  CREATE TABLE IF NOT EXISTS MatchTeamfights (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), FightIndex INTEGER NOT NULL,
    StartSeconds INTEGER, EndSeconds INTEGER, SourceJson TEXT NOT NULL, PRIMARY KEY(MatchId,FightIndex));
  CREATE TABLE IF NOT EXISTS MatchTeamfightPlayers (
    MatchId INTEGER NOT NULL, FightIndex INTEGER NOT NULL, PlayerId INTEGER NOT NULL, PlayerSlot INTEGER NOT NULL,
    Deaths INTEGER, Damage INTEGER, GoldDelta INTEGER, XpDelta INTEGER, SourceJson TEXT NOT NULL,
    PRIMARY KEY(MatchId,FightIndex,PlayerId),
    FOREIGN KEY(MatchId,FightIndex) REFERENCES MatchTeamfights(MatchId,FightIndex));
  CREATE TABLE IF NOT EXISTS MatchIngestionState (
    MatchId INTEGER PRIMARY KEY REFERENCES MatchTeam(MatchId), Status TEXT NOT NULL,
    ImporterVersion INTEGER NOT NULL, ParseVersion INTEGER, SourceHash TEXT,
    SectionsJson TEXT NOT NULL DEFAULT '{}', IssuesJson TEXT NOT NULL DEFAULT '[]',
    AttemptedAt TEXT NOT NULL, LastSuccessAt TEXT, Error TEXT);
  CREATE INDEX IF NOT EXISTS idx_MatchIngestionState_Status ON MatchIngestionState(Status,ImporterVersion);
  CREATE TABLE IF NOT EXISTS MatchSourceResponses (
    MatchId INTEGER PRIMARY KEY REFERENCES MatchTeam(MatchId), Encoding TEXT NOT NULL CHECK(Encoding='gzip'),
    SourceHash TEXT NOT NULL, GameplayData BLOB NOT NULL, CollectedAt TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS WarehouseMigrations (Version INTEGER PRIMARY KEY,AppliedAt TEXT NOT NULL);

-- Stable leaderboard roster entries are also used by suggested matchups.
CREATE TABLE IF NOT EXISTS LeagueRosterEntries (
  EntryId INTEGER PRIMARY KEY AUTOINCREMENT,
  LeagueId INTEGER NOT NULL,
  GroupId INTEGER NOT NULL,
  DisplayName TEXT NOT NULL,
  TeamId INTEGER,
  TeamSubmissionId INTEGER,
  SortOrder INTEGER NOT NULL,
  UNIQUE (LeagueId, TeamId)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_LeagueRosterEntries_LeagueGroupName
  ON LeagueRosterEntries (LeagueId, GroupId, DisplayName COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS SeasonScheduleSettings (
  SeasonId INTEGER PRIMARY KEY REFERENCES LeagueSeasons(SeasonId),
  StartDate TEXT NOT NULL,
  SeriesPerWindow INTEGER NOT NULL CHECK (SeriesPerWindow BETWEEN 1 AND 20),
  WeeksPerWindow INTEGER NOT NULL CHECK (WeeksPerWindow BETWEEN 1 AND 12),
  UpdatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS SeasonMatchups (
  MatchupId INTEGER PRIMARY KEY AUTOINCREMENT,
  SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
  GroupId INTEGER NOT NULL,
  TeamAEntryId INTEGER NOT NULL REFERENCES LeagueRosterEntries(EntryId),
  TeamBEntryId INTEGER NOT NULL REFERENCES LeagueRosterEntries(EntryId),
  WindowNumber INTEGER NOT NULL CHECK (WindowNumber BETWEEN 1 AND 104),
  CHECK (TeamAEntryId < TeamBEntryId),
  UNIQUE (SeasonId, TeamAEntryId, TeamBEntryId)
);
CREATE INDEX IF NOT EXISTS idx_SeasonMatchups_Window
  ON SeasonMatchups (SeasonId, WindowNumber, GroupId);
