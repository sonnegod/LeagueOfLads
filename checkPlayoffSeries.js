// checkPlayoffSeries.js
const db = require('./database.js');

/**
 * Main Execution Function
 */
async function processBracket() {
    try {
        // 1. Fetch Bracket
        const bracketJson = await db.getPlayoffBracket();
        if (!bracketJson) {
            console.log('No bracket data found.');
            return;
        }

        let bracket = JSON.parse(bracketJson);
        console.log('Bracket loaded. Processing matches...');

        // 2. Process Order: UB -> LB -> GF
        const categories = ['upperBracket', 'lowerBracket', 'grandFinals'];

        for (const category of categories) {
            const rounds = bracket[category];
            // Normalize "rounds" vs "matches" array structure (GF is usually just matches)
            const iterable = Array.isArray(rounds) && rounds[0]?.matches ? rounds : [{ matches: rounds }];

            for (const r of iterable) {
                if (!r.matches) continue;
                for (const match of r.matches) {
                    await processMatch(match, bracket);
                }
            }
        }

        // 3. Save Updated Bracket
        await db.updatePlayoffBracket(JSON.stringify(bracket));
        console.log('Bracket processing complete. Database updated.');

    } catch (err) {
        console.error('Fatal Error:', err);
    } finally {
        db.close();
    }
}

/**
 * Logic to link Series ID and calculate scores
 */
async function processMatch(match, bracket) {
    // Only process matches that have two teams assigned
    if (!match.team1Id || !match.team2Id) return;

    const t1 = parseInt(match.team1Id);
    const t2 = parseInt(match.team2Id);

    // 1. Look up Series ID from DB
    const seriesId = await db.findSeriesByTeams(t1, t2);

    if (seriesId) {
        match.seriesId = seriesId;

        // 2. Fetch match results from DB
        const winners = await db.getSeriesMatchWinners(seriesId);
        
        let t1Wins = 0;
        let t2Wins = 0;

        winners.forEach(winnerId => {
            if (parseInt(winnerId) === t1) t1Wins++;
            if (parseInt(winnerId) === t2) t2Wins++;
        });

        match.team1Score = t1Wins;
        match.team2Score = t2Wins;

        console.log(`Updated Match ${match.id}: ${match.team1Name || t1} (${t1Wins}) vs ${match.team2Name || t2} (${t2Wins})`);

        // 3. Auto-Advancement Logic
        if (t1Wins !== t2Wins) {
            advanceTeams(match, bracket, t1Wins, t2Wins);
        }
    }
}

/**
 * Moves winners/losers to next slots based on result
 */
function advanceTeams(match, bracket, s1, s2) {
    const winnerId = s1 > s2 ? match.team1Id : match.team2Id;
    const loserId = s1 > s2 ? match.team2Id : match.team1Id;

    const winnerName = s1 > s2 ? match.team1Name : match.team2Name;
    const loserName = s1 > s2 ? match.team2Name : match.team1Name;

    // A. Handle Winner
    if (match.winnerTo) {
        updateTargetMatch(bracket, match.winnerTo, match.winnerToSlot, winnerId, winnerName);
    }

    // B. Handle Loser (Typical logic: Losers go to slot 2 in drop rounds)
    if (match.loserTo) {
        updateTargetMatch(bracket, match.loserTo, 2, loserId, loserName);
    }
}

/**
 * Helper to find a future match in the JSON tree and set the team
 */
function updateTargetMatch(bracketObj, matchId, slot, teamId, teamName) {
    // Flatten the bracket to easily find the target match
    const allMatches = [
        ...bracketObj.upperBracket.flatMap(r => r.matches || []),
        ...bracketObj.lowerBracket.flatMap(r => r.matches || []),
        ...bracketObj.grandFinals
    ];
    
    const m = allMatches.find(x => x.id === matchId);
    
    if (m) {
        let updated = false;

        // Update Slot 1
        if (slot === 1 && (m.team1Id != teamId || m.team1Score !== 0)) {
             m.team1Id = teamId;
             m.team1Name = teamName;
             m.team1Score = 0; // Reset score for the new series
             updated = true;
        }
        // Update Slot 2
        if (slot === 2 && (m.team2Id != teamId || m.team2Score !== 0)) {
             m.team2Id = teamId;
             m.team2Name = teamName;
             m.team2Score = 0; // Reset score for the new series
             updated = true;
        }
        
        // If the lineup changed, clear the old SeriesId so the script re-fetches the new one next run
        if(updated) {
            m.seriesId = null; 
            console.log(`  -> Advanced ${teamName} to ${matchId} Slot ${slot}`);
        }
    }
}

// Start the script
processBracket();