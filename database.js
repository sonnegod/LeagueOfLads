import Database from "better-sqlite3";
import dotenv from 'dotenv';
dotenv.config();

class DBInstance {
    constructor(){
        if(!DBInstance.instance){
            const dbPath =
                process.env.ENVIRONMENT === 'DEV'
                ? './db/LadsData.db'
                : '/root/LeagueOfLads/db/LadsData.db';
                
            this.db = new Database(dbPath);
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
            SELECT LeagueId 
            FROM LeagueInfo 
            WHERE Active = 1`);
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
            JOIN LeagueInfo li on ps.LeagueId = li.LeagueId
            JOIN TeamInfo ti on ti.TeamId = ps.TeamId
            WHERE li.Active = 1
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

    getCurrentLeagueSeriesGroupstage(){
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
            JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId AND li.Active = 1
            LEFT JOIN LeagueStageBoundaries lsb ON lsb.LeagueId = li.LeagueId
            JOIN TeamInfo ti1 ON ti1.TeamId = si.Team1
            JOIN TeamInfo ti2 ON ti2.TeamId = si.Team2
            WHERE (lsb.GroupEndMatchId IS NULL OR sm.MatchId <= lsb.GroupEndMatchId)
            GROUP BY si.SeriesId
            ORDER BY si.SeriesId DESC;`
        );
    }

