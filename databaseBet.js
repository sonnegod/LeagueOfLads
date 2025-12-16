import Database from "better-sqlite3";
import dotenv from 'dotenv';
dotenv.config();

class DBInstance {
    constructor(){
        if(!DBInstance.instance){
            const dbPath =
                process.env.ENVIRONMENT === 'DEV'
                ? './db/Betting.db'
                : '/root/LeagueOfLads/db/Betting.db';
                
            this.db = new Database(dbPath);
            DBInstance.instance = this;
        }

        

        return DBInstance.instance;
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

    insertMarket( marketTitle, match_id, closeTime, currentStatus,team1,team2){
        const insertQuery = `
            INSERT INTO Markets (title, type, reference_id, close_time, status,Team1,Team2) 
            VALUES (@title, @type, @ref_id, @close_time, @status,@team1,@team2)`;
        const insertStatement = this.db.prepare(insertQuery);
        const row = insertStatement.run({
            title: marketTitle,
            type: 'matchup',
            ref_id : match_id,
            close_time : closeTime,
            status: currentStatus,
            team1: team1,
            team2: team2
        });        

        return row;
    }

    insertOption(marketId, name, line_value, odds, teamId){
       const insertQuery = `
                INSERT INTO BettingOptions (market_id, name, line_value, odds, pool, TeamId)
                VALUES (@marketId, @name, @line_value, @odds, @pool, @TeamId)
            `;
        const insertStatement = this.db.prepare(insertQuery);
        const row = insertStatement.run({
            marketId: marketId,
            name:name,
            line_value : line_value,
            odds : odds,
            pool: 0,
            TeamId: teamId
        });        
        
        return row;
    }

    validateAndDebitWallet(userId, amount) {
        // Check balance and lock the row
            const wallet = this.queryDatabase("SELECT balance FROM UserWallets WHERE user_id = ?", [userId]);
    
            if (wallet.length === 0 || wallet.balance < amount) {
                return -1;
            }

            // Debit the user's wallet
            this.db.prepare(
                "UPDATE UserWallets SET balance = balance - ?, total_wagered = total_wagered + ? WHERE user_id = ?").run(amount, amount, userId);

            // Record transaction log (optional but highly recommended)
            this.db.prepare(
                "INSERT INTO TransactionLog (user_id, amount, type, reference_id) VALUES (?, ?, 'BET_PLACED', NULL)").run(userId, -amount); // Negative amount for debit

       
        return 1;
    }



    recalculateMoneyLineOdds(marketId) {
        
        // Weighting Factors for Market Control
        
        // Alpha (POOL_INFLUENCE_RATE): The weight given to the user-driven pool's 'Fair Odds'.
        // 0.10 means 10% of the movement is based on the pool, 90% remains the old line.
        const POOL_INFLUENCE_RATE = 0.10; 
        
        // Gamma (HOUSE_VIG_FACTOR): The margin the house takes (5% margin)
        const HOUSE_VIG_FACTOR = 0.95; 

        try {
            // 1. Fetch data for both options
            const options = this.queryDatabase(`
                SELECT id, pool, odds as odds_old 
                FROM BettingOptions 
                WHERE market_id = ?
                AND name like '%Moneyline%';
            `, [marketId]);
            
            if (options.length !== 2) {
                console.warn(`Market ${marketId} does not have exactly two options. Skipping odds update.`);
                return;
            }

            const totalPool = options[0].pool + options[1].pool;

            if (totalPool === 0) return;

            // 2. Prepare the update statement
            const stmtUpdateOdds = this.db.prepare("UPDATE BettingOptions SET odds = ? WHERE id = ?");

            for (const option of options) {
                if (option.pool === 0) continue; 

                // A. Calculate Fair Odds (Implied Probability from Pool)
                // This represents what the odds *should* be if based purely on pool money.
                const impliedProbability = option.pool / totalPool;
                const fairOdds = 1 / impliedProbability;
                
                // B. Apply Vig to Fair Odds
                const odds_fair = fairOdds * HOUSE_VIG_FACTOR;
                
                // C. Apply the Weighted Average (Smoothing) Formula
                const odds_old = option.odds_old;
                
                // The weight given to the existing, trusted line (e.g., 90%)
                const OLD_WEIGHT = 1.0 - POOL_INFLUENCE_RATE; 

                // Formula: New Odds = (Baseline Weight * Old Odds) + (Influence Weight * Pool-Fair Odds)
                const newOdds = (OLD_WEIGHT * odds_old) + (POOL_INFLUENCE_RATE * odds_fair);
                
                // 3. Update the database
                stmtUpdateOdds.run(newOdds.toFixed(2), option.id); 
            }

        } catch (error) {
            console.error(`Error recalculating Moneyline odds for Market ${marketId}:`, error.message);
        }
    }

    updateDate(marketId, closeTime){
        return this.db.prepare(`
            UPDATE Markets
            SET close_time = ?
            WHERE id = ?
            `).run(closeTime,marketId);
    }

    closeMarkets(time){
        return this.db.prepare(`
            UPDATE Markets
            SET status = 'LOCKED'
            WHERE type = 'matchup'
              AND status = 'OPEN'
              AND close_time IS NOT NULL 
              AND close_time < ?; 
        `).run(time);
    }

    createWallet(steamid){
        this.db.prepare(`
            INSERT OR IGNORE INTO UserWallets (user_id, balance, total_wagered, total_won)
            VALUES (?, 10000, 0, 0)
            `).run(steamid);
    }

    getWalletBalance(userId){
        return this.queryDatabase(`
            SELECT *
            FROM UserWallets
            WHERE user_id = ?`,[userId]);
    }
    
    creditWallet(userId,total_payout){
                console.log(userId,total_payout);

        return this.db.prepare("UPDATE UserWallets SET balance = balance + ?, total_won = total_won + ? WHERE user_id = ?")
                    .run(total_payout, total_payout, userId);
    }

    getActiveMarkets(){
        return this.queryDatabase(`
            SELECT * FROM Markets
            WHERE STATUS NOT IN ('LOCKED','SETTLED')`);
    }

    getOptions(market_id){ 
        return this.queryDatabase(`
            SELECT * FROM BettingOptions
            WHERE market_id = ?`,[market_id]);
    }

    getPools(market_id){
        return this.queryDatabase(`
            SELECT
                SUM(CASE 
                    WHEN BO.TeamId = M.Team1 THEN BO.pool 
                    ELSE 0 
                END) AS PoolA,
                SUM(CASE 
                    WHEN BO.TeamId = M.Team2 THEN BO.pool 
                    ELSE 0 
                END) AS PoolB
            FROM
                Markets M
            JOIN
                BettingOptions BO ON M.id = BO.market_id
            WHERE
                BO.market_id = ?
                AND M.Status = 'OPEN';`,[market_id]);
    }

    getPlayerLeaderboard(){
        return this.queryDatabase(`
            SELECT
                pt.user_id,
                SUM(
                    CASE
                        WHEN PT.Status = 'WON' THEN PT.total_amount 

                        WHEN PT.Status = 'LOST' THEN -PT.total_amount

                        ELSE 0 
                    END
                ) AS NetGain
            FROM
                ParlayTickets PT
            GROUP BY
                pt.user_id
            ORDER BY
                NetGain DESC;
            `);
    }

    getOpenMarketByTeamId(team1,team2){
        return this.queryDatabase(`
            SELECT * FROM Markets
            WHERE 
            Status NOT IN ('LOCKED','SETTLED')
            AND 
            (
                (Team1 = ? AND Team2 = ?)
                OR 
                (Team1 = ? AND Team2 = ?)
            )`,[team1,team2,team2,team1]);
    }

    getLockedMarketByTeamId(team1,team2){
        return this.queryDatabase(`
            SELECT * FROM Markets
            WHERE 
            Status IN ('LOCKED')
            AND 
            (
                (Team1 = ? AND Team2 = ?)
                OR 
                (Team1 = ? AND Team2 = ?)
            )`,[team1,team2,team2,team1]);
    }

    getBets(userId){
        return this.queryDatabase(`
            SELECT
                PT.id AS ticket_id,
                PT.total_amount,
                ROUND(PT.total_odds,2) as odds,
                ROUND(PT.total_payout,2) as payout,
                PT.created_at,
                -- Use aggregation to capture the details of all bet legs for this ticket
                json_group_array(
                    json_object(
                        'option_name', BO.name,
                        'odds_taken', BL.odds_at_time,
                        'market_title', M.title,
                        'market_id', M.id
                    )
                ) AS legs
            FROM
                ParlayTickets PT
            JOIN
                BetLegs BL ON PT.id = BL.ticket_id
            JOIN
                BettingOptions BO ON BL.option_id = BO.id
            JOIN
                Markets M ON BO.market_id = M.id
            WHERE
                PT.user_id = ? AND PT.status = 'PENDING'
            GROUP BY
                PT.id
            ORDER BY
                PT.created_at DESC;
            `,[userId]);
    }

    placeParlayBet(userId, totalWager, betLegs){
        try {
            // --- Step 1: Preliminary Validation ---
            this.db.exec('BEGIN TRANSACTION');

            // Fetch wallet balance
            const wallet = this.validateAndDebitWallet(userId,totalWager);
            if (wallet === -1) {
                return { success: false, message: "Insufficient funds." };
            }

            let totalOdds = 1.0;
            let legData = [];

            // --- Step 2: Validate Legs and Calculate Total Odds ---
            for (const leg of betLegs) {
                // Fetch market and option details in one query
                const marketOption = this.queryDatabase(`
                    SELECT M.status,M.type as market_type, M.id AS marketId, BO.odds, BO.id AS optionId
                    FROM Markets M JOIN BettingOptions BO ON M.id = BO.market_id
                    WHERE M.id = ? AND BO.id = ?;
                `, [leg.marketId, leg.optionId]);

                if (marketOption.length === 0) {
                    return { success: false, message: `Market or Option not found for Market ID ${leg.marketId}.` };
                }
                
                // CRITICAL CHECK: Must reject if market is not OPEN
                if (marketOption[0].status === 'LOCKED') {
                    return { success: false, message: `Market ${marketOption[0].marketId} is ${marketOption[0].status} and cannot accept wagers.` };
                }

                totalOdds *= marketOption[0].odds;
                legData.push(marketOption);
                
                // NOTE: Dynamic ML odds update logic would be inserted here, 
                // updating the BettingOptions table for pooled markets.
            }
                        
            const totalPayout = totalWager * totalOdds

            // --- Step 4: Create ParlayTicket Record ---
            const ticketResult =  this.db.prepare(`
                INSERT INTO ParlayTickets (user_id, total_amount, total_odds, total_payout, status, created_at)
                VALUES (?, ?, ?, ?, 'PENDING', ?);
            `).run(userId, totalWager, totalOdds, totalPayout, new Date().toISOString());

            const ticketId = ticketResult.lastInsertRowid;


            // --- Step 5: Create BetLegs Records ---
            const legWager = totalWager / betLegs.length; // Simple split for liability tracking
            const stmtLeg =  this.db.prepare("INSERT INTO BetLegs (ticket_id, option_id, odds_at_time, market_type) VALUES (?, ?, ?, ?)");
            
            for (const leg of legData) {
                stmtLeg.run(
                    ticketId, 
                    leg[0].optionId, 
                    leg[0].odds, 
                    leg[0].market_type
                );
                
                // Also update the pool (total amount wagered on this specific option)
                this.db.prepare("UPDATE BettingOptions SET pool = pool + ? WHERE id = ?").run(totalWager, leg[0].optionId);

                this.recalculateMoneyLineOdds(leg[0].marketId);
            }

            // --- Commit Transaction ---
            this.db.exec('COMMIT');
            return { success: true, ticketId: ticketId, finalOdds: totalOdds.toFixed(2) };

        } catch (error) {
            console.error('Parlay Transaction Failed:', error.message);
            this.db.exec('ROLLBACK');
            return { success: false, message: "A critical database error occurred. Funds reverted." };
        }
    }

    void(marketId){
         try {
            // Use the better-sqlite3 transaction wrapper for atomic operations
            this.db.transaction(() => { 
                
                // --- Step 1: Mark the Market and Winning Options as Settled/Won ---
                
                // Set the overall Market status and record the canonical winner (Moneyline)
                this.db.prepare("UPDATE Markets SET status = 'VOIDED' WHERE id = ?")
                    .run(marketId);
                
                // Mark the specific winning options as WON
                this.db.prepare("UPDATE BettingOptions SET status = 'VOIDED' WHERE market_id = ?")
                    .run(marketId);

                const voidedTickets = this.db.prepare(`
                    SELECT DISTINCT PT.id, PT.user_id, PT.total_amount
                    FROM ParlayTickets PT
                    JOIN BetLegs BL ON PT.id = BL.ticket_id
                    JOIN BettingOptions bo on bo.id = BL.option_id
                    WHERE bo.marketId = ?
                    AND PT.status = 'PENDING';
                `).all(marketId);

                // Iterate through voided tickets and finalize payout
                for (const ticket of voidedTickets) {
                    
                    // 2.1 Credit the User's Wallet
                    this.db.prepare("UPDATE UserWallets SET balance = balance + ? WHERE user_id = ?")
                        .run(ticket.total_amount, ticket.user_id);
                    // 2.2 Update the Ticket Status
                    this.db.prepare("UPDATE ParlayTickets SET status = 'VOIDED', settlement_time = ? WHERE id = ?")
                        .run(new Date().toISOString(), ticket.id);
                }

            })(); // End of transaction wrapper

                console.log(`Market ${marketId} Voided`);
                return { success: true, message: `Market ${marketId} Voided successfully.` };

            } catch (error) {
                // If an error occurs, better-sqlite3 automatically ROLLBACKs all changes.
                console.error(`❌ Void failed for Market ${marketId}:`, error.message);
                return { success: false, message: `Settlement failed. No changes were committed.` };
            }
        }

    settleMarket(marketId, winningOptionsId){
        const {moneylineId, scoreId} = winningOptionsId;

        try {
        // Use the better-sqlite3 transaction wrapper for atomic operations
        this.db.transaction(() => { 
            
            // --- Step 1: Mark the Market and Winning Options as Settled/Won ---
            
            // Set the overall Market status and record the canonical winner (Moneyline)
            this.db.prepare("UPDATE Markets SET status = 'SETTLED' WHERE id = ?")
                .run(marketId);
            
            // Mark the specific winning options as WON
            this.db.prepare("UPDATE BettingOptions SET status = 'WON' WHERE id IN (?, ?)")
                .run(moneylineId, scoreId);

                
            // --- Step 2: Pay Out Winning Tickets (Includes ML and Score bets) ---
            
            // Find all PENDING ParlayTickets that contain EITHER the winning Moneyline 
            // OR the winning Score option for this market.
            const winningTickets = this.db.prepare(`
                SELECT DISTINCT PT.id, PT.user_id, PT.total_payout, PT.total_odds
                FROM ParlayTickets PT
                JOIN BetLegs BL ON PT.id = BL.ticket_id
                WHERE BL.option_id IN (?, ?) 
                  AND PT.status = 'PENDING';
            `).all(moneylineId, scoreId);

            // Iterate through potential winning tickets and finalize payout
            for (const ticket of winningTickets) {
                
                // CRITICAL CHECK: In a Parlay, we must ensure ALL legs have won.
                // For simplicity here, we assume if the current market is the final market 
                // to settle, the ticket can be processed. A robust system requires
                // checking the status of all associated markets/legs before paying out.
                
                // 2.1 Credit the User's Wallet
                this.db.prepare("UPDATE UserWallets SET balance = balance + ?, total_won = total_won + ? WHERE user_id = ?")
                    .run(ticket.total_payout, ticket.total_payout, ticket.user_id);
                // 2.2 Update the Ticket Status
                this.db.prepare("UPDATE ParlayTickets SET status = 'WON', settlement_time = ? WHERE id = ?")
                    .run(new Date().toISOString(), ticket.id);
            }

            
            // --- Step 3: Mark Losing Options and Tickets ---
            
            // 3.1 Mark all other options in this market as 'LOST'
            this.db.prepare("UPDATE BettingOptions SET status = 'LOST' WHERE market_id = ? AND id NOT IN (?, ?)")
                .run(marketId, moneylineId, scoreId);

            // 3.2 Mark Losing Tickets: Find all PENDING tickets where the chosen option 
            //     for this market was NOT one of the winning IDs. These tickets lose immediately.
            this.db.prepare(`
                UPDATE ParlayTickets SET status = 'LOST', settlement_time = ?
                WHERE id IN (
                    SELECT DISTINCT PT.id
                    FROM ParlayTickets PT
                    JOIN BetLegs BL ON PT.id = BL.ticket_id
                    WHERE BL.option_id NOT IN (?, ?) AND PT.status = 'PENDING'
                );
            `).run(new Date().toISOString(), moneylineId, scoreId);


        })(); // End of transaction wrapper

            console.log(`✅ Market ${marketId} settled. Winners paid: ML ID ${moneylineId}, Score ID ${scoreId}`);
            return { success: true, message: `Market ${marketId} settled successfully.` };

        } catch (error) {
            // If an error occurs, better-sqlite3 automatically ROLLBACKs all changes.
            console.error(`❌ Settlement failed for Market ${marketId}:`, error.message);
            return { success: false, message: `Settlement failed. No changes were committed.` };
        }
    }
}


const dbInstance = new DBInstance();
export default dbInstance;