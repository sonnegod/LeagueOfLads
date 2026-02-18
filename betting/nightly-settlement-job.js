import dbBet from '../databaseBet.js';
import db from '../database.js';


function runNightlySettlement() {
    console.log("Starting Nightly Settlement Job...");
    const stage = db.getStage();
    const currentStage = stage[0].Stage;

    try {
        // --- STEP 1: Get Completed Series that are not yet settled ---
        // We look for series marked 'COMPLETED' in Tournament DB
        // But we must check Betting DB to ensure we haven't already settled them.
        
        const completedSeries = db.getLastNightSeries();

        for (const series of completedSeries) {
            // --- STEP 2: Find Open Markets for this Series ---
            // Query Betting DB for markets linked to this series ID
            const activeMarkets = dbBet.getLockedMarketByTeamId(series.Team1,series.Team2);

            
            if (activeMarkets.length === 0) continue; // Already settled or no markets exist

            console.log(`Processing Series ID ${series.SeriesId} (Winner: ${series.WinnerId})...`);

            // --- STEP 3: Iterate through Markets (ML, Score, etc) ---
            for (const market of activeMarkets) {
                
                // A. Determine the Winning Option ID based on market type
                const winningOptionIds = determineWinningOption(
                    market, 
                    series
                );

                if (winningOptionIds) {
                    // B. Execute the Financial Settlement
                    const result = dbBet.settleMarket(market.id, winningOptionIds);
                    
                    if (result.success) {
                        console.log(`✅ Market ${market.id} (${market.type}) settled. Winner: Opt ${winningOptionIds}`);
                    } else {
                        console.error(`❌ Failed to settle Market ${market.id}: ${result.message}`);
                    }
                } else {
                    dbBet.void(market.id);
                    console.warn(`Voiding Market ${market.id}`);
                }
            }

            const badMarkets = dbBet.getOpenMarketByTeamId(series.Team1,series.Team2);

            console.log(`Processing Bad Bet with Series ID ${series.SeriesId}`);

            for(const market of badMarkets){
                dbBet.void(market.id);
                console.warn(`Voiding Market ${market.id}`);
            }
        }
        
    } catch (error) {
        console.error("Critical Error in Nightly Settlement:", error);
    }

    console.log("Finishing Nightly Settlement Job...");
}

function determineWinningOption(market, series) {
    const { id: marketId, type } = market;
    const { WinnerId, Team1, Team1Wins, Team2Wins } = series;

    // Fetch all options for this market to compare against
    const options = dbBet.queryDatabase(
        "SELECT id, name FROM BettingOptions WHERE market_id = ?", 
        [marketId]
    );

    const normalize = (str) => str.toLowerCase().trim();

    if(WinnerId === null)
        return { moneylineId: null, scoreId: null };
    
    // 1. Get Winning Team Name
    const teamRow = db.getTeamInfo(WinnerId);

    if (teamRow.length === 0) return { moneylineId: null, scoreId: null };
        
    const winningTeamName = teamRow[0].TeamName;

    // 2. Identify the Specific Winning Score Option ID
    const winnerScore = (WinnerId === Team1) ? Team1Wins : Team2Wins;
    const loserScore  = (WinnerId === Team1) ? Team2Wins : Team1Wins;
    const scoreString = `${winnerScore}-${loserScore}`; // e.g., "2-1"

    const winningScoreOption = options.find(opt => 
        normalize(opt.name).includes(normalize(winningTeamName)) && 
        opt.name.includes(scoreString)
    );

    // 3. Identify the Winning Moneyline Option ID
    const winningMoneylineOption = options.find(opt => 
        normalize(opt.name).includes(normalize(winningTeamName)) && 
        normalize(opt.name).includes('moneyline')
    );
    // 4. Return both IDs in an object
    if (winningScoreOption && winningMoneylineOption) {
        return {
            moneylineId: winningMoneylineOption.id,
            scoreId: winningScoreOption.id
        };
    } else {
        console.warn(`Could not confirm both Moneyline and Score winners for Market ${marketId}.`);
        return { moneylineId: null, scoreId: null };
    }
}

runNightlySettlement();