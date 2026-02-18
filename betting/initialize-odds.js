import db from '../database.js';
import dbBet from '../databaseBet.js';


// --- Configuration Constants ---
const HOUSE_MARGIN = 0.10; // 10% House Edge for initial odds
const UPPER_BRACKET_WIN_PROB = 0.65; // Baseline probability for UB team (65%)

// --- Helper Functions ---

/** * Converts probability (0.0 to 1.0) to decimal odds with a house margin.
 * The margin is applied to the calculated odds to ensure the book favors the house.
 */
function calculateDecimalOdds(probability, margin = HOUSE_MARGIN) {
    if (probability <= 0) return 100.00; 
    const odds = (1 / probability) * (1 - margin);
    return parseFloat(Math.max(1.01, odds).toFixed(2));
}

/** * Calculates the probability of Team A winning against Team B using the Log5 method. */
function calculateLog5(winPctA, winPctB) {
    if (winPctA + winPctB - (2 * winPctA * winPctB) === 0) return 0.50; // Avoid division by zero
    
    const numerator = winPctA - (winPctA * winPctB);
    const denominator = winPctA + winPctB - (2 * winPctA * winPctB);
    
    return numerator / denominator;
}

/** * Calculates the closing time for betting (5 PM EST on match day).
 * Matches EST (UTC-5) time zone.
 */
function calculateMatchCloseTime(team1Id, team2Id) {
    // Assuming matchDateString is in YYYY-MM-DD format (or similar)
    let matchDay = db.getScheduledSeries(team1Id,team2Id);

    if(matchDay.length === 0)
        return -1
    
    // 5 PM EST is 10 PM UTC (or 22:00:00Z) during standard time (adjust for DST if needed)
    return new Date(`${matchDay[0].Date}T22:00:00.000Z`).toISOString();
}

// --- Market Processing Functions ---

async function processMatchupMarkets(mainDB, bettingDB) {
    console.log('--- Processing Matchup Markets (Bo3, No Tie) ---');
    

    const row = db.adminGetCurrentPlayoffBracket();

    let upcomingMatches = [];
    let bracket;
    try {
        bracket = JSON.parse(row[0].PlayoffStructure);
    } catch (e) {
        console.error("Failed to parse bracket JSON:", e);
        return;
    }

    // Helper list to iterate through all sections uniformly
    const allRounds = [
        ...bracket.upperBracket,
        ...bracket.lowerBracket,
        { matches: bracket.grandFinals } // Wrap GF in object to match structure
    ];

    // 2. Iterate through every match in the bracket
    for (const round of allRounds) {
        for (const match of round.matches) {
            
            // FILTER: We only care about matches that:
            // a) Have both teams ready (Team 1 & Team 2 are not null)
            // b) Do NOT already have a linked Series ID (result not yet processed)

            if (match.team1Id && match.team2Id && !match.seriesId && match.team1Score === 0 && match.team2Score === 0) {
                upcomingMatches.push(match)
            }
        }
    }

    for (const match of upcomingMatches) {
        const { team1Id, team2Id,team1Name,team2Name} = match;

        const existingMarket = dbBet.getOpenMarketByTeamId(team1Id,team2Id); // Assuming seriesId is the reference_id

    
        if (existingMarket.length !== 0) {
            if(existingMarket[0].close_time !== null)
                console.log(`- Market ${existingMarket[0].id}: ${existingMarket[0].title} already exists and has schedule.`);
            else{
                let closeTime = calculateMatchCloseTime(team1Id, team2Id);

                if(closeTime === -1){
                    console.log(`- Market ${existingMarket[0].id}: ${existingMarket[0].title} does not have schedule.`);
                }
                else{
                    dbBet.updateDate(existingMarket[0].id,closeTime)
                    console.log(`- Added Schedule to Market ${existingMarket[0].id}: ${existingMarket[0].title}.`);
                }
            }
            continue;
        }
        // 1. Determine Win Probabilities
        let t1WinPct = db.getWinPercentage(team1Id)
        let t2WinPct = db.getWinPercentage(team2Id)

        let probLog5 = calculateLog5(t1WinPct[0].WinPct/100,t2WinPct[0].WinPct/100);

        // 2. Calculate Odds
        let finalProbA = probLog5; 
        let finalProbB = 1 - finalProbA; 

        const closeness = 1.0 - Math.abs(finalProbA - finalProbB); // 1.0 for 50/50, lower for lopsided
        
        // 2. --- Dynamic Split Logic (How to distribute finalProbA between 2-0 and 2-1) ---
        // Base Split: When closeness is 1.0 (50/50), we assume 2-1 is 60% of the win probability.
        // When closeness is low (lopsided), we assume 2-0 is a higher percentage (e.g., 55%).
        
        // Sweep Weight (The share of the win probability that goes to the 2-0 score)
        // We use a linear interpolation between a minimum sweep (0.35) and a maximum sweep (0.65)
        const minSweepWeight = 0.35; 
        const maxSweepWeight = 0.65;
        
        // If closeness is 1.0, sweep_weight is minSweepWeight (0.35). If closeness is 0.0, it is maxSweepWeight (0.65).
        const sweepWeight = minSweepWeight + (1.0 - closeness) * (maxSweepWeight - minSweepWeight);
        
        // 3. --- Calculate Final Score Probabilities ---
        
        // For Team A:
        const probA_2_0 = finalProbA * sweepWeight;
        const probA_2_1 = finalProbA * (1 - sweepWeight); // The remaining share goes to 2-1

        // For Team B:
        const probB_2_0 = finalProbB * sweepWeight;
        const probB_2_1 = finalProbB * (1 - sweepWeight);

        // CHECK: probA_2_0 + probA_2_1 must equal finalProbA (Probability of Team A winning the series)
        
        // 4. --- Calculate Odds ---
        const oddsAML = calculateDecimalOdds(finalProbA);
        const oddsBML = calculateDecimalOdds(finalProbB);

        // Score Odds
        const oddsA_2_0 = calculateDecimalOdds(probA_2_0);
        const oddsB_2_0 = calculateDecimalOdds(probB_2_0);
        const oddsA_2_1 = calculateDecimalOdds(probA_2_1);
        const oddsB_2_1 = calculateDecimalOdds(probB_2_1);

        // 3. Insert Market
        let closeTime = calculateMatchCloseTime(team1Id, team2Id);

        let currentStatus = '';
        
        if(closeTime === -1){
            currentStatus = 'PENDING';
            closeTime = null;
        }
        else
            currentStatus = 'OPEN';

        const marketTitle = `${team1Name} vs ${team2Name}`;


        const marketResult = dbBet.insertMarket(marketTitle,null,closeTime,currentStatus,team1Id,team2Id)
        
        const marketId = marketResult.lastInsertRowid;

        // 4. Insert Betting Options
        const options = [
            // Moneyline
            { name: `${team1Name} Moneyline`, odds: oddsAML, line_value: null, TeamId: team1Id },
            { name: `${team2Name} Moneyline`, odds: oddsBML, line_value: null, TeamId: team2Id },
            
            // Score Bets (Alt Spreads)
            { name: `${team1Name} Win 2-0`, odds: oddsA_2_0, line_value: 2.0, TeamId: team1Id}, 
            { name: `${team2Name} Win 2-0`, odds: oddsB_2_0, line_value: 2.0, TeamId: team2Id }, 
            { name: `${team1Name} Win 2-1`, odds: oddsA_2_1, line_value: 2.1, TeamId: team1Id }, 
            { name: `${team2Name} Win 2-1`, odds: oddsB_2_1, line_value: 2.1, TeamId: team2Id },
            
        ];
        
        for (const opt of options) {
            dbBet.insertOption(marketId, opt.name, opt.line_value, opt.odds, opt.TeamId)
        }
        console.log(`- Market ${marketId}: ${marketTitle} created. Odds: ${oddsAML}/${oddsBML}`);
    }
}

