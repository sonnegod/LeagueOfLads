import Database from "better-sqlite3";

class DBInstance {
    constructor(){
        if(!DBInstance.instance){
            this.db = new Database('./db/LadsData.db');
            this.preloadedData = this.preloadData();
            DBInstance.instance = this;
        }

        return DBInstance.instance;
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
                ti.TeamName,
                CASE WHEN mt.TeamRad = mt.WinnerId THEN 1 ELSE 0 END AS Winner,
                li.LeagueId,
                li.LeagueName
            FROM MatchTeam mt
            JOIN TeamInfo ti ON ti.TeamId = mt.TeamRad
            JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
            JOIN LeagueInfo li ON li.LeagueId = ml.LeagueId

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

    getCurrentLeagueSeries(){
            return this.queryDatabase(
            `SELECT 
            si.SeriesId,
            si.Team1, 
            si.Team2, 
            ti1.TeamName as team_one,
            ti2.TeamName as team_two,
            si.DateCreated 
            FROM 
            SeriesInfo si 
            JOIN SeriesMatch sm on si.SeriesId = sm.SeriesId
            JOIN MatchLeague ml on sm.MatchId = ml.MatchId
            JOIN LeagueInfo li on ml.LeagueId = li.LeagueId
            JOIN TeamInfo ti1 on ti1.TeamId = si.Team1
            JOIN TeamInfo ti2 on ti2.TeamId = si.Team2
            WHERE li.Active = 1
            GROUP BY si.SeriesId
            ORDER BY si.SeriesId DESC`
        );
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

    getCurrentLeagueLeaderboard(){

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
            `SELECT pi.IsPick,pi.Hero_Id,pi.OrderNum,hi.HeroName, pi.Team
             FROM PickInfo pi
             JOIN HeroInfo hi on pi.Hero_Id = hi.HeroId
             WHERE MatchId = ?`,
            [matchId]
        );
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
            CASE WHEN mt.TeamRad = mt.WinnerId THEN mt.TeamRad
                WHEN mt.TeamDire = mt.WinnerId THEN mt.TeamDire
                ELSE NULL END AS WinnerTeamId,
            ti.TeamName AS WinnerTeamName
            FROM LeagueInfo li
            LEFT JOIN MatchLeague ml ON li.LeagueId = ml.LeagueId
            LEFT JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
            LEFT JOIN TeamInfo ti ON ti.TeamId = 
                CASE WHEN mt.TeamRad = mt.WinnerId THEN mt.TeamRad
                    WHEN mt.TeamDire = mt.WinnerId THEN mt.TeamDire END
            WHERE ml.MatchId = (
                SELECT MAX(ml2.MatchId)
                FROM MatchLeague ml2
                WHERE ml2.LeagueId = li.LeagueId)
            ORDER BY li.LeagueId DESC`
            );
    }

    getLeagueData(leagueId){
        return this.queryDatabase(
            `SELECT
            li.Active,
            li.LeagueId,
            li.LeagueName,
            CASE WHEN mt.TeamRad = mt.WinnerId THEN mt.TeamRad
                WHEN mt.TeamDire = mt.WinnerId THEN mt.TeamDire
                ELSE NULL END AS WinnerTeamId,
            ti.TeamName AS WinnerTeamName
            FROM LeagueInfo li
            LEFT JOIN MatchLeague ml ON li.LeagueId = ml.LeagueId
            LEFT JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
            LEFT JOIN TeamInfo ti ON ti.TeamId = 
                CASE WHEN mt.TeamRad = mt.WinnerId THEN mt.TeamRad
                    WHEN mt.TeamDire = mt.WinnerId THEN mt.TeamDire END
            WHERE ml.MatchId = (
                SELECT MAX(ml2.MatchId)
                FROM MatchLeague ml2
                WHERE ml2.LeagueId = li.LeagueId)
                AND li.LeagueId = ?
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
            tr.TeamName AS RadiantTeamName,
            mt.TeamDire AS DireTeamId,
            td.TeamName AS DireTeamName,
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

            console.log(league)
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

    insertTempSeries(teamA,teamB,dateCreated){
        try {
            const stmt = this.db.prepare(`INSERT INTO TempSeriesInfo (Team1, Team2, DateCreated)
                                          VALUES (@team1, @team2, @DateCreated)`);
            const result = stmt.run({
                team1: teamA,
                team2: teamB,
                DateCreated: dateCreated
            });
            return result.lastInsertRowid;
        } catch (err) {
            console.log(err);
            return 2;
        }
    }

    insertSeriesMatch(seriesId,matchId){
        try {
            const stmt = this.db.prepare(`INSERT INTO SeriesMatch (SeriesId, MatchId)
                                          VALUES (@SeriesId, @MatchId)`);
            stmt.run({
                SeriesId: seriesId,
                MatchId: matchId
            });
            return 1;
        } catch (err) {
            console.log(err);
            return 2;
        }
    }

    insertTempIntoSeries(){
        try {
            const insertStmt = this.db.prepare(`
                INSERT INTO SeriesInfo (SeriesId, Team1, Team2, DateCreated)
                SELECT SeriesId, Team1, Team2, DateCreated FROM TempSeriesInfo
            `);
            const info = insertStmt.run();
            console.log(`Inserted ${info.changes} rows into SeriesInfo`);

            const deleteStmt = this.db.prepare(`DELETE FROM TempSeriesInfo`);
            const delInfo = deleteStmt.run();
            console.log(`Deleted ${delInfo.changes} rows from TempSeriesInfo`);

            return info.changes; 
        } catch (err) {
            console.log(err);
            return -1;
        }
    }

    login(username, steamid, date){
        try {
            const stmt = this.db.prepare(`INSERT INTO Logins (Username, SteamID, LoginDate)
                                          VALUES (@username, @steamId, @loginDate)`);
            stmt.run({
                username: username,
                steamId: steamid,
                loginDate: date
            });
            return 1;
        } catch (err) {
            console.log(err);
            return 2;
        }
    }
    
}

const dbInstance = new DBInstance();
export default dbInstance;