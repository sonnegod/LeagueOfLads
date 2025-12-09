import dbBet from '../databaseBet.js';

function lockExpiredMarkets(dbBet) {
    // Current time in UTC, which matches the format stored in the database
    const currentTimeISO = new Date().toISOString(); 
    console.log(currentTimeISO)
    try {
        // Find all markets that are 'OPEN' and whose close_time is in the past
        const result =  dbBet.closeMarkets(currentTimeISO);
        
        console.log(`[Lock Job] ✅ Locked ${result.changes} markets at ${currentTimeISO}.`);
    } catch (error) {
        console.error('❌ CRITICAL ERROR during market locking job:', error.message);
    }
}

lockExpiredMarkets(dbBet)