async function processPlayerStatMarkets(mainDB, bettingDB) {
    console.log('\n--- Processing Player Stat Markets ---');
    
    // ⚠️ STEP 1: FETCH DATA (MOCK QUERY - REPLACE WITH YOUR ACTUAL LOGIC)
    // Get the list of players who are still in the playoffs
    const playoffPlayers = [
        { player_id: 101, player_name: 'Faker', team_id: 5 },
        { player_id: 102, player_name: 'Caps', team_id: 6 },
    ];
    // NOTE: Replace the above array with your mainDB.all() query:
    /*
    const playoffPlayers = await mainDB.all(`
        SELECT player_id, player_name, team_id FROM Players 
        WHERE team_id IN (SELECT DISTINCT team_id FROM ScheduledSeries WHERE score IS NULL)
    `);
    */

    if (playoffPlayers.length === 0) {
        console.log("No players found in active playoff teams. Skipping Player Stat Markets.");
        return;
    }

    // 1. Calculate Initial Odds (N-Way Market)
    const initialProb = 1 / playoffPlayers.length; // E.g., 1/2 players = 0.50
    const initialPlayerOdds = calculateDecimalOdds(initialProb); // Should be ~1.95 for 50/50

    const statTypes = ['Kills', 'Deaths', 'LastHits', 'GPM', 'XPM'];

    for (const stat of statTypes) {
        // 2. Insert Market for the Stat Type
        const marketTitle = `Highest ${stat} in Playoffs`;
        const marketResult = await bettingDB.run(`
            INSERT INTO Markets (title, type, reference_id, close_time) 
            VALUES (?, 'player_stat', ?, ?)
        `, marketTitle, 'PLAYOFF_POOL', 'N/A'); 
        const marketId = marketResult.lastID;

        // 3. Insert Option for Every Player
        for (const player of playoffPlayers) {
            await bettingDB.run(`
                INSERT INTO BettingOptions (market_id, name, odds, pool)
                VALUES (?, ?, ?, 0)
            `, marketId, `${player.player_name} Total ${stat}`, initialPlayerOdds);
        }
        console.log(`- Market ${marketId}: ${marketTitle} created. Initial odds: ${initialPlayerOdds}`);
    }
}

// --- Main Execution Block ---


async function initializeOdds() {
    try {
        const stage = db.getStage();
        const currentStage = stage[0].Stage;

        if(currentStage === 'p'){
            await processMatchupMarkets(db, dbBet);
        //await processPlayerStatMarkets(db, dbBet);
        console.log('\n All initial odds have been set successfully!');
        }
        else{
            console.log(`Not in playoffs, ending job`);
        }

    } catch (error) {
        console.error('CRITICAL ERROR during odds initialization. Rolling back changes:', error.message);
    } 
}


initializeOdds();