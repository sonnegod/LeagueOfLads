import db from './database.js';
import apiUrl from './apiURL.js';

let matchDetailCallsToday = 0;
const MAX_CALLS_PER_DAY = 2000;
const MIN_INTERVAL_MS = 1000; // 1 call per second

const knownPlayers = new Set(db.preloadedData.users.map(p => p.PlayerId));
const leagueId = db.getActiveLeague()?.[0]?.LeagueId;

if (!leagueId) {
    console.log("No active league. Skipping match detail load.");
} else {
    console.log("Beginning match detail load");

    const unparsedMatches = db.getUnParsedMatchIds();
    console.log(`${unparsedMatches.length} Matches that need to be parsed by Open Dota`);

    const currentStage = db.getStage()?.[0]?.Stage || 'g';
    getMatchDetails(unparsedMatches, currentStage, leagueId);
}

async function getMatchDetails(matches, currentStage, leagueId){
    const badMatches = [];

    for(const match of matches){
        if (matchDetailCallsToday >= MAX_CALLS_PER_DAY) {
            console.warn("API daily limit reached. Stopping further calls.");
            break;
        }

        const matchId = match.MatchId;
        
        await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS)); // throttle per call

        try {
            const response = await fetch(apiUrl.baseMatchData + match.MatchId, { method: 'GET' });
            const data = await response.json();

            matchDetailCallsToday++;
            console.log(`(${matchDetailCallsToday}) Match ${match.MatchId} details pulled.`);

            //indicates that this match got remade
            if(data.radiant_score === 0 && data.dire_score === 0){
                db.deleteRemakeMatch(match.MatchId);
            }
            else{
                if(data.picks_bans)
                    db.insertPickBanData(match.MatchId,data.picks_bans);      

                // Insert new players (optimized from earlier step) here...
                const newPlayers = [];


                if(data.players.length < 10)
                {
                    badMatches.push({
                        match_id: match.MatchId,
                        player_number: data.players.length,
                    }); 
                }

                for (const player of data.players) {
                    const accountId = player.account_id;

                    if (accountId && !knownPlayers.has(accountId)) {
                        knownPlayers.add(accountId); // add to set so we don’t check again
                        newPlayers.push({
                            player_id: accountId,
                            player_name: player.personaname || '', // fallback to null if not present
                        });
                    }
                    if (accountId !== null && accountId !== undefined) {
                        let teamCode = null;

                        if (player.player_slot >= 0 && player.player_slot <= 4) {
                            teamCode = 'R'; // Radiant
                        } else if (player.player_slot >= 128 && player.player_slot <= 132) {
                            teamCode = 'D'; // Dire
                        }

                        if (teamCode) {
                            db.InsertMatchTeamPlayer(matchId, accountId, teamCode);
                        }
                    }
                }

                if (newPlayers.length > 0) {
                    db.insertNewPlayers(newPlayers); 
                    console.log(`Inserted ${newPlayers.length} new players.`);
                }

                const winTeamId = data.radiant_win
                    ? data.radiant_team_id
                    : data.dire_team_id;

                const loseTeamId = data.radiant_win
                    ? data.dire_team_id
                    : data.radiant_team_id;

                db.insertMatchDetailsPlayer(match.MatchId, data.players);

                db.insertTeamWin(match.MatchId, winTeamId);
                db.insertDuration(match.MatchId,data.duration);

                //creating series
                const now = new Date();
                const yesterday = new Date(now);
                yesterday.setDate(now.getDate() - 1);

                // 3. Format specifically for New York (EST/EDT) in YYYY-MM-DD format
                const yesterdaysDate = new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'America/New_York',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).format(yesterday);

                
                try {
                    // 1. Get the Series ID (Finds existing one for today, or creates new one)
                    const seriesId = db.getOrCreateSeriesId(
                        data.dire_team_id, 
                        data.radiant_team_id, 
                        currentStage, 
                        leagueId,
                        yesterdaysDate
                    );

                    // 2. Link the Match to the Series
                    const resultMatch = db.insertSeriesMatch(seriesId, match.MatchId, yesterdaysDate);
                    
                    
                    if(resultMatch === 2) {
                        console.warn(`Issue linking match ${match.MatchId} to series ${seriesId}`);
                    }

                    // 3. Handle Standings
                    if (currentStage === 'g') {
                        db.insertLeagueStanding(match.MatchId, winTeamId, loseTeamId);
                    }

                } catch (err) {
                    console.error(`CRITICAL FAILURE processing match ${match.MatchId}:`, err);
                    console.error(`Data dump: Dire: ${data.dire_team_id}, Radiant: ${data.radiant_team_id}, Date: ${yesterdaysDate}`);
                }

            }
        } catch (err) {
            console.error(`Failed to fetch match ${match.MatchId}:`, err);
        }
    }


    if(badMatches.length > 0)
    {
        console.log(`Inserted ${badMatches.length} with info:`)
        for(const match of badMatches)
        {
            console.log(`Match: ${match.match_id} has ${match.num_players}`);
        }
    }
}
