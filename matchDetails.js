import db from './database.js';
import apiUrl from './apiURL.js';

let matchDetailCallsToday = 0;
const MAX_CALLS_PER_DAY = 2000;
const MIN_INTERVAL_MS = 1000; // 1 call per second

const knownPlayers = new Set(db.preloadedData.users.map(p => p.PlayerId));

const unparsedMatches = db.getUnParsedMatchIds(); // This should return a Set or Array of MatchIds already processed
console.log(`${unparsedMatches.length} Matches that need to be parsed by Open Dota`);

getMatchDetails(unparsedMatches);

async function getMatchDetails(matches){
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

            if(data.picks_bans)
                db.insertPickBanData(match.MatchId,data.picks_bans);

            db.insertMatchDetailsPlayer(match.MatchId, data.players);
     

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

            db.insertTeamWin(match.MatchId, winTeamId);
            db.insertDuration(match.MatchId,data.duration);

            //creating series
            let yesterdaysDate = new Date();
            yesterdaysDate.setDate(yesterdaysDate.getDate() - 1);
            yesterdaysDate = yesterdaysDate.toISOString().split('T')[0];

            const existing = db.checkSeries(data.dire_team_id,data.radiant_team_id);
            
            let seriesId;

            if (existing.length === 0) {
                const resultSeries = db.insertTempSeries(data.dire_team_id,data.radiant_team_id,yesterdaysDate)

                if(resultSeries === 2)
                    console.error(`Failed to insert series ${data.dire_team_id} - ${data.radiant_team_id}`);
                
                seriesId = resultSeries;
            } else {
                seriesId = existing[0].SeriesId;
            }

            const seriesMatch = db.insertSeriesMatch(seriesId,match.MatchId);
            if(seriesMatch === 2)
                console.error(`Failed to insert series match ${seriesId} - ${match.MatchId}`);
            
            db.insertLeagueStanding(match.MatchId, winTeamId, loseTeamId)
        } catch (err) {
            console.error(`Failed to fetch match ${match.MatchId}:`, err);
        }
    }


    const insertFromTemp = db.insertTempIntoSeries();

    if(insertFromTemp === -1)
        console.error(`Failed to insert into SeriesInfo from TempSeriesInfo match`);


    if(badMatches.length > 0)
    {
        console.log(`Inserted ${badMatches.length} with info:`)
        for(const match of badMatches)
        {
            console.log(`Match: ${match.match_id} has ${match.num_players}`);
        }
    }
}