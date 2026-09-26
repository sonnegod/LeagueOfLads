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
    Message    STRING
);

-- table: Comments
CREATE TABLE Comments (ProblemId INTEGER PRIMARY KEY AUTOINCREMENT, UserId INTEGER, Comment VARCHAR (128));

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
            UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    LastLoginDate DATETIME NOT NULL
);

-- table: MatchLeague
CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY NOT NULL, LeagueId INTEGER REFERENCES LeagueInfo (LeagueId) NOT NULL, DatePlayed DATETIME);

-- table: MatchPlayer
CREATE TABLE MatchPlayer (MatchId INTEGER REFERENCES MatchTeam (MatchId) NOT NULL, PlayerId INTEGER NOT NULL, HeroId INTEGER REFERENCES HeroInfo (HeroId) NOT NULL, Kills INTEGER (4) NOT NULL, Deaths INTEGER (4) NOT NULL, Assists INTEGER (4) NOT NULL, Networth INTEGER, Lasthits INTEGER NOT NULL, HeroDamage INTEGER, GPM INTEGER (5) NOT NULL, XPM INTEGER (5) NOT NULL, Winner BOOLEAN, Healing INTEGER (8), TowerDamage INTEGER);

-- table: MatchTeam
CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY NOT NULL UNIQUE, TeamRad INTEGER NOT NULL, TeamDire INTEGER NOT NULL, WinnerId INTEGER NOT NULL, SeriesId INTEGER NOT NULL, Rehost INTEGER NOT NULL DEFAULT (0), Duration INTEGER);

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
