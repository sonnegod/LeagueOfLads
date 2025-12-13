import db from './database.js';

// ==========================================
// HELPER: Match Advancement Logic
// ==========================================
// This mirrors the logic from your React 'updateTargetMatch' function.
// It searches the entire bracket structure to find the specific match ID
// and places the team into the correct slot (1 or 2).
const advanceTeamToMatch = (bracketObj, matchId, slot, teamId, teamName) => {
    // 1. Flatten all bracket sections into a single array for easier searching
    const allMatches = [
        ...bracketObj.upperBracket.flatMap(r => r.matches),
        ...bracketObj.lowerBracket.flatMap(r => r.matches),
        ...bracketObj.grandFinals
    ];

    // 2. Find the target match
    const targetMatch = allMatches.find(m => m.id === matchId);
    
    // 3. Update the correct slot
    if (targetMatch) {
        if (slot === 1) {
            targetMatch.team1Id = teamId;
            targetMatch.team1Name = teamName;
        } else if (slot === 2) {
            targetMatch.team2Id = teamId;
            targetMatch.team2Name = teamName;
        }
        console.log(`   -> Advanced ${teamName} (ID: ${teamId}) to Match ${matchId} (Slot ${slot})`);
    } else {
        console.warn(`   !! WARNING: Could not find target match ID: ${matchId}`);
    }
};

// ==========================================
// MAIN JOB SCRIPT
// ==========================================

const runJob = () => {
    console.log("--- Starting Overnight Playoff Bracket Update Job ---");

    // 1. Fetch the Active Bracket
    // We assume there is only one active league for simplicity.
    const row = db.adminGetCurrentPlayoffBracket();

    if (!row) {
        console.log("No active league or playoff bracket found. Exiting.");
        return;
    }

    let bracket;
    try {
        bracket = JSON.parse(row[0].PlayoffStructure);
    } catch (e) {
        console.error("Failed to parse bracket JSON:", e);
        return;
    }

    // 1a. Optimization Check: Is the Grand Final already done?
    // If the Grand Final match already has a seriesId, the tournament is finished.
    if (bracket.grandFinals && bracket.grandFinals[0] && bracket.grandFinals[0].seriesId) {
        console.log("Grand Finals already completed. Tournament finished. Exiting.");
        return;
    }

    let dirty = false; // Flag to track if we made changes and need to save

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
                
                console.log(`Checking Match ${match.id} (${match.team1Name} vs ${match.team2Name})...`);

                // 3. Search for a Completed Series in SeriesInfo
                // Logic:
                // - Join SeriesInfo (SI) and SeriesMatch (SM)
                // - Filter by the two Team IDs (checking both A vs B and B vs A)
                // - Filter by Stage = 'p' (Playoffs)
                // - Calculate wins by summing instances where WinnerId matches TeamId
                // - Order by SeriesId DESC to get the latest played series
                
                const result = db.findPlayoffSeries(match.team1Id, match.team2Id);
                
                console.log(result);

                // 4. Process the Result
                if (result.length !== 0) {
                    const res = result[0];
                    const t1Score = res.Team1Wins;
                    const t2Score = res.Team2Wins;
                    
                    // Logic Check: Ensure the series has valid data (games played)
                    // If scores are tied (e.g. 0-0 or 1-1 in a BO3), we assume it's unfinished 
                    // unless your SeriesInfo has a specific 'WinnerId' column you prefer to trust.
                    // Here we assume whoever has more wins is the winner.
                    if (res.TotalGames > 0 && t1Score !== t2Score) {
                        
                        console.log(`   MATCH FOUND! Series ID: ${res.SeriesId}. Score: ${t1Score}-${t2Score}`);

                        // A. Update the Match Object with Score and Link
                        match.seriesId = res.SeriesId;
                        match.team1Score = t1Score;
                        match.team2Score = t2Score;
                        
                        dirty = true; // Mark bracket for saving

                        // B. Determine Winner and Loser entities
                        const winnerId = t1Score > t2Score ? match.team1Id : match.team2Id;
                        const loserId = t1Score > t2Score ? match.team2Id : match.team1Id;
                        
                        const winnerName = t1Score > t2Score ? match.team1Name : match.team2Name;
                        const loserName = t1Score > t2Score ? match.team2Name : match.team1Name;

                        // C. Advance the Winner
                        if (match.winnerTo) {
                            // winnerToSlot is usually set in your generator (1 or 2)
                            // If undefined, default to 1 (or handle based on bracket logic)
                            const slot = match.winnerToSlot || 1;
                            advanceTeamToMatch(bracket, match.winnerTo, slot, winnerId, winnerName);
                        }

                        // D. Advance the Loser (Drop to Lower Bracket)
                        if (match.loserTo) {
                            // Losers dropping from UB usually go to Slot 2 (or based on complex seed logic).
                            // Based on your previous generator code, Drops were mostly hardcoded or set.
                            // We default to Slot 2 for UB Drops here as a common convention.
                            advanceTeamToMatch(bracket, match.loserTo, 2, loserId, loserName);
                        }
                    } else {
                        console.log(`   Series found (${result.SeriesId}) but score is tied (${t1Score}-${t2Score}) or incomplete. Skipping.`);
                    }
                } else {
                    console.log("   No matching playoff series found in DB.");
                }
            }
        }
    }

    // 5. Save Changes back to DB
    if (dirty) {
        console.log("Updates detected. Saving bracket back to database...");
        try {            
            // Update the existing row for this league
            db.insertBracket(bracket);
            
            console.log("Successfully saved updated bracket.");
        } catch (e) {
            console.error("Error saving bracket to database:", e);
        }
    } else {
        console.log("No match updates found. Bracket is unchanged.");
    }
    
    console.log("--- Job finished ---");
};

// Execute the job

const stage = db.getStage();
const currentStage = stage[0].Stage;
if(currentStage === 'p')
    runJob();
else{
    console.log(`Not in playoffs, ending job`);
}