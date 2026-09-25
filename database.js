import dbBet from './databaseBet.js';
import Database from "better-sqlite3";
import dotenv from 'dotenv';
import { classifyStandings, DEFAULT_LEAGUE_RULES, normalizeLeagueRules } from './config/leagueRules.js';
import { buildGroupResults } from './config/groupResults.js';
import { planRosterLinks } from './config/rosterMatching.js';
dotenv.config();

class DBInstance {
    constructor(){
        if(!DBInstance.instance){
            const dbPath =
                process.env.ENVIRONMENT === 'DEV'
                ? './db/LadsData.db'
                : '/root/LeagueOfLads/db/LadsData.db';
                
            this.db = new Database(dbPath);
            this.ensureAdminsSchema();
            this.ensureLeagueRulesSchema();
            this.ensureAdminStandingsSchema();
            this.ensureLiveMatchSchema();
            this.preloadedData = this.preloadData();
            DBInstance.instance = this;
        }

        return DBInstance.instance;
    }

    ensureLeagueRulesSchema(){
        this.db.prepare(`CREATE TABLE IF NOT EXISTS LeagueRules (
            LeagueId INTEGER PRIMARY KEY,
            UpperBracketTeams INTEGER NOT NULL,
            LowerBracketTeams INTEGER NOT NULL,
            EliminatedTeams INTEGER NOT NULL,
            HasTiebreaker INTEGER NOT NULL DEFAULT 0,
            TiebreakerPosition INTEGER,
            UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`).run();
    }

    ensureAdminsSchema(){
        this.db.exec(`CREATE TABLE IF NOT EXISTS Admins (
            AdminPlayerId INTEGER PRIMARY KEY NOT NULL,
            AdminPlayerName TEXT NOT NULL,
            HeadAdmin INTEGER NOT NULL DEFAULT 0 CHECK (HeadAdmin IN (0, 1))
        )`);
    }

    getAdminByPlayerId(playerId){
        return this.db.prepare(`SELECT AdminPlayerId, AdminPlayerName, HeadAdmin
            FROM Admins WHERE AdminPlayerId = ?`).get(playerId) || null;
    }

    getAdmins(){
        return this.db.prepare(`SELECT AdminPlayerId, AdminPlayerName, HeadAdmin
            FROM Admins ORDER BY HeadAdmin DESC, AdminPlayerName COLLATE NOCASE, AdminPlayerId`).all();
    }

    getAdminCandidates(){
        return this.db.prepare(`SELECT p.PlayerId, CAST(p.PlayerName AS TEXT) AS PlayerName FROM PlayerInfo p
            WHERE p.PlayerId > 0 AND NOT EXISTS (
                SELECT 1 FROM Admins a WHERE a.AdminPlayerId = p.PlayerId
            ) ORDER BY p.PlayerName COLLATE NOCASE, p.PlayerId`).all();
    }

    addAdmin(playerId, headAdmin, actorId){
        const role = headAdmin ? 1 : 0;
        return this.db.transaction(() => {
            const player = this.db.prepare(`SELECT CAST(PlayerName AS TEXT) AS PlayerName
                FROM PlayerInfo WHERE PlayerId = ?`).get(playerId);
            if (!player) {
                const error = new Error('Player not found in PlayerInfo');
                error.code = 'PLAYER_NOT_FOUND';
                throw error;
            }
            const playerName = player.PlayerName;
            this.db.prepare(`INSERT INTO Admins (AdminPlayerId, AdminPlayerName, HeadAdmin)
                VALUES (?, ?, ?)`).run(playerId, playerName, role);
            this.db.prepare('INSERT INTO AdminAuditLog (Type, Message) VALUES (?, ?)').run(
                'Admin Added', `Admin ${actorId} added ${playerName} (${playerId}) as ${role ? 'head admin' : 'admin'}`
            );
            return this.getAdminByPlayerId(playerId);
        })();
    }

    addManualAdmin(playerId, playerName, headAdmin, actorId){
        const role = headAdmin ? 1 : 0;
        return this.db.transaction(() => {
            if (this.getAdminByPlayerId(playerId)) {
                const error = new Error('This player ID is already an admin');
                error.code = 'ADMIN_EXISTS';
                throw error;
            }
            if (this.db.prepare(`SELECT 1 FROM PlayerInfo WHERE PlayerId = ?`).get(playerId)) {
                const error = new Error('This player is in PlayerInfo; select them from the player dropdown');
                error.code = 'PLAYER_IN_PLAYERINFO';
                throw error;
            }
            this.db.prepare(`INSERT INTO Admins (AdminPlayerId, AdminPlayerName, HeadAdmin)
                VALUES (?, ?, ?)`).run(playerId, playerName, role);
            this.db.prepare('INSERT INTO AdminAuditLog (Type, Message) VALUES (?, ?)').run(
                'Admin Added', `Admin ${actorId} manually added ${playerName} (${playerId}) as ${role ? 'head admin' : 'admin'}`
            );
            return this.getAdminByPlayerId(playerId);
        })();
    }

    setAdminRole(playerId, headAdmin, actorId){
        return this.db.transaction(() => {
            const current = this.getAdminByPlayerId(playerId);
            if (!current) return null;
            const role = headAdmin ? 1 : 0;
            if (current.HeadAdmin === role) return current;
            if (current.HeadAdmin && !role) {
                const headCount = this.db.prepare(`SELECT COUNT(*) AS Count FROM Admins WHERE HeadAdmin = 1`).get().Count;
                if (headCount <= 1) {
                    const error = new Error('The final head admin cannot be demoted');
                    error.code = 'LAST_HEAD_ADMIN';
                    throw error;
                }
            }
            this.db.prepare(`UPDATE Admins SET HeadAdmin = ? WHERE AdminPlayerId = ?`).run(role, playerId);
            this.db.prepare('INSERT INTO AdminAuditLog (Type, Message) VALUES (?, ?)').run(
                'Admin Role Changed', `Admin ${actorId} changed ${current.AdminPlayerName} (${playerId}) to ${role ? 'head admin' : 'admin'}`
            );
            return this.getAdminByPlayerId(playerId);
        })();
    }

    removeAdmin(playerId, actorId){
        return this.db.transaction(() => {
            const current = this.getAdminByPlayerId(playerId);
            if (!current) return null;
            if (current.HeadAdmin) {
                const error = new Error('Change this head admin to Admin before removing them');
                error.code = 'HEAD_ADMIN_REMOVAL';
                throw error;
            }
            this.db.prepare(`DELETE FROM Admins WHERE AdminPlayerId = ? AND HeadAdmin = 0`).run(playerId);
            this.db.prepare('INSERT INTO AdminAuditLog (Type, Message) VALUES (?, ?)').run(
                'Admin Removed', `Admin ${actorId} removed ${current.AdminPlayerName} (${playerId})`
            );
            return current;
        })();
    }