    getCurrentLeagueSeriesTieBreakers(){
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
            JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId AND li.Active = 1
            LEFT JOIN LeagueStageBoundaries lsb ON lsb.LeagueId = li.LeagueId
            JOIN TeamInfo ti1 ON ti1.TeamId = si.Team1
            JOIN TeamInfo ti2 ON ti2.TeamId = si.Team2
            WHERE (sm.MatchId > lsb.GroupEndMatchId AND sm.MatchId <= lsb.TieBreakerEndMatchId)
            GROUP BY si.SeriesId
            ORDER BY si.SeriesId DESC;`
        );
    }

    getCurrentLeagueSeriesPlayoffs(){
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
            JOIN LeagueInfo li ON ml.LeagueId = li.LeagueId AND li.Active = 1
            LEFT JOIN LeagueStageBoundaries lsb ON lsb.LeagueId = li.LeagueId
            JOIN TeamInfo ti1 ON ti1.TeamId = si.Team1
            JOIN TeamInfo ti2 ON ti2.TeamId = si.Team2
            WHERE (sm.MatchId > lsb.TieBreakerEndMatchId)
            GROUP BY si.SeriesId
            ORDER BY si.SeriesId DESC;`
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

                    const playoffTeams = groupTeams.slice(0, 8);        // top 2


                    return {
                    ...group,
                    teams: playoffTeams
                    };
                })
            );

            groupsWithTeams.forEach(group => {
                group.teams.forEach((team,idx) => {
                    const seedNumber = idx + 1;
                    const bracket = seedNumber <= 3 ? 'upper' : 'lower';

                    this.addSeeding(group.LeagueId,team.TeamId,seedNumber,bracket)
                });
            });

            } catch (err) {
            console.error(err);
        }
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
                    GROUP BY SI.SeriesId
                    ORDER BY SI.SeriesId DESC
                    LIMIT 1
                `,[team1Id,team2Id,team1Id,team2Id,team2Id,team1Id])
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
            SELECT DISTINCT lg.GroupID, g.GroupName, lg.LeagueId
            FROM LeagueGroups lg
            JOIN GroupNames g on g.GroupId = lg.GroupId
            Join LeagueInfo l on l.LeagueId = lg.LeagueId
            WHERE l.Active = 1
            ORDER BY lg.GroupID
        `);
        
    }

    getGroupStats(groupInfo){
        return this.queryDatabase( `
            SELECT lg.TeamId, t.TeamName, ls.Wins, ls.Losses, n.Score
                FROM LeagueGroups lg
                JOIN TeamInfo t ON t.TeamId = lg.TeamId
                JOIN GroupNames g on g.GroupId = lg.GroupId
                Join LeagueInfo l on l.LeagueId = lg.LeagueId
                JOIN LeagueStandings ls on ls.LeagueId = lg.LeagueId AND ls.TeamId = lg.TeamId
                JOIN Neustadtl n on n.TeamId = lg.TeamId
                WHERE lg.GroupId = ? AND lg.LeagueId = ?
                ORDER BY ls.Wins DESC,n.Score DESC 
        `,[groupInfo.GroupId, groupInfo.LeagueId]);

    };

    getHeadToHeadStats(groupInfo){
        return this.queryDatabase( `
            SELECT
                T1.TeamId AS TeamA,
                T1.TeamName AS TeamAName,
                T2.TeamId AS TeamB,
                T2.TeamName AS TeamBName,
                SUM(CASE WHEN MT.WinnerId = T1.TeamId THEN 1 ELSE 0 END) AS WinsA,
                SUM(CASE WHEN MT.WinnerId = T2.TeamId THEN 1 ELSE 0 END) AS WinsB,
                COUNT(MT.MatchId) AS MatchesPlayed
            FROM LeagueGroups LG

            -- Get all teams in the group
            JOIN LeagueGroups LG2
                ON LG.GroupId = LG2.GroupId
            AND LG.LeagueId = LG2.LeagueId

            -- Pair teams together (T1 vs T2)
            JOIN TeamInfo T1 ON T1.TeamId = LG.TeamId
            JOIN TeamInfo T2 ON T2.TeamId = LG2.TeamId AND T1.TeamId < T2.TeamId

            -- Find any series-containing matches between Team1 + Team2
            JOIN SeriesInfo SI 
            ON (SI.Team1 = T1.TeamId AND SI.Team2 = T2.TeamId)
            OR (SI.Team1 = T2.TeamId AND SI.Team2 = T1.TeamId)
            JOIN SeriesMatch SM
            ON SM.SeriesId = SI.SeriesId
            JOIN MatchTeam MT
            ON MT.MatchId = SM.MatchId
            LEFT JOIN LeagueStageBoundaries LSB
                ON LSB.LeagueId = LG.LeagueId

            WHERE LG.LeagueId = ?
            AND LG.GroupId = ?

            -- Filter only group-stage matches IF boundary exists
            AND (
                    LSB.GroupEndMatchId IS NULL
                    OR MT.MatchId <= LSB.GroupEndMatchId
                )
            GROUP BY
                TeamA, TeamAName,
                TeamB, TeamBName

            ORDER BY TeamAName, TeamBName;
        `,[groupInfo.LeagueId,groupInfo.GroupId]);
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

    adminCurrentTeams(){
        return this.queryDatabase(`
           SELECT 
                t.TeamId,
                t.TeamName,
                COALESCE(m.MatchesPlayed, 0) AS MatchesPlayed,
                ls.Wins,
                ls.Losses
            FROM TeamInfo t

            -- Aggregate matches first
            LEFT JOIN (
                SELECT 
                    ti.TeamId,
                            ti.TeamName,
                            COUNT(mt.MatchId) AS MatchesPlayed
                        FROM TeamInfo ti
                        JOIN MatchTeam mt 
                            ON ti.TeamId = mt.TeamRad 
                            OR ti.TeamId = mt.TeamDire
                        JOIN MatchLeague ml
                            ON ml.MatchId = mt.MatchId
                        JOIN LeagueInfo li
                            ON li.LeagueId = ml.LeagueId
                        WHERE li.Active = 1
                        GROUP BY ti.TeamId, ti.TeamName
                        ORDER BY MatchesPlayed DESC
            ) m ON m.TeamId = t.TeamId

            -- Correct standings join (one row per team)
            LEFT JOIN LeagueStandings ls 
                ON ls.TeamId = t.TeamId
            JOIN LeagueInfo li2 
                ON ls.LeagueId = li2.LeagueId
            WHERE li2.Active = 1

            GROUP BY 
                t.TeamId, 
                t.TeamName, 
                ls.Wins, 
                ls.Losses
            ORDER BY 
                MatchesPlayed DESC;

            `);
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

    insertTempSeries(teamA,teamB,stage,leagueId,dateCreated){
        try {
            const stmt = this.db.prepare(`INSERT INTO TempSeriesInfo (Team1, Team2,Stage,LeagueId, DateCreated)
                                          VALUES (@team1, @team2,@stage,@LeagueId, @DateCreated)`);
            const result = stmt.run({
                team1: teamA,
                team2: teamB,
                stage: stage,
                LeagueId:leagueId,
                DateCreated: dateCreated
            });
            return result.lastInsertRowid;
        } catch (err) {
            console.log(err);
            return 2;
        }
    }

    insertSeriesMatch(seriesId,matchId,date){
        try {
            const stmt = this.db.prepare(`INSERT INTO SeriesMatch (SeriesId, MatchId,DateCreated)
                                          VALUES (@SeriesId, @MatchId,@DateCreated)`);
            stmt.run({
                SeriesId: seriesId,
                MatchId: matchId,
                DateCreated: date
            });
            return 1;
        } catch (err) {
            console.log(err);
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

    insertTempIntoSeries(){
        try {
            const insertStmt = this.db.prepare(`
                INSERT INTO SeriesInfo (SeriesId, Team1, Team2,Stage,LeagueId, DateCreated)
                SELECT SeriesId, Team1, Team2,Stage,LeagueId, DateCreated FROM TempSeriesInfo
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
            INSERT INTO Neustadtl (TeamId, Score)
                VALUES (?, ?)
                ON CONFLICT(TeamId)
                DO UPDATE SET Score = excluded.Score
            `;
        const insertStmt = this.db.prepare(insertQuery);
        
        const transaction = this.db.transaction((rows) => {
            rows.forEach(row => {
                insertStmt.run(row.TeamId, row.Neustadtl);
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
            const stmt = this.db.prepare(`INSERT OR REPLACE INTO Logins (Username, SteamID, LastLoginDate)
                                          VALUES (@username, @steamId, @LastLoginDate)`);
            stmt.run({
                username: username,
                steamId: steamid,
                LastLoginDate: date
            });
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
    
    
}

const dbInstance = new DBInstance();
export default dbInstance;