    ensureAdminStandingsSchema(){
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS LeagueTeamNames (
                LeagueId INTEGER NOT NULL,
                TeamId INTEGER NOT NULL,
                DisplayName TEXT NOT NULL,
                PRIMARY KEY (LeagueId, TeamId)
            );
            CREATE TABLE IF NOT EXISTS GroupResultOverrides (
                LeagueId INTEGER NOT NULL,
                GroupId INTEGER NOT NULL,
                TeamA INTEGER NOT NULL,
                TeamB INTEGER NOT NULL,
                WinsA INTEGER NOT NULL CHECK (WinsA >= 0),
                WinsB INTEGER NOT NULL CHECK (WinsB >= 0),
                BaseWinsA INTEGER NOT NULL DEFAULT 0,
                BaseWinsB INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (LeagueId, GroupId, TeamA, TeamB),
                CHECK (TeamA < TeamB)
            );
            CREATE TABLE IF NOT EXISTS LeagueRosterEntries (
                EntryId INTEGER PRIMARY KEY AUTOINCREMENT,
                LeagueId INTEGER NOT NULL,
                GroupId INTEGER NOT NULL,
                DisplayName TEXT NOT NULL,
                TeamId INTEGER,
                SortOrder INTEGER NOT NULL,
                UNIQUE (LeagueId, TeamId)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_LeagueRosterEntries_LeagueGroupName
                ON LeagueRosterEntries (LeagueId, GroupId, DisplayName COLLATE NOCASE);
        `);
    }

    getLeagueRules(leagueId){
        return this.db.prepare(`SELECT * FROM LeagueRules WHERE LeagueId = ?`).get(leagueId) || null;
    }

    saveLeagueRules(leagueId, rules){
        const normalized = normalizeLeagueRules(rules);
        this.db.prepare(`INSERT INTO LeagueRules
            (LeagueId, UpperBracketTeams, LowerBracketTeams, EliminatedTeams, HasTiebreaker, TiebreakerPosition, UpdatedAt)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(LeagueId) DO UPDATE SET
              UpperBracketTeams=excluded.UpperBracketTeams,
              LowerBracketTeams=excluded.LowerBracketTeams,
              EliminatedTeams=excluded.EliminatedTeams,
              HasTiebreaker=excluded.HasTiebreaker,
              TiebreakerPosition=excluded.TiebreakerPosition,
              UpdatedAt=CURRENT_TIMESTAMP`).run(
                leagueId, normalized.UpperBracketTeams, normalized.LowerBracketTeams,
                normalized.EliminatedTeams, normalized.HasTiebreaker ? 1 : 0,
                normalized.TiebreakerPosition
            );
        return this.getLeagueRules(leagueId);
    }

    ensureLiveMatchSchema(){
        const ensureColumn = (tableName, columnName, definition) => {
            const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
            const exists = columns.some((column) => column.name === columnName);
            if (!exists) {
                this.db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
            }
        };

        [
            'LiveMatchCurrentState',
            'LiveMatchSnapshots'
        ].forEach((tableName) => {
            const table = this.db.prepare(`
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                AND name = ?
            `).get(tableName);

            if (!table) return;

            ensureColumn(tableName, 'RadiantTowerState', 'INTEGER');
            ensureColumn(tableName, 'DireTowerState', 'INTEGER');
            ensureColumn(tableName, 'RadiantBarracksState', 'INTEGER');
            ensureColumn(tableName, 'DireBarracksState', 'INTEGER');
        });

        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS LiveMatchCurrentPlayer (
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
            )
        `).run();

        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS LiveMatchSnapshotPlayer (
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
            )
        `).run();

        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS LiveMatchCurrentDraft (
                MatchId INTEGER NOT NULL,
                RadiantPicksJson TEXT NOT NULL DEFAULT '[]',
                DirePicksJson TEXT NOT NULL DEFAULT '[]',
                RadiantBansJson TEXT NOT NULL DEFAULT '[]',
                DireBansJson TEXT NOT NULL DEFAULT '[]',
                DraftJson TEXT NOT NULL,
                LastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (MatchId)
            )
        `).run();

        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS LiveMatchSnapshotDraft (
                SnapshotId INTEGER NOT NULL,
                MatchId INTEGER NOT NULL,
                RadiantPicksJson TEXT NOT NULL DEFAULT '[]',
                DirePicksJson TEXT NOT NULL DEFAULT '[]',
                RadiantBansJson TEXT NOT NULL DEFAULT '[]',
                DireBansJson TEXT NOT NULL DEFAULT '[]',
                DraftJson TEXT NOT NULL,
                PRIMARY KEY (SnapshotId)
            )
        `).run();

        this.db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_LiveMatchSnapshotPlayer_MatchId_SnapshotId
            ON LiveMatchSnapshotPlayer (MatchId, SnapshotId)
        `).run();

        this.db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_LiveMatchSnapshotDraft_MatchId_SnapshotId
            ON LiveMatchSnapshotDraft (MatchId, SnapshotId)
        `).run();

        this.db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_LiveMatchSnapshots_CreatedAt
            ON LiveMatchSnapshots (CreatedAt)
        `).run();
    }

    preloadData(){
        const users = this.queryDatabase('SELECT * FROM PlayerInfo');
        const teams = this.queryDatabase('SELECT * FROM Team');
        const teamNames = this.queryDatabase('SELECT * FROM TeamInfo');
        const matches = this.queryDatabase('SELECT MatchId FROM MatchLeague');
        const leagues = this.queryDatabase('SELECT LeagueId from LeagueInfo');
        const matchDetails = this.queryDatabase('SELECT DISTINCT MatchId from MatchPlayer');

        return {
            users,
            teams,
            teamNames,
            matches,
            leagues,
            matchDetails
        };
    }

    queryDatabase(query, params = []) {
        try {
            const stmt = this.db.prepare(query);
            const results = stmt.all(...params);
            return results;
        } catch (err) {
            console.log(`Error executing query: ${query} with params ${JSON.stringify(params)}: ${err}`);
            return [];
        }
    }

    search(query){
        try{
            
            const users = this.queryDatabase(
                `SELECT PlayerId AS id, PlayerName AS name, 'player' AS type
                FROM PlayerInfo
                WHERE PlayerName LIKE ?`,
                [`%${query}%`]
            );

            const leagues = this.queryDatabase(
                `SELECT LeagueId AS id, LeagueName AS name, 'league' AS type
                FROM LeagueInfo
                WHERE LeagueName LIKE ?`,
                [`%${query}%`]
            );

            const matches = this.queryDatabase(
                `SELECT MatchId as id, MatchId as name, 'match' AS type
                FROM MatchTeam
                WHERE MatchId LIKE ?`,
                [`${query}%`]
            );

            const teams = this.queryDatabase(
                `SELECT TeamId AS id, TeamName AS name, 'team' AS type
                FROM TeamInfo
                WHERE TeamName LIKE ?`,
                [`%${query}%`]
            );

            const heroes = this.queryDatabase(
                `SELECT HeroId AS id, HeroName AS name, 'hero' AS type
                FROM HeroInfo
                WHERE HeroName LIKE ?`,
                [`%${query}%`]
            );

            const results = [...teams, ...leagues, ...users, ...heroes];

            return results;
        }catch (err) {
            console.error("Search error:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    };


    getUnParsedMatchIds() {
        return this.queryDatabase(`SELECT DISTINCT mp.MatchId
                                        FROM MatchLeague mp
                                        WHERE NOT EXISTS (
                                            SELECT 1
                                            FROM MatchPlayer ml
                                            WHERE ml.MatchId = mp.MatchId
                                        );`);
    }

    getTeamInfo(teamId) {
        return this.queryDatabase(
            `SELECT ti.TeamName
             FROM TeamInfo ti 
             WHERE ti.TeamId = ?`,
            [teamId]
        );
    }

    getCurrentLeague() {
        return this.queryDatabase(
            `SELECT LeagueId from LeagueInfo ORDER BY LeagueId DESC LIMIT 1`
            );
    }

    getLeagueInfo(){
        return this.queryDatabase(
            `SELECT DISTINCT li.LeagueId, li.LeagueName from LeagueInfo li
                ORDER BY li.LeagueId DESC`
        );
    }

    getLeaguesByTeam(teamId) {
         return this.queryDatabase(
            `SELECT DISTINCT li.LeagueId, li.LeagueName from LeagueInfo li
                JOIN MatchLeague ml on li.LeagueId = ml.LeagueId
                JOIN MatchTeam mt on ml.MatchId = mt.MatchId
                WHERE mt.TeamRad = ? OR mt.TeamDire = ?
                ORDER BY li.LeagueId DESC`,
            [teamId,teamId]
        );
    }

    getPlayerInfo(userId){
        return this.queryDatabase(
            `SELECT * FROM PlayerInfo where PlayerId = ?
            `,
            [userId]
        );
    }

    getMostRecentMatch() {
        const rows = this.queryDatabase(
            `SELECT MatchId 
            FROM MatchLeague 
            WHERE LeagueId IN (
                SELECT LeagueId 
                FROM LeagueInfo 
                ORDER BY LeagueId DESC 
                LIMIT 1
            ) 
            ORDER BY MatchId DESC 
            LIMIT 1`
        );

        if (rows.length > 0) {
            return rows[0].MatchId; // extract the MatchId from the first row
        } else {
            return null; // no rows found
        }
    }

    getPlayerByAccountId(id) {
        return this.queryDatabase(
            `SELECT mp.MatchId, pi.PlayerName, pi.PlayerId, hi.HeroName, mp.Kills, mp.Deaths, mp.Assists,
                    mp.Lasthits, mp.HeroDamage, mp.TowerDamage, mp.Healing, mp.GPM, mp.XPM,
                    hi.HeroId, mp.Winner, li.LeagueName, li.LeagueId
             FROM MatchPlayer mp
             JOIN PlayerInfo pi ON mp.PlayerId = pi.PlayerId
             JOIN HeroInfo hi ON mp.HeroId = hi.HeroId
             JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
             JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
             WHERE mp.PlayerId = ?
             ORDER BY li.LeagueId DESC`,
            [id]
        );
    }

    getHeroById(id) {
        return this.queryDatabase(
            `SELECT pi.PlayerName, pi.PlayerId, hi.HeroName, mp.Kills, mp.Deaths, mp.Assists,
                    mp.Lasthits, mp.HeroDamage, mp.TowerDamage, mp.Healing, mp.GPM, mp.XPM,
                    hi.HeroId, mp.Winner, li.LeagueName, li.LeagueId,ml.MatchId
             FROM MatchPlayer mp
             JOIN PlayerInfo pi ON mp.PlayerId = pi.PlayerId
             JOIN HeroInfo hi ON mp.HeroId = hi.HeroId
             JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
             JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
             WHERE mp.HeroId = ?
             ORDER BY li.LeagueId DESC`,
            [id]
        );
    }

    getLastNightSeries(){
        return this.queryDatabase(`
            WITH SeriesResults AS (
                SELECT 
                    SI.SeriesId,
                    SI.Team1, -- Include Team1 and Team2 in the results set
                    SI.Team2,
                    SUM(CASE WHEN mt.WinnerId = SI.Team1 THEN 1 ELSE 0 END) as Team1Wins,
                    SUM(CASE WHEN mt.WinnerId = SI.Team2 THEN 1 ELSE 0 END) as Team2Wins
                FROM SeriesInfo SI
                JOIN SeriesMatch SM ON SI.SeriesId = SM.SeriesId
                JOIN MatchTeam mt on mt.MatchId = SM.MatchId
                WHERE date(SI.DateCreated) = date('now', '-1 day')
                GROUP BY SI.SeriesId, SI.Team1, SI.Team2 -- Group by teams to avoid ambiguity
            )
            SELECT
                sr.SeriesId,
                sr.Team1,
                sr.Team2,
                sr.Team1Wins,
                sr.Team2Wins,
                -- Now the aliases are available for the final calculation
                CASE 
                    WHEN sr.Team1Wins = 2 THEN sr.Team1 
                    WHEN sr.Team2Wins = 2 THEN sr.Team2 
                    -- Add a tie/not-finished condition if necessary
                    ELSE NULL 
                END AS WinnerId 
            FROM SeriesResults sr
        `);
    }

    getAllPlayers(leagueId){
        let baseQuery = `
            SELECT 
            pi.PlayerId, 
            pi.PlayerName, 
            COUNT(*) as GamesPlayed,
            ROUND(100.0 * SUM(mp.Winner) / COUNT(*), 2) AS WinPercentage
            FROM PlayerInfo pi
            JOIN MatchPlayer mp on pi.PlayerId = mp.PlayerId
            JOIN MatchLeague ml on ml.MatchId = mp.MatchId`;
        
        const params = [];

        if (leagueId && leagueId !== 'all') {
            baseQuery += ` WHERE ml.LeagueId = ?`;
            params.push(leagueId);
        }

        baseQuery += `
            GROUP BY pi.PlayerId, pi.PlayerName
            ORDER BY GamesPlayed DESC
        `;

        return this.queryDatabase(baseQuery, params);
    }

    getPlayerDetails(playerId, leagueId) {
    if (!leagueId || leagueId === 'all') {
        // return teams
        return this.queryDatabase(`
            SELECT 
            t.TeamId,
            t.TeamName,
            COUNT(DISTINCT mp.MatchId) AS GamesPlayed,
            ROUND(
                AVG(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) * 100, 2
            ) AS WinPercentage
            FROM MatchPlayer mp
            JOIN MatchTeamPlayer mtp 
                ON mtp.MatchId = mp.MatchId AND mtp.PlayerId = mp.PlayerId
            JOIN TeamInfo t 
                ON t.TeamId = mtp.TeamId
            WHERE mp.PlayerId = ?
            GROUP BY t.TeamId
            ORDER BY GamesPlayed DESC;
        `, [playerId]);
    } else {
        // return top heroes for league
        return this.queryDatabase(`
        SELECT
            hi.HeroId,
            hi.HeroName,
            COUNT(DISTINCT mp.MatchId) AS GamesPlayed,
            ROUND(AVG(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END)*100, 2) AS WinPercentage,
            AVG(mp.Kills) AS AvgKills,
            AVG(mp.Deaths) AS AvgDeaths,
            AVG(mp.Assists) AS AvgAssists,
            AVG(mp.LastHits) AS AvgLastHits,
            AVG(mp.GPM) AS AvgGPM,
            AVG(mp.XPM) AS AvgXPM
        FROM MatchPlayer mp
        JOIN HeroInfo hi ON hi.HeroId = mp.HeroId
        JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
        WHERE mp.PlayerId = ? AND ml.LeagueId = ?
        GROUP BY mp.HeroId
        ORDER BY GamesPlayed DESC
        LIMIT 5;
        `, [playerId, leagueId]);
    }
    }

    getHeadToHeadMatches(p1Id, p2Id) {
        return this.queryDatabase(`
            SELECT 
                ml.DatePlayed,
                ml.MatchId,
                mp1.PlayerId as P1Id,
                ti1.TeamName as P1Team,
                mp2.PlayerId as P2Id,
                ti2.TeamName as P2Team,
                mp1.Winner as P1Won,
                (mp1.Kills || '/' || mp1.Deaths || '/' || mp1.Assists) as P1KDA,
                (mp2.Kills || '/' || mp2.Deaths || '/' || mp2.Assists) as P2KDA
            FROM MatchPlayer mp1
            JOIN MatchPlayer mp2 ON mp1.MatchId = mp2.MatchId
            JOIN MatchLeague ml on mp1.MatchId = ml.MatchId
            -- Get Team Names for the match
            JOIN MatchTeamPlayer mtp1 ON mtp1.MatchId = mp1.MatchId AND mtp1.PlayerId = mp1.PlayerId
            JOIN MatchTeamPlayer mtp2 ON mtp2.MatchId = mp2.MatchId AND mtp2.PlayerId = mp2.PlayerId
            JOIN TeamInfo ti1 on mtp1.TeamId = ti1.TeamId
            JOIN TeamInfo ti2 on mtp2.TeamId = ti2.TeamId
            WHERE mp1.PlayerId = ? 
              AND mp2.PlayerId = ?
              AND mtp1.TeamId != mtp2.TeamId -- Ensure they were on opposite teams
            ORDER BY ml.DatePlayed DESC,ml.MatchId DESC
        `, [p1Id, p2Id]);
    }

    getPlayerHeroesByAccountId(playerId){
        let baseQuery = `
            SELECT
            mp.HeroId,
            h.HeroName,
            COUNT(mp.MatchId) AS GamesPlayed,
            ROUND(100.0 * SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) / COUNT(mp.MatchId), 2) AS WinPercentage,
            ROUND(AVG(mp.Kills), 2) AS AvgKills,
            ROUND(AVG(mp.Deaths), 2) AS AvgDeaths,
            ROUND(AVG(mp.Assists), 2) AS AvgAssists,
            ROUND(AVG(mp.Lasthits), 2) AS AvgLastHits,
            ROUND(AVG(mp.GPM), 2) AS AvgGPM,
            ROUND(AVG(mp.XPM), 2) AS AvgXPM
            FROM MatchPlayer mp
            JOIN HeroInfo h ON mp.HeroId = h.HeroId
            WHERE mp.PlayerId = ?
            GROUP BY mp.HeroId
            ORDER BY GamesPlayed DESC;
        `;

        const params = [playerId];

        return this.queryDatabase(baseQuery, params);
    }

    getHeroesPlayerByHeroId(heroId){
        let baseQuery = `
            SELECT
            mp.PlayerId,
            pi.PlayerName,
            COUNT(mp.MatchId) AS GamesPlayed,
            ROUND(100.0 * SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) / COUNT(mp.MatchId), 2) AS WinPercentage,
            ROUND(AVG(mp.Kills), 2) AS AvgKills,
            ROUND(AVG(mp.Deaths), 2) AS AvgDeaths,
            ROUND(AVG(mp.Assists), 2) AS AvgAssists,
            ROUND(AVG(mp.Lasthits), 2) AS AvgLastHits,
            ROUND(AVG(mp.GPM), 2) AS AvgGPM,
            ROUND(AVG(mp.XPM), 2) AS AvgXPM
            FROM MatchPlayer mp
            JOIN HeroInfo h ON mp.HeroId = h.HeroId
            JOIN PlayerInfo pi on pi.PlayerId = mp.PlayerId
            WHERE mp.HeroId = ?
            GROUP BY mp.PlayerId
            ORDER BY GamesPlayed DESC;
        `;

        const params = [heroId];

        return this.queryDatabase(baseQuery, params);
    }

    getHeroesTeamByHeroId(heroId){
        let baseQuery = `
            SELECT
            ti.TeamId,
            ti.TeamName,
            COUNT(DISTINCT mp.MatchId) AS GamesPlayed,
            ROUND(100.0 * SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) / COUNT(mp.MatchId), 2) AS WinPercentage,
            ROUND(AVG(mp.Kills), 2) AS AvgKills,
            ROUND(AVG(mp.Deaths), 2) AS AvgDeaths,
            ROUND(AVG(mp.Assists), 2) AS AvgAssists,
            ROUND(AVG(mp.LastHits), 2) AS AvgLastHits,
            ROUND(AVG(mp.GPM), 2) AS AvgGPM,
            ROUND(AVG(mp.XPM), 2) AS AvgXPM
            FROM MatchPlayer mp
            JOIN MatchTeamPlayer mtp ON mtp.PlayerId = mp.PlayerId AND mp.MatchId = mtp.MatchId
            JOIN TeamInfo ti on mtp.TeamId = ti.TeamId
            JOIN HeroInfo h ON mp.HeroId = h.HeroId
            WHERE mp.HeroId = ?
            GROUP BY h.HeroId, h.HeroName, ti.TeamName ORDER BY GamesPlayed DESC;
        `;

        const params = [heroId];

        return this.queryDatabase(baseQuery, params);
    }

    getHeroesLeagueByHeroId(heroId){
        let baseQuery = `
            SELECT
            li.LeagueName,
            li.LeagueId,
            COUNT(DISTINCT mp.MatchId) AS GamesPlayed,
            ROUND(100.0 * SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) / COUNT(mp.MatchId), 2) AS WinPercentage,
            ROUND(AVG(mp.Kills), 2) AS AvgKills,
            ROUND(AVG(mp.Deaths), 2) AS AvgDeaths,
            ROUND(AVG(mp.Assists), 2) AS AvgAssists,
            ROUND(AVG(mp.LastHits), 2) AS AvgLastHits,
            ROUND(AVG(mp.GPM), 2) AS AvgGPM,
            ROUND(AVG(mp.XPM), 2) AS AvgXPM
            FROM MatchPlayer mp
            JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
            JOIN LeagueInfo li on li.LeagueId = ml.LeagueId
            JOIN HeroInfo h ON mp.HeroId = h.HeroId
            WHERE mp.HeroId = ?
            GROUP BY h.HeroId, h.HeroName, li.LeagueName ORDER BY GamesPlayed DESC;
        `;

        const params = [heroId];

        return this.queryDatabase(baseQuery, params);
    }
    
    getPlayerStats(playerId) {
        try {
            const stmt = this.db.prepare(`
                SELECT 
                    p.PlayerName,
                    COUNT(*) as games_played,
                    SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) as wins,
                    AVG(mp.Kills) as avg_kills,
                    AVG(mp.Deaths) as avg_deaths,
                    AVG(mp.Assists) as avg_assists,
                    AVG(mp.GPM) as avg_gpm,
                    AVG(mp.Lasthits) as avg_cs
                FROM MatchPlayer mp
                JOIN PlayerInfo p ON mp.PlayerId = p.PlayerId
                WHERE p.PlayerId = ?
                ORDER BY mp.MatchId DESC
                LIMIT 20
            `);
            return stmt.get(playerId);
        } catch (err) {
            console.error(`Error fetching stats for player ${playerId}:`, err);
            return null;
        }
    }

    getPlayerSeasonStatsByAccountId(playerId){
        let baseQuery = `
            SELECT 
                h.HeroName,
                COUNT(*) AS games_played,
                SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) AS wins,
                ROUND(100.0 * SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) / COUNT(mp.MatchId), 2) AS WinPercentage,
                ROUND(AVG(mp.Kills), 2) AS AvgKills,
                ROUND(AVG(mp.Deaths), 2) AS AvgDeaths,
                ROUND(AVG(mp.Assists), 2) AS AvgAssists,
                ROUND(AVG(mp.Lasthits), 2) AS AvgLastHits,
                ROUND(AVG(mp.GPM), 2) AS AvgGPM,
                ROUND(AVG(mp.XPM), 2) AS AvgXPM
            FROM MatchPlayer mp
            JOIN MatchLeague ml ON mp.MatchId = ml.MatchId
            JOIN LeagueInfo l ON ml.LeagueId = l.LeagueId
            JOIN HeroInfo h ON mp.HeroId = h.HeroId
            WHERE l.Active = 1
              AND mp.PlayerId = ?
            GROUP BY mp.HeroId, h.HeroName
            ORDER BY WinPercentage ASC;
            `

            const params = [playerId];

            return this.queryDatabase(baseQuery, params);
    }

    getHeroes(){
        return this.queryDatabase(`
            SELECT HeroId, HeroName
            FROM HeroInfo
            ORDER BY HeroName ASC;`);

    }

    getAllTeamsBase(){
        return this.queryDatabase(`
            SELECT TeamRad as TeamId from MatchTeam
            UNION 
            SELECT TeamDire as TeamId from MatchTeam`);
    }

    getActiveLeague(){
        return this.queryDatabase(`
            SELECT LeagueId, LeagueName
            FROM LeagueInfo 
            WHERE Active = 1`);
    }

    InsertNewLeague(leagueId, leagueName){
        const insertLeague = this.db.transaction((id, name) => {
            this.db.prepare(`
                INSERT INTO LeagueInfo (LeagueId, LeagueName, Active)
                VALUES (?, ?, 1)
            `).run(id, name);

            return this.db.prepare(`
                SELECT LeagueId, LeagueName, Active
                FROM LeagueInfo
                WHERE LeagueId = ?
            `).get(id);
        });

        return insertLeague(leagueId, leagueName);
    }

    getLiveMatchCurrentState(matchId){
        return this.db.prepare(`
            SELECT MatchId, SnapshotHash
            FROM LiveMatchCurrentState
            WHERE MatchId = ?
        `).get(matchId);
    }

    getLiveMatchCount(){
        return this.db.prepare(`
            SELECT COUNT(*) AS Count
            FROM LiveMatchCurrentState
        `).get()?.Count || 0;
    }

    getLiveMatchCurrentStates(){
        const matches = this.queryDatabase(`
            SELECT *
            FROM LiveMatchCurrentState
            ORDER BY LastUpdated DESC
        `);

        return matches.map((match) => ({
            ...match,
            Players: this.getLiveMatchCurrentPlayers(match.MatchId),
            Draft: this.getLiveMatchCurrentDraft(match.MatchId)
        }));
    }

    getRecentLiveMatchSnapshots(hours = 4){
        const recentHours = Number.isFinite(Number(hours)) ? Number(hours) : 4;
        const snapshots = this.queryDatabase(`
            SELECT lms.*
            FROM LiveMatchSnapshots lms
            JOIN (
                SELECT MatchId, MAX(SnapshotId) AS LatestSnapshotId
                FROM LiveMatchSnapshots
                WHERE CreatedAt >= datetime('now', ?)
                GROUP BY MatchId
            ) latest
                ON latest.LatestSnapshotId = lms.SnapshotId
            WHERE NOT EXISTS (
                SELECT 1
                FROM LiveMatchCurrentState lmcs
                WHERE lmcs.MatchId = lms.MatchId
            )
            ORDER BY lms.CreatedAt DESC
        `, [`-${recentHours} hours`]);

        return snapshots.map((snapshot) => ({
            ...snapshot,
            Players: this.getLiveMatchSnapshotPlayers(snapshot.SnapshotId),
            Draft: this.getLiveMatchSnapshotDraft(snapshot.SnapshotId)
        }));
    }

    getAllRecentLiveMatchSnapshots(){
        const snapshots = this.queryDatabase(`
            SELECT lms.*
            FROM LiveMatchSnapshots lms
            JOIN (
                SELECT MatchId, MAX(SnapshotId) AS LatestSnapshotId
                FROM LiveMatchSnapshots
                GROUP BY MatchId
            ) latest
                ON latest.LatestSnapshotId = lms.SnapshotId
            WHERE NOT EXISTS (
                SELECT 1
                FROM LiveMatchCurrentState lmcs
                WHERE lmcs.MatchId = lms.MatchId
            )
            ORDER BY lms.CreatedAt DESC, lms.SnapshotId DESC
        `);

        return snapshots.map((snapshot) => ({
            ...snapshot,
            Players: this.getLiveMatchSnapshotPlayers(snapshot.SnapshotId),
            Draft: this.getLiveMatchSnapshotDraft(snapshot.SnapshotId)
        }));
    }

    getLiveMatchSnapshots(matchId){
        const snapshots = this.queryDatabase(`
            SELECT *
            FROM LiveMatchSnapshots
            WHERE MatchId = ?
            ORDER BY CreatedAt ASC
        `, [matchId]);

        return snapshots.map((snapshot) => ({
            ...snapshot,
            Players: this.getLiveMatchSnapshotPlayers(snapshot.SnapshotId),
            Draft: this.getLiveMatchSnapshotDraft(snapshot.SnapshotId)
        }));
    }

    deleteLiveMatchSnapshotsOlderThan(retentionDays = 7){
        const days = Number(retentionDays);
        if (!Number.isInteger(days) || days < 1) {
            throw new Error('Snapshot retention must be a positive whole number of days');
        }

        const cutoffModifier = `-${days} days`;
        const deleteExpiredSnapshots = this.db.transaction((modifier) => {
            const cutoff = this.db.prepare(`
                SELECT datetime('now', ?) AS Cutoff
            `).get(modifier).Cutoff;

            const players = this.db.prepare(`
                DELETE FROM LiveMatchSnapshotPlayer
                WHERE SnapshotId IN (
                    SELECT SnapshotId
                    FROM LiveMatchSnapshots
                    WHERE CreatedAt < ?
                )
            `).run(cutoff).changes;

            const drafts = this.db.prepare(`
                DELETE FROM LiveMatchSnapshotDraft
                WHERE SnapshotId IN (
                    SELECT SnapshotId
                    FROM LiveMatchSnapshots
                    WHERE CreatedAt < ?
                )
            `).run(cutoff).changes;

            const snapshots = this.db.prepare(`
                DELETE FROM LiveMatchSnapshots
                WHERE CreatedAt < ?
            `).run(cutoff).changes;

            return { snapshots, players, drafts };
        });

        return deleteExpiredSnapshots(cutoffModifier);
    }

    getLiveMatchCurrentPlayers(matchId){
        return this.queryDatabase(`
            SELECT *
            FROM LiveMatchCurrentPlayer
            WHERE MatchId = ?
            ORDER BY Team ASC, PlayerSlot ASC, AccountId ASC
        `, [matchId]);
    }

    getLiveMatchSnapshotPlayers(snapshotId){
        return this.queryDatabase(`
            SELECT *
            FROM LiveMatchSnapshotPlayer
            WHERE SnapshotId = ?
            ORDER BY Team ASC, PlayerSlot ASC, AccountId ASC
        `, [snapshotId]);
    }

    getLiveMatchCurrentDraft(matchId){
        return this.queryDatabase(`
            SELECT *
            FROM LiveMatchCurrentDraft
            WHERE MatchId = ?
        `, [matchId])[0] || null;
    }

    getLiveMatchSnapshotDraft(snapshotId){
        return this.queryDatabase(`
            SELECT *
            FROM LiveMatchSnapshotDraft
            WHERE SnapshotId = ?
        `, [snapshotId])[0] || null;
    }

    insertLiveMatchSnapshot(matchData){
        const result = this.db.prepare(`
            INSERT INTO LiveMatchSnapshots (
                MatchId,
                LeagueId,
                LobbyId,
                RadiantTeamId,
                DireTeamId,
                RadiantScore,
                DireScore,
                GameDuration,
                StreamDelaySeconds,
                RadiantTowerState,
                DireTowerState,
                RadiantBarracksState,
                DireBarracksState,
                SnapshotHash,
                ResponseJson
            )
            VALUES (
                @MatchId,
                @LeagueId,
                @LobbyId,
                @RadiantTeamId,
                @DireTeamId,
                @RadiantScore,
                @DireScore,
                @GameDuration,
                @StreamDelaySeconds,
                @RadiantTowerState,
                @DireTowerState,
                @RadiantBarracksState,
                @DireBarracksState,
                @SnapshotHash,
                @ResponseJson
            )
        `).run({
            MatchId: matchData.MatchId,
            LeagueId: matchData.LeagueId,
            LobbyId: matchData.LobbyId,
            RadiantTeamId: matchData.RadiantTeamId,
            DireTeamId: matchData.DireTeamId,
            RadiantScore: matchData.RadiantScore,
            DireScore: matchData.DireScore,
            GameDuration: matchData.GameDuration,
            StreamDelaySeconds: matchData.StreamDelaySeconds,
            RadiantTowerState: matchData.RadiantTowerState,
            DireTowerState: matchData.DireTowerState,
            RadiantBarracksState: matchData.RadiantBarracksState,
            DireBarracksState: matchData.DireBarracksState,
            SnapshotHash: matchData.SnapshotHash,
            ResponseJson: matchData.ResponseJson
        });

        return result.lastInsertRowid;
    }

    upsertLiveMatchCurrentState(matchData){
        return this.db.prepare(`
            INSERT INTO LiveMatchCurrentState (
                MatchId,
                LeagueId,
                LobbyId,
                RadiantTeamId,
                DireTeamId,
                RadiantTeamName,
                DireTeamName,
                RadiantScore,
                DireScore,
                GameDuration,
                StreamDelaySeconds,
                RadiantTowerState,
                DireTowerState,
                RadiantBarracksState,
                DireBarracksState,
                SnapshotHash,
                ResponseJson
            )
            VALUES (
                @MatchId,
                @LeagueId,
                @LobbyId,
                @RadiantTeamId,
                @DireTeamId,
                @RadiantTeamName,
                @DireTeamName,
                @RadiantScore,
                @DireScore,
                @GameDuration,
                @StreamDelaySeconds,
                @RadiantTowerState,
                @DireTowerState,
                @RadiantBarracksState,
                @DireBarracksState,
                @SnapshotHash,
                @ResponseJson
            )
            ON CONFLICT(MatchId) DO UPDATE SET
                LeagueId = excluded.LeagueId,
                LobbyId = excluded.LobbyId,
                RadiantTeamId = excluded.RadiantTeamId,
                DireTeamId = excluded.DireTeamId,
                RadiantTeamName = excluded.RadiantTeamName,
                DireTeamName = excluded.DireTeamName,
                RadiantScore = excluded.RadiantScore,
                DireScore = excluded.DireScore,
                GameDuration = excluded.GameDuration,
                StreamDelaySeconds = excluded.StreamDelaySeconds,
                RadiantTowerState = excluded.RadiantTowerState,
                DireTowerState = excluded.DireTowerState,
                RadiantBarracksState = excluded.RadiantBarracksState,
                DireBarracksState = excluded.DireBarracksState,
                SnapshotHash = excluded.SnapshotHash,
                ResponseJson = excluded.ResponseJson,
                LastUpdated = CURRENT_TIMESTAMP
        `).run(matchData);
    }

    touchLiveMatchCurrentState(matchId){
        return this.db.prepare(`
            UPDATE LiveMatchCurrentState
            SET LastUpdated = CURRENT_TIMESTAMP
            WHERE MatchId = ?
        `).run(matchId);
    }

    pruneMissingLiveMatches(activeMatchIds = [], staleSeconds = 120, leagueId = null){
        const prune = this.db.transaction((matchIds, seconds, activeLeagueId) => {
            const staleModifier = `-${Number(seconds) || 120} seconds`;
            const staleMatches = this.queryDatabase(`
                SELECT MatchId
                FROM LiveMatchCurrentState
                WHERE LastUpdated < datetime('now', ?)
                ${activeLeagueId ? 'AND LeagueId = ?' : ''}
            `, activeLeagueId ? [staleModifier, activeLeagueId] : [staleModifier]);
            const activeIds = new Set(matchIds.map((id) => Number(id)));
            const removeIds = staleMatches
                .map((match) => Number(match.MatchId))
                .filter((matchId) => !activeIds.has(matchId));

            if (!removeIds.length) return 0;

            const deleteCurrentPlayers = this.db.prepare(`
                DELETE FROM LiveMatchCurrentPlayer
                WHERE MatchId = ?
            `);
            const deleteCurrentDraft = this.db.prepare(`
                DELETE FROM LiveMatchCurrentDraft
                WHERE MatchId = ?
            `);
            const deleteCurrentState = this.db.prepare(`
                DELETE FROM LiveMatchCurrentState
                WHERE MatchId = ?
            `);

            removeIds.forEach((matchId) => {
                deleteCurrentPlayers.run(matchId);
                deleteCurrentDraft.run(matchId);
                deleteCurrentState.run(matchId);
            });

            return removeIds.length;
        });

        return prune(activeMatchIds, staleSeconds, leagueId);
    }

    replaceLiveMatchCurrentPlayers(matchId, players){
        const deleteStmt = this.db.prepare(`
            DELETE FROM LiveMatchCurrentPlayer
            WHERE MatchId = ?
        `);
        const insertStmt = this.db.prepare(`
            INSERT INTO LiveMatchCurrentPlayer (
                MatchId,
                AccountId,
                PlayerName,
                Team,
                PlayerSlot,
                HeroId,
                Kills,
                Deaths,
                Assists,
                LastHits,
                Denies,
                Gold,
                Level,
                GPM,
                XPM,
                NetWorth,
                RespawnTimer,
                PositionX,
                PositionY
            )
            VALUES (
                @MatchId,
                @AccountId,
                @PlayerName,
                @Team,
                @PlayerSlot,
                @HeroId,
                @Kills,
                @Deaths,
                @Assists,
                @LastHits,
                @Denies,
                @Gold,
                @Level,
                @GPM,
                @XPM,
                @NetWorth,
                @RespawnTimer,
                @PositionX,
                @PositionY
            )
        `);

        deleteStmt.run(matchId);
        players.forEach((player) => insertStmt.run(player));
    }

    insertLiveMatchSnapshotPlayers(snapshotId, players){
        const insertStmt = this.db.prepare(`
            INSERT INTO LiveMatchSnapshotPlayer (
                SnapshotId,
                MatchId,
                AccountId,
                PlayerName,
                Team,
                PlayerSlot,
                HeroId,
                Kills,
                Deaths,
                Assists,
                LastHits,
                Denies,
                Gold,
                Level,
                GPM,
                XPM,
                NetWorth,
                RespawnTimer,
                PositionX,
                PositionY
            )
            VALUES (
                @SnapshotId,
                @MatchId,
                @AccountId,
                @PlayerName,
                @Team,
                @PlayerSlot,
                @HeroId,
                @Kills,
                @Deaths,
                @Assists,
                @LastHits,
                @Denies,
                @Gold,
                @Level,
                @GPM,
                @XPM,
                @NetWorth,
                @RespawnTimer,
                @PositionX,
                @PositionY
            )
        `);

        players.forEach((player) => insertStmt.run({
            ...player,
            SnapshotId: snapshotId
        }));
    }

    replaceLiveMatchSnapshotPlayers(snapshotId, players){
        const deleteStmt = this.db.prepare(`
            DELETE FROM LiveMatchSnapshotPlayer
            WHERE SnapshotId = ?
        `);

        deleteStmt.run(snapshotId);
        this.insertLiveMatchSnapshotPlayers(snapshotId, players);
    }

    replaceLiveMatchCurrentDraft(matchId, draft){
        return this.db.prepare(`
            INSERT INTO LiveMatchCurrentDraft (
                MatchId,
                RadiantPicksJson,
                DirePicksJson,
                RadiantBansJson,
                DireBansJson,
                DraftJson
            )
            VALUES (
                @MatchId,
                @RadiantPicksJson,
                @DirePicksJson,
                @RadiantBansJson,
                @DireBansJson,
                @DraftJson
            )
            ON CONFLICT(MatchId) DO UPDATE SET
                RadiantPicksJson = excluded.RadiantPicksJson,
                DirePicksJson = excluded.DirePicksJson,
                RadiantBansJson = excluded.RadiantBansJson,
                DireBansJson = excluded.DireBansJson,
                DraftJson = excluded.DraftJson,
                LastUpdated = CURRENT_TIMESTAMP
        `).run(this.serializeLiveMatchDraft(matchId, draft));
    }

    insertLiveMatchSnapshotDraft(snapshotId, draft){
        return this.db.prepare(`
            INSERT INTO LiveMatchSnapshotDraft (
                SnapshotId,
                MatchId,
                RadiantPicksJson,
                DirePicksJson,
                RadiantBansJson,
                DireBansJson,
                DraftJson
            )
            VALUES (
                @SnapshotId,
                @MatchId,
                @RadiantPicksJson,
                @DirePicksJson,
                @RadiantBansJson,
                @DireBansJson,
                @DraftJson
            )
        `).run({
            ...this.serializeLiveMatchDraft(draft?.MatchId, draft),
            SnapshotId: snapshotId
        });
    }

    replaceLiveMatchSnapshotDraft(snapshotId, draft){
        const deleteStmt = this.db.prepare(`
            DELETE FROM LiveMatchSnapshotDraft
            WHERE SnapshotId = ?
        `);

        deleteStmt.run(snapshotId);
        this.insertLiveMatchSnapshotDraft(snapshotId, draft);
    }

    serializeLiveMatchDraft(matchId, draft){
        const radiantPicks = draft?.RadiantPicks || [];
        const direPicks = draft?.DirePicks || [];
        const radiantBans = draft?.RadiantBans || [];
        const direBans = draft?.DireBans || [];
        const draftJson = draft?.DraftJson || JSON.stringify({
            radiant: {
                picks: radiantPicks,
                bans: radiantBans
            },
            dire: {
                picks: direPicks,
                bans: direBans
            }
        });

        return {
            MatchId: matchId,
            RadiantPicksJson: JSON.stringify(radiantPicks),
            DirePicksJson: JSON.stringify(direPicks),
            RadiantBansJson: JSON.stringify(radiantBans),
            DireBansJson: JSON.stringify(direBans),
            DraftJson: draftJson
        };
    }

    recordLiveMatchSnapshot(matchData){
        const recordSnapshot = this.db.transaction((data) => {
            const currentState = this.getLiveMatchCurrentState(data.MatchId);
            if (currentState?.SnapshotHash === data.SnapshotHash) {
                this.touchLiveMatchCurrentState(data.MatchId);
                return false;
            }

            const snapshotId = this.insertLiveMatchSnapshot(data);
            this.insertLiveMatchSnapshotPlayers(snapshotId, data.Players || []);
            this.insertLiveMatchSnapshotDraft(snapshotId, data.Draft || { MatchId: data.MatchId });
            this.upsertLiveMatchCurrentState(data);
            this.replaceLiveMatchCurrentPlayers(data.MatchId, data.Players || []);
            this.replaceLiveMatchCurrentDraft(data.MatchId, data.Draft || { MatchId: data.MatchId });
            return true;
        });

        return recordSnapshot(matchData);
    }

    getActiveLeagueBoundaries(){
        return this.queryDatabase(`
                SELECT lsb.LeagueId, lsb.GroupEndMatchId, lsb.TieBreakerEndMatchId
                    FROM LeagueStageBoundaries lsb
                    JOIN LeagueInfo li on lsb.LeagueId = li.LeagueId
                    WHERE li.Active = 1
            `)
    }

    getTieBreakerMatches(leagueId,groupEndMatchId,tieBreakerEndMatchId){
        return this.queryDatabase(`
           SELECT 
                mt.MatchId,
                mt.TeamRad AS TeamA,
                mt.TeamDire AS TeamB,
                mt.WinnerId,
                tiA.TeamName AS TeamAName,
                tiB.TeamName AS TeamBName
            FROM MatchTeam mt
            JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
            JOIN TeamInfo tiA ON tiA.TeamId = mt.TeamRad
            JOIN TeamInfo tiB ON tiB.TeamId = mt.TeamDire
            WHERE ml.LeagueId = ?
                AND mt.MatchId > ?
                AND mt.MatchId <= ?
            ORDER BY mt.MatchId ASC 
            `,[leagueId,groupEndMatchId,tieBreakerEndMatchId]);
    }

    getPlayoffBracket(leagueId){
        return this.queryDatabase(`
           SELECT 
                pb.PlayoffStructure
            FROM PlayoffBracket pb
            WHERE pb.LeagueId = ?
            `, [leagueId]);
    }

    adminGetCurrentPlayoffBracket(){
        return this.queryDatabase(`
           SELECT 
                pb.PlayoffStructure
            FROM PlayoffBracket pb
            JOIN LeagueInfo li ON li.LeagueId = pb.LeagueId
            WHERE li.Active = 1
            `);
    }

    adminGetCurrentPlayoffTeams(){
        return this.queryDatabase(`
            SELECT 
                ps.TeamId,
                ti.TeamName,
                ps.Seed,
                ps.Bracket
            FROM PlayoffSeeding ps
            JOIN (
                SELECT LeagueId, TeamId, MAX(UID) AS LatestUid
                FROM PlayoffSeeding
                GROUP BY LeagueId, TeamId
            ) latest ON latest.LatestUid = ps.UID
            JOIN LeagueInfo li on ps.LeagueId = li.LeagueId
            JOIN TeamInfo ti on ti.TeamId = ps.TeamId
            WHERE li.Active = 1
            ORDER BY
                CASE ps.Bracket
                    WHEN 'upper' THEN 0
                    WHEN 'lower' THEN 1
                    ELSE 2
                END,
                ps.Seed,
                ti.TeamName
            `)
    }

    updateLeagueStageBoundariesTieBreaker(matchId,leagueId){
        this.db.prepare(`
            UPDATE LeagueStageBoundaries
            SET TieBreakerEndMatchId = ?
            WHERE LeagueId = ?
        `).run(matchId, leagueId);
    }

    insertNewLeagueStageBoundaries(leagueId, groupEndMatchId, tieEndMatchId){
        this.db.prepare(`
            INSERT INTO LeagueStageBoundaries (LeagueId, GroupEndMatchId, TieBreakerEndMatchId)
            VALUES (?, ?, ?)
        `).run(leagueId, groupEndMatchId, tieEndMatchId);
    }

    getLeagueStageBoundaries(leagueId){
        return this.queryDatabase(`
            SELECT * FROM LeagueStageBoundaries WHERE LeagueId = ?
        `,[leagueId]);
    }

    closeSeason(leagueId){
        this.db.prepare(`
            UPDATE LeagueInfo
            SET Active = 0
            WHERE LeagueId = ?
        `).run(leagueId);
    }

    //returning all teams that are currently in the active league (can have bad teams)
    getActiveTeams(){
        return this.queryDatabase(`
            SELECT DISTINCT
                TeamId,
                TeamName
            FROM(
                SELECT 
                    mt.TeamRad AS TeamId,
                    ti.TeamName
                FROM MatchTeam mt
                JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
                JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId
                JOIN TeamInfo ti ON ti.TeamId = mt.TeamRad
                WHERE li.Active = 1

                UNION

                SELECT 
                    mt.TeamDire AS TeamId,
                    ti.TeamName
                FROM MatchTeam mt
                JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
                JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId
                JOIN TeamInfo ti ON ti.TeamId = mt.TeamDire
                WHERE li.Active = 1
            )
            ORDER BY TeamName ASC;
            `);
    }

    getActiveTeamsGroups(){
        return this.queryDatabase(`
            SELECT lg.TeamId,lg.GroupId, ls.Wins
            FROM LeagueGroups lg
            JOIN LeagueInfo li on lg.LeagueId = li.LeagueId
            JOIN LeagueStandings ls on li.LeagueId = ls.LeagueId and lg.TeamId = ls.TeamId
            WHERE li.Active = 1
            `)
    }

    getResults(teamA,teamB){
        return this.queryDatabase(`
           SELECT WinnerId
            FROM MatchTeam mt
            JOIN MatchLeague ml ON mt.MatchId = ml.MatchId
            JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
            WHERE li.Active = 1
            AND (
                    (mt.TeamRad = ? AND mt.TeamDire = ?)
                OR (mt.TeamRad = ? AND mt.TeamDire = ?)
            )
            `,[teamA,teamB,teamB,teamA])
    }

    getTeamsMatchEdit(MatchId){
        return this.queryDatabase(`
            SELECT 
                TeamRad, 
                ti1.TeamName as RadTeamName, 
                TeamDire, 
                ti2.TeamName as DireTeamName, 
                WinnerId, 
                ti3.TeamName as WinnerTeamName
            FROM MatchTeam mt
            JOIN TeamInfo ti1 on mt.TeamRad = ti1.TeamId
            JOIN TeamInfo ti2 on mt.TeamDire = ti2.TeamId
            LEFT JOIN TeamInfo ti3 on mt.WinnerId = ti3.TeamId
            WHERE mt.MatchId = ?
        `, [MatchId]);
    };


    getAllTeams(leagueId) {
        let baseQuery = `
            SELECT 
            sub.TeamId,
            sub.TeamName,
            COUNT(*) AS GamesPlayed,
            ROUND(100.0 * SUM(sub.Winner) / COUNT(*), 2) AS WinPercentage
            FROM (
            SELECT 
                mt.TeamRad AS TeamId, 
                COALESCE(lt.DisplayName, ti.TeamName) AS TeamName,
                CASE WHEN mt.TeamRad = mt.WinnerId THEN 1 ELSE 0 END AS Winner,
                li.LeagueId,
                li.LeagueName
            FROM MatchTeam mt
            JOIN TeamInfo ti ON ti.TeamId = mt.TeamRad
            JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
            JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId
            LEFT JOIN LeagueTeamNames lt ON lt.LeagueId = li.LeagueId AND lt.TeamId = mt.TeamRad

            UNION ALL

            SELECT 
                mt.TeamDire AS TeamId, 
                COALESCE(lt.DisplayName, ti.TeamName) AS TeamName,
                CASE WHEN mt.TeamDire = mt.WinnerId THEN 1 ELSE 0 END AS Winner,
                li.LeagueId,
                li.LeagueName
            FROM MatchTeam mt
            JOIN TeamInfo ti ON ti.TeamId = mt.TeamDire
            JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
            JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId
            LEFT JOIN LeagueTeamNames lt ON lt.LeagueId = li.LeagueId AND lt.TeamId = mt.TeamDire
            ) sub
        `;

        const params = [];

        if (leagueId && leagueId !== 'all') {
            baseQuery += ` WHERE sub.LeagueId = ?`;
            params.push(leagueId);
        }

        baseQuery += `
            GROUP BY sub.TeamId, sub.TeamName
            ORDER BY GamesPlayed DESC
        `;

        return this.queryDatabase(baseQuery, params);
    }

    getAllMatches(leagueId){
        let query = `
        SELECT ml.MatchId, radTeam.TeamName as rad_team_name,mt.TeamRad as rad_team_id, direTeam.TeamName as dire_team_name,mt.TeamDire as dire_team_id,
                    CASE 
                        WHEN mt.WinnerId = mt.TeamRad THEN 'r'
                        WHEN mt.WinnerId = mt.TeamDire THEN 'd'
                        ELSE NULL
                    END AS WinnerSide,
                    li.LeagueName,
                    li.LeagueId
             FROM MatchLeague ml 
             JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
             JOIN TeamInfo radTeam ON mt.TeamRad = radTeam.TeamId
             JOIN TeamInfo direTeam ON mt.TeamDire = direTeam.TeamId
             JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId`;

        const params = [];

        if (leagueId && leagueId !== 'all') {
            query += ' AND li.LeagueId = ?';
            params.push(leagueId);
        }

        query += ' ORDER BY ml.MatchId DESC';

        return this.queryDatabase(query, params);
    }


    getLeagueSeriesGroupstage(leagueId){
            return this.queryDatabase(
            `SELECT 
                si.SeriesId,
                si.Team1,
                si.Team2,
                ti1.TeamName AS team_one,
                ti2.TeamName AS team_two,
                si.DateCreated
            FROM SeriesInfo si
            JOIN SeriesMatch sm ON si.SeriesId = sm.SeriesId
            JOIN MatchLeague ml ON sm.MatchId = ml.MatchId
            JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
            LEFT JOIN LeagueStageBoundaries lsb ON lsb.LeagueId = li.LeagueId
            JOIN TeamInfo ti1 ON ti1.TeamId = si.Team1
            JOIN TeamInfo ti2 ON ti2.TeamId = si.Team2
            WHERE li.LeagueId = ?
              AND (lsb.GroupEndMatchId IS NULL OR sm.MatchId <= lsb.GroupEndMatchId)
            GROUP BY si.SeriesId
            ORDER BY si.SeriesId DESC;`,
            [leagueId]
        );
    }

    getLeagueSeriesTieBreakers(leagueId){
            return this.queryDatabase(
            `SELECT 
                si.SeriesId,
                si.Team1,
                si.Team2,
                ti1.TeamName AS team_one,
                ti2.TeamName AS team_two,
                si.DateCreated
            FROM SeriesInfo si
            JOIN SeriesMatch sm ON si.SeriesId = sm.SeriesId
            JOIN MatchLeague ml ON sm.MatchId = ml.MatchId
            JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
            LEFT JOIN LeagueStageBoundaries lsb ON lsb.LeagueId = li.LeagueId
            JOIN TeamInfo ti1 ON ti1.TeamId = si.Team1
            JOIN TeamInfo ti2 ON ti2.TeamId = si.Team2
            WHERE li.LeagueId = ?
              AND (sm.MatchId > lsb.GroupEndMatchId AND sm.MatchId <= lsb.TieBreakerEndMatchId)
            GROUP BY si.SeriesId
            ORDER BY si.SeriesId DESC;`,
            [leagueId]
        );
    }

    getLeagueSeriesPlayoffs(leagueId){
            return this.queryDatabase(
            `SELECT 
                si.SeriesId,
                si.Team1,
                si.Team2,
                ti1.TeamName AS team_one,
                ti2.TeamName AS team_two,
                si.DateCreated
            FROM SeriesInfo si
            JOIN SeriesMatch sm ON si.SeriesId = sm.SeriesId
            JOIN MatchLeague ml ON sm.MatchId = ml.MatchId
            JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
            LEFT JOIN LeagueStageBoundaries lsb ON lsb.LeagueId = li.LeagueId
            JOIN TeamInfo ti1 ON ti1.TeamId = si.Team1
            JOIN TeamInfo ti2 ON ti2.TeamId = si.Team2
            WHERE li.LeagueId = ?
              AND (sm.MatchId > lsb.TieBreakerEndMatchId)
            GROUP BY si.SeriesId
            ORDER BY si.SeriesId DESC;`,
            [leagueId]
        );
    }

    async setSeeding(){
        try {
            const groups = await this.getCurrentLeagueLeaderboard();

            const groupsWithTeams = await Promise.all(
                groups.map(async (group) => {
                    const groupTeams = await this.getGroupStats(group);

                    // Ensure teams are sorted correctly
                    groupTeams.sort((a, b) => {
                    // Sort by Wins DESC
                    if (b.Wins !== a.Wins) return b.Wins - a.Wins;
                    // Then by Neustadtl DESC (if available)
                    return b.Neustadtl - a.Neustadtl;

                    });

                    const rules = this.getLeagueRules(group.LeagueId) || DEFAULT_LEAGUE_RULES;
                    const playoffTeams = classifyStandings(groupTeams, rules)
                        .filter((team) => team.Qualification === 'upper' || team.Qualification === 'lower');


                    return {
                    ...group,
                    teams: playoffTeams
                    };
                })
            );

            const leagueIds = [...new Set(groupsWithTeams.map(group => group.LeagueId))];
            leagueIds.forEach((leagueId) => this.clearPlayoffSeeding(leagueId));

            groupsWithTeams.forEach(group => {
                group.teams.forEach((team,idx) => {
                    const seedNumber = idx + 1;
                    const bracket = team.Qualification;

                    this.addSeeding(group.LeagueId,team.TeamId,seedNumber,bracket)
                });
            });

            } catch (err) {
            console.error(err);
        }
    }

    clearPlayoffSeeding(leagueId){
        this.db.prepare(`
            DELETE FROM PlayoffSeeding
            WHERE LeagueId = ?
        `).run(leagueId);
    }

    insertBracket(bracket){
        this.db.prepare(`
              INSERT OR REPLACE INTO PlayoffBracket (
                               LeagueId,
                               PlayoffStructure
                           )
                           SELECT
                               LeagueId,
                               ?
                           FROM LeagueInfo
                           WHERE Active = 1

            `).run(JSON.stringify(bracket));
    }

    addSeeding(leagueId, team, seed, bracket){
        this.db.prepare(`INSERT INTO PlayoffSeeding (
                               LeagueId,
                               TeamId,
                               Seed,
                               Bracket
                           )
                           VALUES (
                               ?,
                               ?,
                               ?,
                               ?
                           );
                    `).run(leagueId, team, seed, bracket);
    }

    findPlayoffSeries(team1Id, team2Id){

        let yesterdaysDate = new Date();
        yesterdaysDate.setDate(yesterdaysDate.getDate() - 1);
        yesterdaysDate = yesterdaysDate.toISOString().split('T')[0];

        return this.queryDatabase(
            `SELECT 
                SI.SeriesId,
                SUM(CASE WHEN mt.WinnerId = ? THEN 1 ELSE 0 END) as Team1Wins,
                SUM(CASE WHEN mt.WinnerId = ? THEN 1 ELSE 0 END) as Team2Wins,
                COUNT(SM.MatchId) as TotalGames
            FROM SeriesInfo SI
            JOIN SeriesMatch SM ON SI.SeriesId = SM.SeriesId
            JOIN MatchTeam mt on mt.MatchId = SM.MatchId
            WHERE 
                        SI.Stage = 'p' 
                        AND (
                            (SI.Team1 = ? AND SI.Team2 = ?) 
                            OR 
                            (SI.Team1 = ? AND SI.Team2 = ?)
                        )
                        AND SI.DateCreated >= ?
                    GROUP BY SI.SeriesId
                    ORDER BY SI.SeriesId DESC
                    LIMIT 1
                `,[team1Id,team2Id,team1Id,team2Id,team2Id,team1Id,yesterdaysDate])
    }

    getSeriesMatches(seriesId){
        return this.queryDatabase(
            `SELECT 
            sm.SeriesId,
            sm.MatchId,
            mt.TeamRad as rad_team_id,
            mt.TeamDire as dire_team_id,
            CASE 
                WHEN mt.WinnerId = mt.TeamRad THEN 'r'
                WHEN mt.WinnerId = mt.TeamDire THEN 'd'
            ELSE NULL
            END AS WinnerSide,
            tir.TeamName as rad_team_name,
            tid.TeamName as dire_team_name,
            mt.Duration
            FROM 
            SeriesInfo si 
            JOIN SeriesMatch sm on si.SeriesId = sm.SeriesId
            JOIN MatchTeam mt on sm.MatchId = mt.MatchId
            JOIN TeamInfo tir on tir.TeamId = mt.TeamRad 
            JOIN TeamInfo tid on tid.TeamId = mt.TeamDire
            WHERE si.SeriesId = ?`,
            [seriesId]
        );
    }

    getSeriesInfo(seriesId){
        return this.queryDatabase(
                    `SELECT 
                        si.*,
                        SUM(CASE WHEN mt.WinnerId = si.Team1 THEN 1 ELSE 0 END) as Team1Wins,
                        SUM(CASE WHEN mt.WinnerId = si.Team2 THEN 1 ELSE 0 END) as Team2Wins,
                        ti1.TeamName as Team1Name,
                        ti2.TeamName as Team2Name
                    FROM 
                    SeriesInfo si 
                    JOIN SeriesMatch sm on si.SeriesId = sm.SeriesId
                    JOIN MatchTeam mt on mt.MatchId = sm.MatchId
                    JOIN TeamInfo ti1 on si.Team1 = ti1.TeamId
                    JOIN TeamInfo ti2 on si.Team2 = ti2.TeamId
                    WHERE si.SeriesId = ?`,
                    [seriesId]
                );
    }

    getCurrentLeagueLeaderboard(){

        return this.queryDatabase(`
            SELECT g.GroupId, g.GroupName, g.LeagueId
            FROM GroupNames g
            JOIN LeagueInfo l ON l.LeagueId = g.LeagueId
            WHERE l.Active = 1
            ORDER BY g.GroupId
        `);
        
    }

    getLeagueLeaderboard(leagueId){
        return this.queryDatabase(`
            SELECT g.GroupId, g.GroupName, g.LeagueId
            FROM GroupNames g
            WHERE g.LeagueId = ?
            ORDER BY g.GroupId
        `, [leagueId]);
    }

    getGroupStats(groupInfo){
        return this.queryDatabase( `
            SELECT * FROM (
                SELECT lg.TeamId, NULL AS EntryId,
                       COALESCE(ltn.DisplayName, t.TeamName, 'Team ' || lg.TeamId) AS TeamName,
                       COALESCE(ls.Wins, 0) AS Wins, COALESCE(ls.Losses, 0) AS Losses,
                       COALESCE(n.Score, 0) AS Score, 0 AS SortOrder
                FROM LeagueGroups lg
                LEFT JOIN TeamInfo t ON t.TeamId = lg.TeamId
                LEFT JOIN LeagueTeamNames ltn ON ltn.LeagueId = lg.LeagueId AND ltn.TeamId = lg.TeamId
                LEFT JOIN LeagueStandings ls on ls.LeagueId = lg.LeagueId AND ls.TeamId = lg.TeamId
                LEFT JOIN Neustadtl n on n.TeamId = lg.TeamId and n.LeagueId = lg.LeagueId
                WHERE lg.GroupId = ? AND lg.LeagueId = ?
                  AND NOT EXISTS (
                    SELECT 1 FROM LeagueRosterEntries e
                    WHERE e.LeagueId = lg.LeagueId AND e.TeamId = lg.TeamId
                  )
                UNION ALL
                SELECT e.TeamId, e.EntryId, e.DisplayName AS TeamName,
                       COALESCE(ls.Wins, 0) AS Wins, COALESCE(ls.Losses, 0) AS Losses,
                       COALESCE(n.Score, 0) AS Score, e.SortOrder
                FROM LeagueRosterEntries e
                LEFT JOIN LeagueStandings ls ON ls.LeagueId = e.LeagueId AND ls.TeamId = e.TeamId
                LEFT JOIN Neustadtl n ON n.LeagueId = e.LeagueId AND n.TeamId = e.TeamId
                WHERE e.GroupId = ? AND e.LeagueId = ?
            ) ORDER BY Wins DESC, Score DESC, SortOrder, TeamName
        `,[groupInfo.GroupId, groupInfo.LeagueId, groupInfo.GroupId, groupInfo.LeagueId]);

    };

    getLeagueSetup(leagueId){
        return this.getLeagueLeaderboard(leagueId).map((group) => ({
            ...group,
            teams: this.getGroupStats(group),
        }));
    }

    getUnlinkedRosterCount(leagueId){
        return this.db.prepare(`SELECT COUNT(*) AS Count FROM LeagueRosterEntries
            WHERE LeagueId = ? AND TeamId IS NULL`).get(leagueId).Count;
    }

    getLeagueMatchTeams(leagueId){
        return this.queryDatabase(`
            SELECT ids.TeamId, ti.TeamName
            FROM (
                SELECT mt.TeamRad AS TeamId FROM MatchTeam mt
                JOIN MatchLeague ml ON ml.MatchId = mt.MatchId WHERE ml.LeagueId = ?
                UNION
                SELECT mt.TeamDire AS TeamId FROM MatchTeam mt
                JOIN MatchLeague ml ON ml.MatchId = mt.MatchId WHERE ml.LeagueId = ?
            ) ids
            LEFT JOIN TeamInfo ti ON ti.TeamId = ids.TeamId
            WHERE ids.TeamId > 0
              AND NOT EXISTS (SELECT 1 FROM LeagueRosterEntries e
                WHERE e.LeagueId = ? AND e.TeamId = ids.TeamId)
              AND NOT EXISTS (SELECT 1 FROM LeagueGroups lg
                WHERE lg.LeagueId = ? AND lg.TeamId = ids.TeamId)
            ORDER BY ti.TeamName, ids.TeamId
        `, [leagueId, leagueId, leagueId, leagueId]);
    }

    linkLeagueRosterEntry(leagueId, entryId, teamId){
        const link = this.db.transaction(() => {
            const entry = this.db.prepare(`SELECT * FROM LeagueRosterEntries
                WHERE LeagueId = ? AND EntryId = ? AND TeamId IS NULL`).get(leagueId, entryId);
            if (!entry) throw new Error('Unlinked roster entry not found');
            if (!Number.isSafeInteger(teamId) || teamId <= 0) {
                throw new Error('Enter a positive team ID');
            }
            const displayName = entry.DisplayName;
            const groupId = entry.GroupId;
            if (!displayName || displayName.length > 60 || !Number.isSafeInteger(groupId) || groupId <= 0) {
                throw new Error('Enter a valid team name and group');
            }
            if (!this.db.prepare(`SELECT 1 FROM GroupNames WHERE LeagueId = ? AND GroupId = ?`)
                .get(leagueId, groupId)) throw new Error('Group is not in this league');
            if (!this.getLeagueMatchTeams(leagueId).some((team) => team.TeamId === teamId)) {
                throw new Error('Team ID has not played in this league or is already on the leaderboard');
            }
            if (this.db.prepare(`SELECT 1 FROM LeagueRosterEntries
                WHERE LeagueId = ? AND TeamId = ?`).get(leagueId, teamId)) {
                throw new Error('Team ID is already linked to a roster entry');
            }
            const assigned = this.db.prepare(`SELECT GroupId FROM LeagueGroups
                WHERE LeagueId = ? AND TeamId = ?`).get(leagueId, teamId);
            if (assigned && assigned.GroupId !== groupId) {
                throw new Error('Team ID is already assigned to another group');
            }
            this.db.prepare(`UPDATE LeagueRosterEntries
                SET TeamId = ?, DisplayName = ?, GroupId = ? WHERE EntryId = ?`)
                .run(teamId, displayName, groupId, entryId);
            this.db.prepare(`INSERT INTO LeagueGroups (LeagueId, TeamId, GroupId)
                VALUES (?, ?, ?) ON CONFLICT(LeagueId, TeamId)
                DO UPDATE SET GroupId = excluded.GroupId`).run(leagueId, teamId, groupId);
            this.db.prepare(`INSERT INTO LeagueTeamNames (LeagueId, TeamId, DisplayName)
                VALUES (?, ?, ?) ON CONFLICT(LeagueId, TeamId)
                DO UPDATE SET DisplayName = excluded.DisplayName`).run(leagueId, teamId, displayName);
            this.rebuildLeagueGroupStandings(leagueId);
            return entry;
        });
        return link();
    }

    autoLinkLeagueRosterEntries(leagueId){
        const entries = this.queryDatabase(`SELECT EntryId, DisplayName FROM LeagueRosterEntries
            WHERE LeagueId = ? AND TeamId IS NULL`, [leagueId]);
        const teams = this.getLeagueMatchTeams(leagueId);
        const links = planRosterLinks(entries, teams);
        const linked = [];
        for (const { entryId, teamId } of links) {
            try {
                this.linkLeagueRosterEntry(leagueId, entryId, teamId);
                linked.push({ entryId, teamId });
            } catch (err) {
                console.warn(`Could not auto-link roster entry ${entryId} to team ${teamId}:`, err.message);
            }
        }
        return linked;
    }

    getHeadToHeadStats(groupInfo){
        return this.getLeagueGroupResults(groupInfo.LeagueId, groupInfo.GroupId).pairs;
    }

    getLeagueGroupResults(leagueId, groupId){
        const teams = this.queryDatabase(`
            SELECT lg.TeamId, COALESCE(lt.DisplayName, ti.TeamName, 'Team ' || lg.TeamId) AS TeamName
            FROM LeagueGroups lg
            LEFT JOIN TeamInfo ti ON ti.TeamId = lg.TeamId
            LEFT JOIN LeagueTeamNames lt ON lt.LeagueId = lg.LeagueId AND lt.TeamId = lg.TeamId
            WHERE lg.LeagueId = ? AND lg.GroupId = ?
            ORDER BY TeamName, lg.TeamId
        `, [leagueId, groupId]);
        const matches = this.queryDatabase(`
            SELECT mt.TeamRad, mt.TeamDire, mt.WinnerId
            FROM MatchLeague ml
            JOIN MatchTeam mt ON mt.MatchId = ml.MatchId
            LEFT JOIN LeagueStageBoundaries b ON b.LeagueId = ml.LeagueId
            WHERE ml.LeagueId = ?
              AND mt.WinnerId IN (mt.TeamRad, mt.TeamDire)
              AND (b.GroupEndMatchId IS NULL OR mt.MatchId <= b.GroupEndMatchId)
        `, [leagueId]);
        const overrides = this.queryDatabase(`
            SELECT TeamA, TeamB, WinsA, WinsB, BaseWinsA, BaseWinsB FROM GroupResultOverrides
            WHERE LeagueId = ? AND GroupId = ?
        `, [leagueId, groupId]);
        const results = buildGroupResults(teams, matches, overrides);
        const names = new Map(teams.map((team) => [team.TeamId, team.TeamName]));
        return {
            teams,
            standings: results.teams,
            pairs: results.pairs.map((pair) => ({
                ...pair,
                TeamAName: names.get(pair.TeamA),
                TeamBName: names.get(pair.TeamB),
                MatchesPlayed: pair.ActualWinsA + pair.ActualWinsB,
            })),
        };
    }

    rebuildLeagueGroupStandings(leagueId){
        const groups = this.queryDatabase(`SELECT GroupId FROM GroupNames WHERE LeagueId = ?`, [leagueId]);
        if (groups.length === 0) return;
        const update = this.db.transaction(() => {
            this.db.prepare('UPDATE LeagueStandings SET Wins = 0, Losses = 0 WHERE LeagueId = ?').run(leagueId);
            this.db.prepare('UPDATE Neustadtl SET Score = 0 WHERE LeagueId = ?').run(leagueId);
            const standing = this.db.prepare(`
                INSERT INTO LeagueStandings (LeagueId, TeamId, Wins, Losses) VALUES (?, ?, ?, ?)
                ON CONFLICT(LeagueId, TeamId) DO UPDATE SET Wins = excluded.Wins, Losses = excluded.Losses
            `);
            const neustadtl = this.db.prepare(`
                INSERT INTO Neustadtl (LeagueId, TeamId, Score) VALUES (?, ?, ?)
                ON CONFLICT(TeamId, LeagueId) DO UPDATE SET Score = excluded.Score
            `);
            for (const group of groups) {
                const result = this.getLeagueGroupResults(leagueId, group.GroupId);
                for (const row of result.standings) {
                    standing.run(leagueId, row.TeamId, row.Wins, row.Losses);
                    neustadtl.run(leagueId, row.TeamId, row.Score);
                }
            }
        });
        update();
    }

    getRecentMatches(numMatches) {
        return this.queryDatabase(
            `SELECT ml.MatchId, radTeam.TeamName as rad_team_name,mt.TeamRad as rad_team_id, direTeam.TeamName as dire_team_name,mt.TeamDire as dire_team_id,
                    CASE 
                        WHEN mt.WinnerId = mt.TeamRad THEN 'r'
                        WHEN mt.WinnerId = mt.TeamDire THEN 'd'
                        ELSE NULL
                    END AS WinnerSide,
                    li.LeagueName,
                    li.LeagueId
             FROM MatchLeague ml 
             JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
             JOIN TeamInfo radTeam ON mt.TeamRad = radTeam.TeamId
             JOIN TeamInfo direTeam ON mt.TeamDire = direTeam.TeamId
             JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
             ORDER BY ml.MatchId DESC
             LIMIT ?`,
            [numMatches]
        );
    }

    getTeamRecentMatches(teamId,leagueId) {
        let query = `
            SELECT ml.MatchId, radTeam.TeamName as rad_team_name, mt.TeamRad as rad_team_id,
                direTeam.TeamName as dire_team_name, mt.TeamDire as dire_team_id,
                CASE 
                    WHEN mt.WinnerId = mt.TeamRad THEN 'r'
                    WHEN mt.WinnerId = mt.TeamDire THEN 'd'
                    ELSE NULL
                END AS WinnerSide,
                li.LeagueName, li.LeagueId
            FROM MatchLeague ml
            JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
            JOIN TeamInfo radTeam ON mt.TeamRad = radTeam.TeamId
            JOIN TeamInfo direTeam ON mt.TeamDire = direTeam.TeamId
            JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
            WHERE (mt.TeamRad = ? OR mt.TeamDire = ?)
        `;

        const params = [teamId, teamId];

        if (leagueId && leagueId !== 'all') {
            query += ' AND li.LeagueId = ?';
            params.push(leagueId);
        }

        query += ' ORDER BY ml.MatchId DESC';

        return this.queryDatabase(query, params);
       
    }

    getTeamSeasonStats(teamId,leagueId){
        let query = `
            SELECT 
            sub.TeamId,
            sub.TeamName,
            COUNT(*) AS GamesPlayed,
            ROUND(100.0 * SUM(sub.Winner) / COUNT(*), 2) AS WinPercentage
            FROM (
                SELECT 
                    mt.TeamRad AS TeamId, 
                    ti.TeamName,
                    CASE WHEN mt.TeamRad = mt.WinnerId THEN 1 ELSE 0 END AS Winner,
                    li.LeagueId,
                    li.LeagueName
                FROM MatchTeam mt
                JOIN TeamInfo ti ON ti.TeamId = mt.TeamRad
                JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
                JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId
                WHERE li.LeagueId = ? AND ti.TeamId = ?
                UNION ALL

                SELECT 
                    mt.TeamDire AS TeamId, 
                    ti.TeamName,
                    CASE WHEN mt.TeamDire = mt.WinnerId THEN 1 ELSE 0 END AS Winner,
                    li.LeagueId,
                    li.LeagueName
                FROM MatchTeam mt
                JOIN TeamInfo ti ON ti.TeamId = mt.TeamDire
                JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
                JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId
                WHERE li.LeagueId = ? AND ti.TeamId = ?
                ) sub
        `;
         const params = [leagueId,teamId,leagueId,teamId];

        return this.queryDatabase(query, params);

    }

    getHeroPlayerInfo(heroId, leagueId){
        let query = 
            `SELECT
            p.PlayerId,
            p.PlayerName,
            COUNT(DISTINCT mp.MatchId) AS GamesPlayed,
            ROUND(100.0 * SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) / COUNT(mp.MatchId), 2) AS WinPercentage
            FROM MatchPlayer mp
            JOIN PlayerInfo p ON mp.PlayerId = p.PlayerId
            JOIN MatchLeague ml ON mp.MatchId = ml.MatchId
            WHERE mp.HeroId = ?
        `;

        const params = [heroId];

        if (leagueId && leagueId !== 'all') {
            query += ' AND ml.LeagueId = ?';
            params.push(leagueId);
        }

        query += ' GROUP BY mp.PlayerId ORDER BY GamesPlayed DESC LIMIT 5';

        return this.queryDatabase(query, params);
    }

    getTeamHeroData(teamId, leagueId){
         let query = 
            `SELECT
            h.HeroId,
            h.HeroName,
            COUNT(DISTINCT mp.MatchId) AS GamesPlayed,
            ROUND(100.0 * SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) / COUNT(mp.MatchId), 2) AS WinPercentage,
            ROUND(AVG(mp.Kills), 2) AS AvgKills,
            ROUND(AVG(mp.Deaths), 2) AS AvgDeaths,
            ROUND(AVG(mp.Assists), 2) AS AvgAssists,
            ROUND(AVG(mp.LastHits), 2) AS AvgLastHits,
            ROUND(AVG(mp.GPM), 2) AS AvgGPM,
            ROUND(AVG(mp.XPM), 2) AS AvgXPM
            FROM MatchPlayer mp
            JOIN MatchTeamPlayer mtp ON mtp.PlayerId = mp.PlayerId AND mp.MatchId = mtp.MatchId
            JOIN HeroInfo h ON mp.HeroId = h.HeroId
            JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
            WHERE mtp.TeamId = ?
        `;

        const params = [teamId];

        if (leagueId && leagueId !== 'all') {
            query += ' AND ml.LeagueId = ?';
            params.push(leagueId);
        }

        query += ' GROUP BY h.HeroId, h.HeroName ORDER BY GamesPlayed DESC';

        return this.queryDatabase(query, params);
    }

    getTeamPlayerStats(teamId,leagueId){
        let query = `
            SELECT 
            p.PlayerId,
            p.PlayerName, 
            COUNT(DISTINCT mtp.MatchId) as GamesPlayed,
            AVG(mp.Kills) AS AvgKills,
            AVG(mp.Deaths) AS AvgDeaths,
            AVG(mp.Assists) AS AvgAssists,
            AVG(mp.LastHits) AS AvgLastHits,
            AVG(mp.GPM) AS AvgGPM,
            AVG(mp.XPM) AS AvgXPM
            FROM MatchTeamPlayer mtp
            JOIN MatchPlayer mp on mtp.PlayerId = mp.PlayerId and mtp.MatchId = mp.MatchId
            JOIN PlayerInfo p on mtp.PlayerId = p.PlayerId 
            JOIN MatchLeague ml on mtp.MatchId = ml.MatchId
            WHERE mtp.TeamId = ? 
        `;

        const params = [teamId];

        if (leagueId && leagueId !== 'all') {
            query += ' AND ml.LeagueId = ?';
            params.push(leagueId);
        }

        query += ' GROUP BY mtp.PlayerId ORDER BY COUNT(mtp.PlayerId) DESC';

        return this.queryDatabase(query, params);
    }

    getLeaguePlayerStats(playerId,leagueId){
        let query = `
            SELECT 
            p.PlayerId,
            p.PlayerName, 
            COUNT(DISTINCT mtp.MatchId) as GamesPlayed,
            AVG(mp.Kills) AS AvgKills,
            AVG(mp.Deaths) AS AvgDeaths,
            AVG(mp.Assists) AS AvgAssists,
            AVG(mp.LastHits) AS AvgLastHits,
            AVG(mp.GPM) AS AvgGPM,
            AVG(mp.XPM) AS AvgXPM
            FROM MatchTeamPlayer mtp
            JOIN MatchPlayer mp on mtp.PlayerId = mp.PlayerId and mtp.MatchId = mp.MatchId
            JOIN PlayerInfo p on mtp.PlayerId = p.PlayerId 
            JOIN MatchLeague ml on mtp.MatchId = ml.MatchId
            WHERE mtp.TeamId = ? AND ml.LeagueId = ?
        `;

        const params = [playerId,leagueId];

        return this.queryDatabase(query, params);
    }

    getMatch(matchId) {
        return this.queryDatabase(
            `SELECT ml.MatchId, radTeam.Teamid as rad_team_id, radTeam.TeamName as rad_team_name, direTeam.Teamid as dire_team_id, direTeam.TeamName as dire_team_name,
                    CASE 
                        WHEN mt.WinnerId = mt.TeamRad THEN 'r'
                        WHEN mt.WinnerId = mt.TeamDire THEN 'd'
                        ELSE NULL
                    END AS WinnerSide,
                    li.LeagueName,
                    li.LeagueId,
                    mt.Duration,
                    ml.DatePlayed
             FROM MatchLeague ml
             JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
             JOIN TeamInfo radTeam ON mt.TeamRad = radTeam.TeamId
             JOIN TeamInfo direTeam ON mt.TeamDire = direTeam.TeamId
             JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
             WHERE ml.MatchId = ?`,
            [matchId]
        );
    }

    getMatchPlayerInformation(matchId) {
        return this.queryDatabase(
            `SELECT pi.PlayerName, hi.HeroName, mp.Kills, mp.Deaths, mp.Assists, mp.Lasthits, mp.HeroDamage,
                    mp.TowerDamage, mp.Healing, mp.GPM, mp.XPM, pi.PlayerId, hi.HeroId
             FROM MatchPlayer mp
             JOIN PlayerInfo pi ON mp.PlayerId = pi.PlayerId
             JOIN HeroInfo hi ON mp.HeroId = hi.HeroId
             JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
             WHERE mp.MatchId = ?`,
            [matchId]
        );
    }

    getMatchPickBanInformation(matchId){
        return this.queryDatabase(
            `SELECT pi.IsPick, pi.Hero_Id AS HeroId, pi.OrderNum, hi.HeroName, pi.Team
             FROM PickInfo pi
             JOIN HeroInfo hi on pi.Hero_Id = hi.HeroId
             WHERE MatchId = ?`,
            [matchId]
        );
    }

    getTeamDraftRows(teamId, leagueId) {
        let query = `
            SELECT
                mt.MatchId,
                ml.DatePlayed,
                li.LeagueId,
                li.LeagueName,
                mt.TeamRad,
                mt.TeamDire,
                mt.WinnerId,
                radTeam.TeamName AS RadiantTeamName,
                direTeam.TeamName AS DireTeamName,
                CASE WHEN mt.TeamRad = ? THEN 0 ELSE 1 END AS SelectedTeamSide,
                CASE WHEN mt.TeamRad = ? THEN mt.TeamDire ELSE mt.TeamRad END AS EnemyTeamId,
                CASE WHEN mt.TeamRad = ? THEN direTeam.TeamName ELSE radTeam.TeamName END AS EnemyTeamName,
                CASE WHEN mt.WinnerId = ? THEN 1 ELSE 0 END AS SelectedTeamWon,
                pi.IsPick,
                pi.Hero_Id AS HeroId,
                pi.OrderNum,
                pi.Team AS DraftSide,
                hi.HeroName
            FROM MatchTeam mt
            JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
            JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId
            JOIN TeamInfo radTeam ON radTeam.TeamId = mt.TeamRad
            JOIN TeamInfo direTeam ON direTeam.TeamId = mt.TeamDire
            LEFT JOIN PickInfo pi ON pi.MatchId = mt.MatchId
            LEFT JOIN HeroInfo hi ON hi.HeroId = pi.Hero_Id
            WHERE (mt.TeamRad = ? OR mt.TeamDire = ?)
        `;

        const params = [teamId, teamId, teamId, teamId, teamId, teamId];

        if (leagueId && leagueId !== 'all') {
            query += ` AND li.LeagueId = ?`;
            params.push(leagueId);
        }

        query += `
            ORDER BY ml.DatePlayed DESC, mt.MatchId DESC, pi.OrderNum ASC
        `;

        return this.queryDatabase(query, params);
    }

    getTeamDraftHeroStats(teamId, leagueId) {
        let query = `
            SELECT
                pi.IsPick,
                pi.Hero_Id AS HeroId,
                hi.HeroName,
                COUNT(*) AS TimesUsed,
                SUM(CASE WHEN mt.WinnerId = ? THEN 1 ELSE 0 END) AS Wins,
                ROUND(100.0 * SUM(CASE WHEN mt.WinnerId = ? THEN 1 ELSE 0 END) / COUNT(*), 2) AS WinRate
            FROM PickInfo pi
            JOIN MatchTeam mt ON mt.MatchId = pi.MatchId
            JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
            JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId
            JOIN HeroInfo hi ON hi.HeroId = pi.Hero_Id
            WHERE (
                (mt.TeamRad = ? AND pi.Team = 0)
                OR
                (mt.TeamDire = ? AND pi.Team = 1)
            )
        `;

        const params = [teamId, teamId, teamId, teamId];

        if (leagueId && leagueId !== 'all') {
            query += ` AND li.LeagueId = ?`;
            params.push(leagueId);
        }

        query += `
            GROUP BY pi.IsPick, pi.Hero_Id, hi.HeroName
            ORDER BY pi.IsPick DESC, TimesUsed DESC, WinRate DESC, hi.HeroName ASC
        `;

        return this.queryDatabase(query, params);
    }

    getPlayerHeroHighlights(playerId, leagueId){
        let query = `
            SELECT 
            hi.HeroName, 
            COUNT(mp.HeroId) as GamesPlayed,
            ROUND(AVG(mp.Winner) * 100, 2) AS WinPercentage,
            AVG(mp.Kills) AS AvgKills,
            AVG(mp.Deaths) AS AvgDeaths,
            AVG(mp.Assists) AS AvgAssists,
            AVG(mp.LastHits) AS AvgLastHits,
            AVG(mp.GPM) AS AvgGPM,
            AVG(mp.XPM) AS AvgXPM,
            mp.HeroId 
            FROM MatchPlayer mp
            JOIN MatchLeague ml on mp.MatchId = ml.MatchId
            Join HeroInfo hi on mp.HeroId = hi.HeroId
            WHERE mp.PlayerId = ?
        `;

        const params = [playerId];

        if (leagueId && leagueId !== 'all') {
            query += ' AND ml.LeagueId = ?';
            params.push(leagueId);
        }

        query += `GROUP BY mp.HeroId
            ORDER BY COUNT(mp.HeroId) DESC
            LIMIT 5`;

        return this.queryDatabase(query, params);
    }

    getLeagues(){
         return this.queryDatabase(`
            SELECT
            li.LeagueId,
            li.LeagueName,
            ml.MatchId AS LastMatchId,
            CASE WHEN li.Active = 0 AND mt.TeamRad = mt.WinnerId THEN mt.TeamRad
                WHEN li.Active = 0 AND mt.TeamDire = mt.WinnerId THEN mt.TeamDire
                ELSE NULL END AS WinnerTeamId,
            ti.TeamName AS WinnerTeamName
            FROM LeagueInfo li
            LEFT JOIN MatchLeague ml ON li.LeagueId = ml.LeagueId
                AND ml.MatchId = (
                    SELECT MAX(ml2.MatchId) FROM MatchLeague ml2 WHERE ml2.LeagueId = li.LeagueId
                )
            LEFT JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
            LEFT JOIN TeamInfo ti ON ti.TeamId = 
                CASE WHEN li.Active = 0 AND mt.TeamRad = mt.WinnerId THEN mt.TeamRad
                    WHEN li.Active = 0 AND mt.TeamDire = mt.WinnerId THEN mt.TeamDire END
            ORDER BY li.LeagueId DESC`
            );
    }

    getLeagueData(leagueId){
        return this.queryDatabase(
            `SELECT
            li.Active,
            li.LeagueId,
            li.LeagueName,
            CASE WHEN li.Active = 0 AND mt.TeamRad = mt.WinnerId THEN mt.TeamRad
                WHEN li.Active = 0 AND mt.TeamDire = mt.WinnerId THEN mt.TeamDire
                ELSE NULL END AS WinnerTeamId,
            ti.TeamName AS WinnerTeamName
            FROM LeagueInfo li
            LEFT JOIN MatchLeague ml ON li.LeagueId = ml.LeagueId
                AND ml.MatchId = (
                    SELECT MAX(ml2.MatchId) FROM MatchLeague ml2 WHERE ml2.LeagueId = li.LeagueId
                )
            LEFT JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
            LEFT JOIN TeamInfo ti ON ti.TeamId = 
                CASE WHEN li.Active = 0 AND mt.TeamRad = mt.WinnerId THEN mt.TeamRad
                    WHEN li.Active = 0 AND mt.TeamDire = mt.WinnerId THEN mt.TeamDire END
            WHERE li.LeagueId = ?
        `,[leagueId]);
    }

    getLeaguePlayerData(leagueId){
        return this.queryDatabase(
            `SELECT
            p.PlayerId,
            p.PlayerName,
            COUNT(mtp.MatchId) AS GamesPlayed,
            ROUND(100.0 * SUM(
                CASE 
                    WHEN mt.TeamRad = mt.WinnerId AND mt.TeamRad = mtp.TeamId THEN 1
                    WHEN mt.TeamDire = mt.WinnerId AND mt.TeamDire = mtp.TeamId THEN 1
                    ELSE 0
                END
            ) / COUNT(mtp.MatchId), 2) AS WinPercentage,
            AVG(mp.Kills) AS AvgKills,
            AVG(mp.Deaths) AS AvgDeaths,
            AVG(mp.Assists) AS AvgAssists,
            AVG(mp.LastHits) AS AvgLastHits,
            AVG(mp.GPM) AS AvgGPM,
            AVG(mp.XPM) AS AvgXPM
            FROM MatchTeamPlayer mtp
            JOIN MatchPlayer mp
                ON mtp.MatchId = mp.MatchId
                AND mtp.PlayerId = mp.PlayerId
            JOIN PlayerInfo p
                ON p.PlayerId = mtp.PlayerId
            JOIN MatchTeam mt
                ON mtp.MatchId = mt.MatchId
            JOIN MatchLeague ml
                ON ml.MatchId = mtp.MatchId
            WHERE ml.LeagueId = ?
            GROUP BY p.PlayerId
            ORDER BY GamesPlayed DESC;
        `,[leagueId]);
    }

    getLeagueMatchesData(leagueId){
        return this.queryDatabase(
            `SELECT
            ml.MatchId,
            mt.TeamRad AS RadiantTeamId,
            COALESCE(ltr.DisplayName, tr.TeamName) AS RadiantTeamName,
            mt.TeamDire AS DireTeamId,
            COALESCE(ltd.DisplayName, td.TeamName) AS DireTeamName,
            tr.TeamId as rad_team_id,
            td.TeamId as dire_team_id,
            CASE 
                        WHEN mt.WinnerId = mt.TeamRad THEN 'r'
                        WHEN mt.WinnerId = mt.TeamDire THEN 'd'
                        ELSE NULL
                    END AS WinnerSide
            FROM MatchLeague ml
            JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
            JOIN TeamInfo tr ON mt.TeamRad = tr.TeamId
            JOIN TeamInfo td ON mt.TeamDire = td.TeamId
            LEFT JOIN LeagueTeamNames ltr ON ltr.LeagueId = ml.LeagueId AND ltr.TeamId = mt.TeamRad
            LEFT JOIN LeagueTeamNames ltd ON ltd.LeagueId = ml.LeagueId AND ltd.TeamId = mt.TeamDire
            LEFT JOIN TeamInfo tw ON tw.TeamId = mt.WinnerId
            WHERE ml.LeagueId = ?
            ORDER BY ml.MatchId DESC;
        `,[leagueId]);
    }

    getLeagueHeroData(leagueId){
         return this.queryDatabase(
            `SELECT
            h.HeroId,
            h.HeroName,
            COUNT(mp.MatchId) AS GamesPlayed,
            ROUND(100.0 * SUM(CASE WHEN mp.Winner = 1 THEN 1 ELSE 0 END) / COUNT(mp.MatchId), 2) AS WinPercentage,
            ROUND(AVG(mp.Kills), 2) AS AvgKills,
            ROUND(AVG(mp.Deaths), 2) AS AvgDeaths,
            ROUND(AVG(mp.Assists), 2) AS AvgAssists,
            ROUND(AVG(mp.LastHits), 2) AS AvgLastHits,
            ROUND(AVG(mp.GPM), 2) AS AvgGPM,
            ROUND(AVG(mp.XPM), 2) AS AvgXPM
            FROM MatchPlayer mp
            JOIN MatchLeague ml ON mp.MatchId = ml.MatchId
            JOIN HeroInfo h ON mp.HeroId = h.HeroId
            WHERE ml.LeagueId = ?
            GROUP BY h.HeroId, h.HeroName
            ORDER BY GamesPlayed DESC;
        `,[leagueId]);
    }

    getWinPercentage(teamId){
        return this.queryDatabase(`
            Select 
            ROUND(100*Wins/(Wins+Losses),2) as WinPct
            From LeagueStandings ls join 
            LeagueInfo li on ls.LeagueId = li.LeagueId
            WHERE li.Active = 1 AND ls.TeamId = ?`, [teamId]);
    }

    getScheduledSeries(team1Id, team2Id){
        return this.queryDatabase(`
            SELECT Date 
            FROM ScheduledSeries
            WHERE (Team1 = ? AND Team2 = ?)
            OR (Team1 = ? AND Team2 = ?)`, [team1Id,team2Id,team2Id,team1Id]);
    }

    insertTeam(team) {
        try {
            const insertQuery = `
                INSERT INTO TeamInfo (TeamId, TeamName)
                VALUES (@team_id, @team_name)`;
            const insertStatement = this.db.prepare(insertQuery);
            insertStatement.run({
                team_id: team.team_id,
                team_name: team.team_name
            });
            return 1;
        } catch (err) {
            console.error('Insert failed:', err);
            return 2;
        }
    }

    insertMatches(matchData) {
        try {
            const insertQuery = `INSERT INTO MatchTeam (MatchId, TeamRad, TeamDire, WinnerId, SeriesId)
                                 VALUES (@match_id, @radiant_team_id, @dire_team_id, -1, @series_id)`;
            const insertStatement = this.db.prepare(insertQuery);
            for (const match of matchData) {
                insertStatement.run(match);
            }
            return 1;
        } catch (err) {
            return 2;
        }
    }

    changeName(accountId,newName){
        const now = new Date();
    
        try {
            const row = this.queryDatabase(
                `SELECT LastDateChanged FROM PlayerInfo WHERE PlayerId = ?`,
                [accountId]
            );

            const lastChanged = row[0].LastDateChanged ? new Date(row[0].LastDateChanged) : null;
            lastChanged.setDate(lastChanged.getDate() + 30)

            if (lastChanged && lastChanged > now) {
                return { success: false, error: 'You can only change your name once every 30 days.' };
            }

            this.db.prepare('UPDATE PlayerInfo SET PlayerName = ?, LastDateChanged = ? WHERE PlayerId = ?')
                .run(newName, now.toISOString(), accountId);

            return { success: true, message: 'Name updated successfully!' };
        } catch (err) {
           return { success: false, error: err };
        }
    }

    adminUpdateMatch(matchId, teamRad, teamDire, winnerId, originalTeamRad, originalTeamDire){
        try {

            this.db.prepare('UPDATE MatchTeam SET TeamRad = ?, TeamDire = ?, WinnerId = ? WHERE MatchId = ?')
                .run(teamRad, teamDire, winnerId, matchId);

            this.db.prepare(`INSERT INTO AdminAuditLog (
                              Type,
                              Message
                          )
                          VALUES (
                              'MatchTeam Update',
                              'Updated Match ${matchId} with values Team1 = ${teamRad}, Team2 = ${teamDire}, Winner = ${winnerId}'
                          );
                    `).run();

            if (teamRad !== originalTeamRad) {
                this.db.prepare(`UPDATE MatchTeamPlayer SET TeamId = ? WHERE MatchId = ?`)
                .run(teamRad, matchId);

                this.db.prepare(`INSERT INTO AdminAuditLog (
                              Type,
                              Message
                          )
                          VALUES (
                              'MatchTeamPlayer Update',
                              'Updated Match ${matchId} with values TeamId = ${teamRad}, old value = ${originalTeamRad}'
                          );
                    `).run();
            }

            if (teamDire !== originalTeamDire) {
                this.db.prepare(`UPDATE MatchTeamPlayer SET TeamId = ? WHERE MatchId = ?`)
                .run(teamDire, matchId);

                this.db.prepare(`INSERT INTO AdminAuditLog (
                              Type,
                              Message
                          )
                          VALUES (
                              'MatchTeamPlayer Update',
                              'Updated Match ${matchId} with values TeamId = ${teamDire}, old value = ${originalTeamDire}'
                          );
                    `).run();
            }

            const oldSeries = this.queryDatabase(`
                    SELECT
                        si.SeriesId,
                        si.DateCreated
                    FROM
                    SeriesInfo si
                    JOIN SeriesMatch sm on si.SeriesId = sm.SeriesId
                    WHERE sm.MatchId = ?
                `, [matchId]);
            
            const newSeries = this.queryDatabase(`
                    SELECT
                        SeriesId,
                        DateCreated
                    FROM
                    SeriesInfo
                    WHERE (Team1 = ? AND Team2 = ?)
                        OR (Team1 = ? AND Team2 = ?)
                        AND DateCreated = ?
                `, [teamRad,teamDire,teamDire,teamRad,oldSeries[0].DateCreated]);


            if(newSeries.length === 0){
                this.db.prepare(`UPDATE SeriesInfo SET Team1 = ?, Team2 = ? WHERE SeriesId = ?`)
                    .run(teamRad,teamDire,oldSeries[0].SeriesId);


                this.db.prepare(`INSERT INTO AdminAuditLog (
                                Type,
                                Message
                            )
                            VALUES (
                                'SeriesMatch Update',
                                'Updated Series ${oldSeries[0].SeriesId} adding teams ${teamRad},${teamDire}'
                            );
                        `).run();
            }
            else{
                this.db.prepare(`UPDATE SeriesMatch SET SeriesId = ? WHERE MatchId = ?`)
                    .run(newSeries[0].SeriesId, matchId);


                this.db.prepare(`INSERT INTO AdminAuditLog (
                                Type,
                                Message
                            )
                            VALUES (
                                'SeriesMatch Update',
                                'Updated Series ${newSeries[0].SeriesId} add match ${matchId}'
                            );
                        `).run();

                this.db.prepare(`DELETE FROM SeriesMatch WHERE SeriesId = ?`)
                    .run(oldSeries[0].SeriesId);        
                
                 this.db.prepare(`INSERT INTO AdminAuditLog (
                                Type,
                                Message
                            )
                            VALUES (
                                'SeriesMatch Delete',
                                'Deleted Series ${oldSeries[0].SeriesId}'
                            );
                        `).run();
            }


            return { success: true, message: 'Match updated successfully!' };
        } catch (err) {
           return { success: false, error: err };
        }
    }

    adminSaveLeagueTeam(leagueId, originalTeamId, teamId, teamName, groupId){
        const save = this.db.transaction(() => {
            const idChanged = originalTeamId !== teamId;
            if (idChanged) {
                const assigned = this.db.prepare(`SELECT 1 FROM LeagueGroups
                    WHERE LeagueId = ? AND TeamId = ?`).get(leagueId, teamId);
                const linked = this.db.prepare(`SELECT 1 FROM LeagueRosterEntries
                    WHERE LeagueId = ? AND TeamId = ?`).get(leagueId, teamId);
                if (assigned || linked) {
                    const error = new Error('That team ID is already assigned to another leaderboard row');
                    error.status = 409;
                    throw error;
                }
            }

            const oldGroup = this.db.prepare(`SELECT GroupId FROM LeagueGroups
                WHERE LeagueId = ? AND TeamId = ?`).get(leagueId, originalTeamId)?.GroupId;
            if (idChanged) {
                this.db.prepare(`DELETE FROM LeagueGroups WHERE LeagueId = ? AND TeamId = ?`)
                    .run(leagueId, originalTeamId);
                this.db.prepare(`DELETE FROM LeagueTeamNames WHERE LeagueId = ? AND TeamId = ?`)
                    .run(leagueId, originalTeamId);
            }
            this.db.prepare(`INSERT INTO LeagueTeamNames (LeagueId, TeamId, DisplayName)
                VALUES (?, ?, ?) ON CONFLICT(LeagueId, TeamId)
                DO UPDATE SET DisplayName = excluded.DisplayName`).run(leagueId, teamId, teamName);
            if (groupId == null) {
                this.db.prepare(`UPDATE LeagueRosterEntries SET TeamId = NULL, DisplayName = ?
                    WHERE LeagueId = ? AND TeamId = ?`).run(teamName, leagueId, originalTeamId);
                this.db.prepare(`DELETE FROM LeagueGroups WHERE LeagueId = ? AND TeamId = ?`)
                    .run(leagueId, teamId);
            } else {
                this.db.prepare(`UPDATE LeagueRosterEntries
                    SET TeamId = ?, DisplayName = ?, GroupId = ?
                    WHERE LeagueId = ? AND TeamId = ?`)
                    .run(teamId, teamName, groupId, leagueId, originalTeamId);
                this.db.prepare(`INSERT INTO LeagueGroups (LeagueId, TeamId, GroupId)
                    VALUES (?, ?, ?) ON CONFLICT(LeagueId, TeamId)
                    DO UPDATE SET GroupId = excluded.GroupId`).run(leagueId, teamId, groupId);
            }
            if (oldGroup !== undefined && (idChanged || oldGroup !== groupId)) {
                this.db.prepare(`DELETE FROM GroupResultOverrides
                    WHERE LeagueId = ? AND GroupId = ? AND (TeamA = ? OR TeamB = ?)`)
                    .run(leagueId, oldGroup, originalTeamId, originalTeamId);
            }
            if (idChanged || oldGroup !== groupId) this.rebuildLeagueGroupStandings(leagueId);
            this.db.prepare('INSERT INTO AdminAuditLog (Type, Message) VALUES (?, ?)').run(
                'League Team Edit',
                `League ${leagueId}: team ${originalTeamId} -> ${teamId}, named ${teamName}, group ${groupId ?? 'unassigned'}`
            );
        });
        save();
    }

    replaceUngroupedMatchTeamId(leagueId, sourceId, targetId){
        return this.db.transaction(() => {
            if (this.db.prepare(`SELECT 1 FROM LeagueGroups WHERE LeagueId = ? AND TeamId = ?`)
                .get(leagueId, sourceId)) {
                const error = new Error('Source team is already assigned to a group');
                error.status = 409;
                throw error;
            }
            if (this.db.prepare(`SELECT 1 FROM LeagueRosterEntries WHERE LeagueId = ? AND TeamId = ?`)
                .get(leagueId, sourceId)) {
                const error = new Error('Source team is linked to a preseason roster row');
                error.status = 409;
                throw error;
            }
            const target = this.db.prepare(`SELECT COALESCE(lt.DisplayName, e.DisplayName, ti.TeamName,
                    'Team ' || lg.TeamId) AS TeamName
                FROM LeagueGroups lg
                LEFT JOIN LeagueTeamNames lt ON lt.LeagueId = lg.LeagueId AND lt.TeamId = lg.TeamId
                LEFT JOIN LeagueRosterEntries e ON e.LeagueId = lg.LeagueId AND e.TeamId = lg.TeamId
                LEFT JOIN TeamInfo ti ON ti.TeamId = lg.TeamId
                WHERE lg.LeagueId = ? AND lg.TeamId = ?`).get(leagueId, targetId);
            if (!target) {
                const error = new Error('Replacement team is not assigned to a group');
                error.status = 409;
                throw error;
            }

            const sourceMatches = this.db.prepare(`SELECT mt.MatchId, mt.TeamRad, mt.TeamDire
                FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
                WHERE ml.LeagueId = ? AND (mt.TeamRad = ? OR mt.TeamDire = ?)`)
                .all(leagueId, sourceId, sourceId);
            if (sourceMatches.length === 0) {
                const error = new Error('Source team has no matches in the active league');
                error.status = 404;
                throw error;
            }
            if (sourceMatches.some((match) => match.TeamRad === targetId || match.TeamDire === targetId)) {
                const error = new Error('A match already has both selected teams; replacing would make both sides the same');
                error.status = 409;
                throw error;
            }
            const sameSeries = this.db.prepare(`SELECT 1 FROM SeriesInfo
                WHERE LeagueId = ? AND ((Team1 = ? AND Team2 = ?) OR (Team1 = ? AND Team2 = ?))
                LIMIT 1`).get(leagueId, sourceId, targetId, targetId, sourceId);
            if (sameSeries) {
                const error = new Error('A series already has both selected teams');
                error.status = 409;
                throw error;
            }
            const sameTemporarySeries = this.db.prepare(`SELECT 1 FROM TempSeriesInfo
                WHERE LeagueId = ? AND ((Team1 = ? AND Team2 = ?) OR (Team1 = ? AND Team2 = ?))
                LIMIT 1`).get(leagueId, sourceId, targetId, targetId, sourceId);
            if (sameTemporarySeries) {
                const error = new Error('A pending series already has both selected teams');
                error.status = 409;
                throw error;
            }

            this.db.prepare(`INSERT OR IGNORE INTO TeamInfo (TeamId, TeamName) VALUES (?, ?)`)
                .run(targetId, target.TeamName);
            const matches = this.db.prepare(`UPDATE MatchTeam SET
                TeamRad = CASE WHEN TeamRad = ? THEN ? ELSE TeamRad END,
                TeamDire = CASE WHEN TeamDire = ? THEN ? ELSE TeamDire END,
                WinnerId = CASE WHEN WinnerId = ? THEN ? ELSE WinnerId END
                WHERE MatchId IN (SELECT MatchId FROM MatchLeague WHERE LeagueId = ?)
                  AND (TeamRad = ? OR TeamDire = ?)`)
                .run(sourceId, targetId, sourceId, targetId, sourceId, targetId,
                    leagueId, sourceId, sourceId).changes;
            const players = this.db.prepare(`UPDATE MatchTeamPlayer SET TeamId = ?
                WHERE TeamId = ? AND MatchId IN (SELECT MatchId FROM MatchLeague WHERE LeagueId = ?)`)
                .run(targetId, sourceId, leagueId).changes;
            const sourceSeries = this.db.prepare(`SELECT SeriesId, Team1, Team2, DateCreated
                FROM SeriesInfo WHERE LeagueId = ? AND (Team1 = ? OR Team2 = ?)
                ORDER BY SeriesId`).all(leagueId, sourceId, sourceId);
            const findSeries = this.db.prepare(`SELECT SeriesId FROM SeriesInfo
                WHERE LeagueId = ? AND DateCreated IS ? AND SeriesId != ?
                  AND ((Team1 = ? AND Team2 = ?) OR (Team1 = ? AND Team2 = ?))
                ORDER BY SeriesId LIMIT 1`);
            const foreignSeriesMatch = this.db.prepare(`SELECT 1 FROM SeriesMatch sm
                LEFT JOIN MatchLeague ml ON ml.MatchId = sm.MatchId
                WHERE sm.SeriesId = ? AND (ml.LeagueId IS NULL OR ml.LeagueId != ?)
                LIMIT 1`);
            const moveSeriesMatches = this.db.prepare(`UPDATE SeriesMatch SET SeriesId = ? WHERE SeriesId = ?`);
            const updateSeries = this.db.prepare(`UPDATE SeriesInfo SET Team1 = ?, Team2 = ? WHERE SeriesId = ?`);
            const deleteSeries = this.db.prepare(`DELETE FROM SeriesInfo WHERE SeriesId = ?`);
            let seriesLinksMoved = 0;
            let seriesMerged = 0;
            for (const row of sourceSeries) {
                if (foreignSeriesMatch.get(row.SeriesId, leagueId)) {
                    const error = new Error('A series contains matches outside the active league');
                    error.status = 409;
                    throw error;
                }
                const team1 = row.Team1 === sourceId ? targetId : row.Team1;
                const team2 = row.Team2 === sourceId ? targetId : row.Team2;
                const existing = findSeries.get(leagueId, row.DateCreated, row.SeriesId,
                    team1, team2, team2, team1);
                if (existing) {
                    if (foreignSeriesMatch.get(existing.SeriesId, leagueId)) {
                        const error = new Error('The replacement series contains matches outside the active league');
                        error.status = 409;
                        throw error;
                    }
                    seriesLinksMoved += moveSeriesMatches.run(existing.SeriesId, row.SeriesId).changes;
                    deleteSeries.run(row.SeriesId);
                    seriesMerged++;
                } else {
                    updateSeries.run(team1, team2, row.SeriesId);
                }
            }
            const series = sourceSeries.length;
            this.db.prepare(`UPDATE TempSeriesInfo SET
                Team1 = CASE WHEN Team1 = ? THEN ? ELSE Team1 END,
                Team2 = CASE WHEN Team2 = ? THEN ? ELSE Team2 END
                WHERE LeagueId = ? AND (Team1 = ? OR Team2 = ?)`)
                .run(sourceId, targetId, sourceId, targetId, leagueId, sourceId, sourceId);
            this.db.prepare('DELETE FROM LeagueStandings WHERE LeagueId = ? AND TeamId = ?')
                .run(leagueId, sourceId);
            this.db.prepare('DELETE FROM Neustadtl WHERE LeagueId = ? AND TeamId = ?')
                .run(leagueId, sourceId);
            this.db.prepare('DELETE FROM LeagueTeamNames WHERE LeagueId = ? AND TeamId = ?')
                .run(leagueId, sourceId);
            this.rebuildLeagueGroupStandings(leagueId);
            this.db.prepare('INSERT INTO AdminAuditLog (Type, Message) VALUES (?, ?)').run(
                'Match Team ID Replacement',
                `League ${leagueId}: replaced team ${sourceId} with ${targetId} in ${matches} matches, ${players} player rows, ${series} series; merged ${seriesMerged} series and moved ${seriesLinksMoved} series links`
            );
            return { matches, players, series, seriesMerged, seriesLinksMoved };
        })();
    }

    adminCurrentTeams(){
        const leagueId = this.getActiveLeague()?.[0]?.LeagueId;
        if (!leagueId) return [];
        return this.queryDatabase(`
            WITH ids AS (
                SELECT TeamId FROM LeagueGroups WHERE LeagueId = ?
                UNION SELECT TeamId FROM LeagueStandings WHERE LeagueId = ?
                UNION SELECT mt.TeamRad FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId WHERE ml.LeagueId = ?
                UNION SELECT mt.TeamDire FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId WHERE ml.LeagueId = ?
                UNION SELECT TeamId FROM LeagueTeamNames WHERE LeagueId = ?
            ), games AS (
                SELECT TeamId, COUNT(*) AS MatchesPlayed FROM (
                    SELECT mt.TeamRad AS TeamId FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId WHERE ml.LeagueId = ?
                    UNION ALL
                    SELECT mt.TeamDire AS TeamId FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId WHERE ml.LeagueId = ?
                ) GROUP BY TeamId
            )
            SELECT ids.TeamId, COALESCE(lt.DisplayName, ti.TeamName, 'Team ' || ids.TeamId) AS TeamName,
                   COALESCE(games.MatchesPlayed, 0) AS MatchesPlayed,
                   COALESCE(ls.Wins, 0) AS Wins, COALESCE(ls.Losses, 0) AS Losses,
                   COALESCE(n.Score, 0) AS Score, lg.GroupId, gn.GroupName
            FROM ids
            LEFT JOIN TeamInfo ti ON ti.TeamId = ids.TeamId
            LEFT JOIN LeagueTeamNames lt ON lt.LeagueId = ? AND lt.TeamId = ids.TeamId
            LEFT JOIN games ON games.TeamId = ids.TeamId
            LEFT JOIN LeagueStandings ls ON ls.LeagueId = ? AND ls.TeamId = ids.TeamId
            LEFT JOIN Neustadtl n ON n.LeagueId = ? AND n.TeamId = ids.TeamId
            LEFT JOIN LeagueGroups lg ON lg.LeagueId = ? AND lg.TeamId = ids.TeamId
            LEFT JOIN GroupNames gn ON gn.LeagueId = ? AND gn.GroupId = lg.GroupId
            ORDER BY CASE WHEN lg.GroupId IS NULL THEN 1 ELSE 0 END, lg.GroupId, TeamName
        `, Array(12).fill(leagueId));
    }

    adminCurrentTeamMatches(teamId){
        return this.queryDatabase(`
            SELECT 
                mt.MatchId
            FROM MatchTeam mt
            JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
            JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId
            WHERE li.Active = 1
            AND (mt.TeamRad = ? OR mt.TeamDire = ?)
            ORDER BY mt.MatchId DESC;
            `,[teamId,teamId]);
    }

    adminCurrentTeamStandings(teamId){
        return this.queryDatabase(`
            SELECT 
                ls.TeamId,
                ti.TeamName,
                ls.Wins,
                ls.Losses
            FROM LeagueStandings ls
            JOIN LeagueInfo li ON ls.LeagueId = li.LeagueId
            JOIN TeamInfo ti on ti.TeamId = ls.TeamId
            WHERE li.Active = 1
            AND ls.TeamId = ?
            `,[teamId]);
    }

    adminUpdateTeamStandings(teamId,wins,losses){
        try{
            const currLeague = this.getActiveLeague();

            this.db.prepare(`
                UPDATE LeagueStandings SET Wins = ?, Losses = ? WHERE TeamId = ? AND LeagueId = ?
                `).run(wins,losses,teamId,currLeague[0].LeagueId);
     

            this.db.prepare(`INSERT INTO AdminAuditLog (
                                    Type,
                                    Message
                                )
                                VALUES (
                                    'Standings Update',
                                    'UpdatedStandings with Wins: ${wins},Losses: ${losses}, for teamId: ${teamId} and leagueId: ${currLeague[0].LeagueId}'
                                );
                            `).run();

          return { success: true, message: 'Team Standing updated successfully!' };
        } catch (err) {
           return { success: false, error: err };
        }
            
    }

    insertMatchLeague(matchLeagueIds) {
        try {
            const insertQuery = `INSERT INTO MatchLeague (MatchId, LeagueId, DatePlayed)
                                 VALUES (@match_id, @league_id, @date_played)`;
            const insertStatement = this.db.prepare(insertQuery);
            for (const matchLeagues of matchLeagueIds) {
                insertStatement.run(matchLeagues);
            }
            return 1;
        } catch (err) {
            return 2;
        }
    }

    InsertMatchTeamPlayer(matchId, playerId, teamCode) {
        if (teamCode !== 'R' && teamCode !== 'D') {
            throw new Error('Invalid teamCode, must be "R" or "D"');
        }

        try {
            // Get TeamId safely with param binding
            const teamRow = this.queryDatabase(
                `SELECT 
                    CASE
                        WHEN ? = 'R' THEN TeamRad
                        WHEN ? = 'D' THEN TeamDire
                    END AS TeamId
                 FROM MatchTeam
                 WHERE MatchId = ?`,
                [teamCode, teamCode, matchId]
            );

            if (!teamRow || teamRow.length === 0) {
                throw new Error(`No MatchTeam found for MatchId ${matchId}`);
            }

            const teamId = teamRow[0].TeamId;

            const stmt = this.db.prepare(`INSERT INTO MatchTeamPlayer (MatchId, PlayerId, TeamId)
                                          VALUES (@match_id, @player_id, @team_id)`);
            stmt.run({
                match_id: matchId,
                player_id: playerId,
                team_id: teamId
            });

            return 1;
        } catch (err) {
            console.log(err);
            console.log(`Error adding ${teamCode} to Player id: ${playerId} for Match Id: ${matchId6}`);

            return 2;
        }
    }

    insertMatchDetailsPlayer(matchId, playerData) {
        try {
            const stmt = this.db.prepare(`INSERT INTO MatchPlayer 
                (MatchId, PlayerId, HeroId, Kills, Deaths, Assists, Networth, Lasthits, HeroDamage, GPM, XPM, Winner, Healing, TowerDamage)
                VALUES 
                (@match_id, @account_id, @hero_id, @kills, @deaths, @assists, @networth, @lasthits, @hero_damage, @gold_per_min, @xp_per_min, @win, @heal, @tower_damage)`);
            playerData.forEach(player => {
                stmt.run({
                    match_id: matchId,
                    account_id: player.account_id,
                    hero_id: player.hero_id,
                    kills: player.kills,
                    deaths: player.deaths,
                    assists: player.assists,
                    networth: player.net_worth,
                    lasthits: player.last_hits,
                    hero_damage: player.hero_damage,
                    gold_per_min: player.gold_per_min,
                    xp_per_min: player.xp_per_min,
                    win: player.win,
                    heal: player.hero_healing,
                    tower_damage: player.tower_damage
                });
            });
            return 1;
        } catch (err) {
            console.log(err);
            return 2;
        }
    }

    insertNewPlayers(playerData) {
        try {
            const stmt = this.db.prepare(`INSERT INTO PlayerInfo (PlayerId, PlayerName)
                                          VALUES (@player_id, @player_name)`);
            playerData.forEach(player => {
                stmt.run({
                    player_id: player.player_id,
                    player_name: player.player_name
                });
            });
            return 1;
        } catch (err) {
            console.log(err);
            return 2;
        }
    }

    insertPickBanData(matchId, pick_bans) {
        try {
            const stmt = this.db.prepare(`INSERT INTO PickInfo (MatchId, IsPick, Hero_Id, OrderNum, Team)
                                          VALUES (@match_id, @is_pick, @hero_id, @order_num, @team)`);
            pick_bans.forEach(pick_ban => {
                const isPickVal = pick_ban.is_pick ? 1 : 0;
                stmt.run({
                    match_id: matchId,
                    is_pick: isPickVal,
                    hero_id: pick_ban.hero_id,
                    order_num: pick_ban.order,
                    team: pick_ban.team
                });
            });
            return 1;
        } catch (err) {
            console.log(err);
            console.log(`Error adding pick ban data for Match Id ${matchId}, Ban Data: ${pick_bans}`);

            return 2;
        }
    }

    insertTeamWin(matchId, winner) {
        try {
            const stmt = this.db.prepare(`UPDATE MatchTeam SET WinnerId = @winner_team_id WHERE MatchId = @match_id`);
            stmt.run({
                winner_team_id: winner,
                match_id: matchId
            });
            return 1;
        } catch (err) {
            console.log(err);
            return 2;
        }
    }

    insertDuration(matchId,duration){
        try {
            const stmt = this.db.prepare(`UPDATE MatchTeam SET Duration = @time WHERE MatchId = @match_id`);
            stmt.run({
                time: duration,
                match_id: matchId
            });
            return 1;
        } catch (err) {
            console.log(err);
            return 2;
        }
    }

    insertLeagueStanding(matchId, winId, loseId){
        try {
            const league = this.queryDatabase(
                                `SELECT
                                ml.LeagueId
                                FROM MatchLeague ml
                                WHERE ml.MatchId = ?`,
                                [matchId]);


            const boundary = this.queryDatabase(
                `SELECT GroupEndMatchId FROM LeagueStageBoundaries WHERE LeagueId = ?`,
                [league[0].LeagueId]
            );

            if(boundary.length === 0 || matchId <= boundary.GroupEndMatchId){
                this.db.prepare(`
                    INSERT INTO LeagueStandings (LeagueId, TeamId, Wins, Losses)
                    VALUES (@leagueId, @teamId, 1, 0)
                    ON CONFLICT(LeagueId, TeamId)
                    DO UPDATE SET Wins = Wins + 1
                `).run({ leagueId: league[0].LeagueId, teamId: winId });

                // Loser
                this.db.prepare(`
                    INSERT INTO LeagueStandings (LeagueId, TeamId, Wins, Losses)
                    VALUES (@leagueId, @teamId, 0, 1)
                    ON CONFLICT(LeagueId, TeamId)
                    DO UPDATE SET Losses = Losses + 1
                `).run({ leagueId: league[0].LeagueId, teamId: loseId });
            }
        } catch (err) {
            console.log(err);
            return 2;
        }
    }

    checkSeries(teamA,teamB){
        return this.queryDatabase(`
            SELECT SeriesId from TempSeriesInfo 
            WHERE (Team1 = ? AND Team2 = ?) OR (Team1 = ? AND Team2 = ?)
            `,
            [teamA,teamB,teamB,teamA]
        );
    }

    getOrCreateSeriesId(teamA, teamB, stage, leagueId, dateCreated) {
        try {
            // A. Check if the series exists in the MAIN table for this specific date
            // We MUST check DateCreated to separate future matches between the same teams
            const checkStmt = this.db.prepare(`
                SELECT SeriesId FROM SeriesInfo 
                WHERE ((Team1 = ? AND Team2 = ?) OR (Team1 = ? AND Team2 = ?))
                AND DateCreated = ? 
                AND LeagueId = ?
            `);
            
            const existing = checkStmt.get(teamA, teamB, teamB, teamA, dateCreated, leagueId);

            if (existing) {
                return existing.SeriesId;
            }

            // B. If it doesn't exist, Insert into MAIN table immediately
            const insertStmt = this.db.prepare(`
                INSERT INTO SeriesInfo (Team1, Team2, Stage, LeagueId, DateCreated)
                VALUES (@team1, @team2, @stage, @LeagueId, @DateCreated)
            `);

            const result = insertStmt.run({
                team1: teamA,
                team2: teamB,
                stage: stage,
                LeagueId: leagueId,
                DateCreated: dateCreated
            });

            // SQLite automatically generates the unique SeriesId here
            return result.lastInsertRowid;

        } catch (err) {
            console.error("Error in getOrCreateSeriesId:", err);
            throw err; // Throw so the main loop knows to stop or log
        }
    }

    insertSeriesMatch(seriesId, matchId, date) {
        try {
            // Use INSERT OR IGNORE to prevent crashing if we run the script twice
            const stmt = this.db.prepare(`
                INSERT OR IGNORE INTO SeriesMatch (SeriesId, MatchId, DateCreated)
                VALUES (@SeriesId, @MatchId, @DateCreated)
            `);
            stmt.run({
                SeriesId: seriesId,
                MatchId: matchId,
                DateCreated: date
            });
            return 1;
        } catch (err) {
            console.error(`Failed to link Match ${matchId} to Series ${seriesId}`, err);
            return 2;
        }
    }

    insertScheduledSeries(matches){
        matches.forEach(match => {
            const team1 = this.getTeamIdByName(match.team1)
            const team2 = this.getTeamIdByName(match.team2)

            console.log(match.team2,team2)

            const stmt = this.db.prepare(`INSERT OR IGNORE INTO ScheduledSeries (Team1,Team2,Date)
                                        VALUES (@Team1,@Team2,@Date);`);
            stmt.run({
                Team1: team1[0].TeamId,
                Team2: team2[0].TeamId,
                Date: match.date
            });
        })
    }

    getTeamIdByName(teamName){
        return this.queryDatabase(`
            SELECT TeamId
            FROM TeamInfo 
            WHERE LOWER(TeamName) = ?`, [teamName.toLowerCase()])
    }

    getStage(){
        return this.queryDatabase(
            `SELECT
                CASE
                    -- No boundary rows at all → group stage "g"
                    WHEN NOT EXISTS (
                    SELECT 1
                    FROM LeagueStageBoundaries b
                    JOIN LeagueInfo li ON li.LeagueId = b.LeagueId
                    WHERE li.Active = 1
                    ) THEN 'g'

                    -- Has group end but NO tiebreak end → "t"
                    WHEN EXISTS (
                    SELECT 1
                    FROM LeagueStageBoundaries b
                    JOIN LeagueInfo li ON li.LeagueId = b.LeagueId
                    WHERE li.Active = 1
                        AND b.GroupEndMatchId IS NOT NULL
                        AND b.TieBreakerEndMatchId IS NULL
                    ) THEN 't'

                    -- Has group end AND tiebreak end → "p"
                    WHEN EXISTS (
                    SELECT 1
                    FROM LeagueStageBoundaries b
                    JOIN LeagueInfo li ON li.LeagueId = b.LeagueId
                    WHERE li.Active = 1
                        AND b.GroupEndMatchId IS NOT NULL
                        AND b.TieBreakerEndMatchId IS NOT NULL
                    ) THEN 'p'

                    ELSE 'g'
                END AS Stage;
                `
        )
    }


    getRequests(){
        return this.db.prepare(`SELECT c.ProblemId, c.UserId,
                COALESCE(CAST(pi.PlayerName AS TEXT), 'Unknown player') AS PlayerName,
                c.Comment
            FROM Comments c
            LEFT JOIN PlayerInfo pi ON pi.PlayerId = c.UserId
            ORDER BY c.ProblemId DESC`).all();
    }

    deleteRequest(problemId, adminPlayerId){
        return this.db.transaction(() => {
            const deleted = this.db.prepare('DELETE FROM Comments WHERE ProblemId = ?')
                .run(problemId).changes;
            if (deleted) {
                this.db.prepare('INSERT INTO AdminAuditLog (Type, Message) VALUES (?, ?)').run(
                    'Request Delete', `Admin ${adminPlayerId} deleted request ${problemId}`
                );
            }
            return deleted;
        })();
    }

    insertRequest(userId, message){
        try {
            this.db.prepare(`
                INSERT INTO Comments (
                         UserId,
                         Comment
                     )
                     VALUES (
                         ?,
                         ?
                     );

            `).run(userId,message);

            return { success: true, message: 'Comment updated successfully!' };
        } catch (err) {
            return { success: false, message: err };;
        }
    }

    updateNeustadtl(standings){
        const insertQuery = `
            INSERT INTO Neustadtl (TeamId, Score, LeagueId)
                VALUES (?, ?, ?)
                ON CONFLICT(TeamId, LeagueId)
                DO UPDATE SET Score = excluded.Score
            `;
        const insertStmt = this.db.prepare(insertQuery);
        
        const transaction = this.db.transaction((rows) => {
            rows.forEach(row => {
                insertStmt.run(row.TeamId, row.Neustadtl, row.LeagueId);
            })
        })

        transaction(standings);
    }

    legacyNeustadtl(){
        const legacyCheck = this.queryDatabase(`
                SELECT * FROM
                NeustadtlLegacy nl 
                JOIN LeagueInfo li on nl.LeagueId = li.LeagueId
                WHERE li.Active = 1
            `);

        if(legacyCheck.length === 0){
            const activeLeague = this.getActiveLeague();

            this.db.prepare(`
                    INSERT INTO NeustadtlLegacy (LeagueId, TeamId, Score)
                        SELECT 
                            ? AS LeagueId,
                            TeamId,
                            Score
                        FROM Neustadtl
                `).run(activeLeague[0].leagueId);

            return "Legacy data inserted into Database";
        }
        else
            return "Legacy data already added into Database";
    }

    deleteRemakeMatch(matchId){
        try{
            this.db.prepare(`DELETE FROM MatchTeam WHERE MatchId = ?`).run(matchId);
            console.log(`Deleted MatchTeam info for `+matchId)

            this.db.prepare(`DELETE FROM MatchLeague WHERE MatchId = ?`).run(matchId);
            console.log(`Deleted MatchLeague info for `+matchId)

        } catch(err) {
            console.log(err);
            return -1;
        }
    }

    adminDeleteMatch(matchId){
        try{

            this.db.prepare('DELETE FROM MatchPlayer WHERE MatchId = ?')
                    .run( matchId);

            this.db.prepare(`INSERT INTO AdminAuditLog (
                                Type,
                                Message
                            )
                            VALUES (
                                'MatchPlayer Delete',
                                'Deleted Match ${matchId} From MatchPlayer'
                            );
                        `).run();


            this.db.prepare('DELETE FROM MatchTeam WHERE MatchId = ?')
                    .run(matchId);

            this.db.prepare(`INSERT INTO AdminAuditLog (
                                Type,
                                Message
                            )
                            VALUES (
                                'MatchTeam Delete',
                                'Deleted Match ${matchId} From MatchTeam'
                            );
                        `).run();
            
            this.db.prepare('DELETE FROM MatchLeague WHERE MatchId = ?')
                    .run(matchId);

            this.db.prepare(`INSERT INTO AdminAuditLog (
                                Type,
                                Message
                            )
                            VALUES (
                                'MatchLeague Delete',
                                'Deleted Match ${matchId} From MatchLeague'
                            );
                        `).run();

            this.db.prepare('DELETE FROM MatchTeamPlayer WHERE MatchId = ?')
                    .run(matchId);

            this.db.prepare(`INSERT INTO AdminAuditLog (
                                Type,
                                Message
                            )
                            VALUES (
                                'MatchTeamPlayer Delete',
                                'Deleted Match ${matchId} From MatchTeamPlayer'
                            );
                        `).run();
            return { success: true, message: 'MatchDeleted updated successfully!' };
        } catch (err) {
           return { success: false, error: err };
        }
    }

    login(username, steamid, date){
        try {
            let isNewUser = false;
            const existingUser = this.queryDatabase(`
                SELECT SteamID FROM Logins WHERE SteamId = ?`, [steamid]);

            if(existingUser.length === 0)
                isNewUser = true;

            const stmt = this.db.prepare(`INSERT OR REPLACE INTO Logins (Username, SteamID, LastLoginDate)
                                          VALUES (@username, @steamId, @LastLoginDate)`);
            stmt.run({
                username: username,
                steamId: this.steamId64ToAccountId(steamid),
                LastLoginDate: date
            });


            if(isNewUser){
                dbBet.createWallet(this.steamId64ToAccountId(steamid));
            }


            return 1;
        } catch (err) {
            console.log(err);
            return 2;
        }
    }
    
    getLastMatchForLeague(leagueId){
        return this.queryDatabase(`
                SELECT mt.MatchId 
                FROM MatchTeam mt
                JOIN MatchLeague ml on ml.MatchId = mt.MatchId
                WHERE ml.LeagueId = ?
                ORDER BY mt.MatchId DESC
                LIMIT 1
            `,[leagueId]);
    }

    getLastMatchForActiveLeague(){
        return this.queryDatabase(`
                SELECT mt.MatchId 
                FROM MatchTeam mt
                JOIN MatchLeague ml on ml.MatchId = mt.MatchId
                JOIN LeagueInfo li on li.LeagueId = ml.LeagueId
                WHERE li.Active = 1
                ORDER BY mt.MatchId DESC
                LIMIT 1
            `);
    }


    steamId64ToAccountId(steamId64) {
        const base = BigInt('76561197960265728');
        return (BigInt(steamId64) - base).toString(); // returns string to safely handle large numbers
    }
    
    
}

const dbInstance = new DBInstance();
export default dbInstance;
