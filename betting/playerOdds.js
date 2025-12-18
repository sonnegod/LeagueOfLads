import db from '../database.js';
import dbBet from '../databaseBet.js';


// --- CONFIGURATION ---
const HOUSE_MARGIN = 0.05; // 5% vig

// Define the statistical properties for each stat type.
// VOLATILITY_FACTOR (Lambda Boost): Used for Poisson/Normal Mean.
// STAT_STD_DEV_COLUMN: The column name storing the Standard Deviation for the Normal Model.
const MarketConfig = {
    'Kills': {
        db_stat_column: 'k_max', 
        db_avg_column: 'k_avg', 
        db_std_dev_column: 'k_std_dev', // Needed for Normal model
        model: 'POISSON', 
        volatility_factor: 1.25 // High boost for rare kill streaks
    },
    'Deaths': {
        db_stat_column: 'd_max', 
        db_avg_column: 'd_avg', 
        db_std_dev_column: 'd_std_dev', 
        model: 'POISSON', 
        volatility_factor: 1.15 // Moderate boost
    },
    'LastHits': {
        db_stat_column: 'lh_max', 
        db_avg_column: 'lh_avg', 
        db_std_dev_column: 'lh_std_dev', 
        model: 'NORMAL', // Normal approximation is better for high counts
        volatility_factor: 1.05 // Low boost, as high LH is common for certain roles
    },
    'GPM': {
        db_stat_column: 'gpm_max', 
        db_avg_column: 'gpm_avg', 
        db_std_dev_column: 'gpm_std_dev', 
        model: 'NORMAL', 
        volatility_factor: 1.10 // Moderate boost for economy spikes
    }
    // Add new stats here if needed!
};

// --- STATISTICAL UTILITY FUNCTIONS ---

/**
 * Calculates the Standard Normal Cumulative Distribution Function (CDF).
 * Uses a standard approximation (required for Z-Score to Probability conversion).
 */
function standardNormalCDF(z) {
    const p = 0.2316419;
    const b1 = 0.319381530;
    const b2 = -0.356563782;
    const b3 = 1.781477937;
    const b4 = -1.821255978;
    const b5 = 1.330274429;
    
    if (z >= 0) {
        const t = 1.0 / (1.0 + p * z);
        const poly = b1 * t + b2 * t * t + b3 * t * t * t + b4 * t * t * t * t + b5 * t * t * t * t * t;
        return 1.0 - (Math.exp(-z * z / 2.0) / Math.sqrt(2 * Math.PI)) * poly;
    } else {
        return 1.0 - standardNormalCDF(-z);
    }
}

/**
 * Calculates the Poisson Probability Mass Function (PMF).
 */
function poissonPMF(k, lambda) {
    if (k < 0) return 0;
    
    let k_factorial = 1;
    for (let i = 2; i <= k; i++) {
        k_factorial *= i;
    }
    
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / k_factorial;
}

/**
 * Calculates the Poisson Cumulative Distribution Function (CDF) for P(K >= k_min | λ).
 */
function poissonCDF_Exceed(k_min, lambda) {
    // k_min must be an integer for Poisson
    const k_max = Math.floor(k_min) - 1; 
    let cumulativeProbability = 0;
    
    for (let k = 0; k <= k_max; k++) {
        cumulativeProbability += poissonPMF(k, lambda);
    }
    
    return Math.max(0, 1 - cumulativeProbability); 
}

/**
 * Calculates the probability of a value exceeding the benchmark using Normal Distribution (for GPM, LastHits).
 */
function normalCDF_Exceed(benchmark, mean, standardDeviation) {
    // If no variance, P=1 if mean > benchmark, 0 otherwise
    if (standardDeviation === 0 || isNaN(standardDeviation)) return (mean > benchmark) ? 1 : 0;
    
    // Calculate Z-score for the benchmark
    const z = (benchmark - mean) / standardDeviation;
    
    // P(X > benchmark) = 1 - P(X <= benchmark)
    return 1 - standardNormalCDF(z);
}


// --- GENERALIZED CORE LOGIC ---

/**
 * Calculates the probability of a player exceeding the current benchmark in a single game.
 * Uses the correct statistical model based on the market type.
 */
function calculateStatExceedProbability(player, benchmark, config) {
    
    const avg = player[config.db_avg_column];
    const stdDev = player[config.db_std_dev_column];
    
    // 1. Calculate the Effective Mean (Lambda or Mu)
    const effectiveMean = avg * config.volatility_factor;
    
    let P_game_exceed = 0;

    if (config.model === 'POISSON') {
        // Poisson requires integer kills/deaths and is good for low counts
        // Needs K_benchmark + 1
        P_game_exceed = poissonCDF_Exceed(Math.floor(benchmark) + 1, effectiveMean);
    } else if (config.model === 'NORMAL') {
        // Normal is used for high counts (LH) and continuous data (GPM)
        // We assume the standard deviation (StdDev) is robustly calculated from the DB
        
        // Use the raw stdDev, but scale it up if the volatility factor is high.
        // A simple assumption: the boosted mean requires a slightly boosted variance too.
        const effectiveStdDev = stdDev * Math.sqrt(config.volatility_factor);
        
        P_game_exceed = normalCDF_Exceed(benchmark, effectiveMean, effectiveStdDev);
    }
    
    return P_game_exceed;
}

// --- MAIN ODDS CALCULATION FUNCTION ---

async function calculateHighestSingleMatchOdds(activePlayersStats, statType) {
    
    const config = MarketConfig[statType];
    if (!config || activePlayersStats.length === 0) return {};

    // 1. Find the Benchmark (Highest Stat_max in the group)
    let STAT_benchmark = 0;
    const statCol = config.db_stat_column;
    
    for (const player of activePlayersStats) {
        const currentStat = player[statCol] || 0;
        if (currentStat > STAT_benchmark) {
            STAT_benchmark = currentStat;
        }
    }

    let totalImpliedProbability = 0;
    const playerProbabilities = {}; // Store { player_id: P_win_series or null }

    // 2. Calculate P_win_series for each Player
    for (const player of activePlayersStats) {
        
        if (player.games_remaining === 0) {
            playerProbabilities[player.player_id] = null; 
            continue;
        }

        // A. Calculate P(Game >= Benchmark + epsilon)
        const P_game_exceed = calculateStatExceedProbability(player, STAT_benchmark, config);

        // B. Calculate P(Win over Remaining Games)
        const P_lose_in_game = 1 - P_game_exceed;
        const P_lose_series = Math.pow(P_lose_in_game, player.games_remaining);
        const P_win_series = 1 - P_lose_series;
        
        playerProbabilities[player.player_id] = P_win_series;
        totalImpliedProbability += P_win_series;
    }
    
    // 3. Calculate P_win for the Benchmark Holder (The player with STAT_benchmark)
    let P_benchmark_holder_win = 1;
    for (const id in playerProbabilities) {
        if (playerProbabilities[id] !== null) {
            const P_fail = 1 - playerProbabilities[id];
            P_benchmark_holder_win *= P_fail;
        }
    }
    
    totalImpliedProbability += P_benchmark_holder_win;

    // 4. Normalize Probabilities and Calculate Odds
    const finalOdds = {};
    for (const player of activePlayersStats) {
        let P_win_norm;
        
        const isBenchmarkHolder = player[statCol] === STAT_benchmark;
        
        if (player.games_remaining === 0) {
            // Eliminated player. They only win if they are the benchmark AND everyone else fails.
            if (isBenchmarkHolder) {
                 P_win_norm = P_benchmark_holder_win / totalImpliedProbability;
            } else {
                 // Eliminated, not the highest. P=0 (or very small for max odds)
                 P_win_norm = 0.000001; 
            }
        } else {
            // Active player's chance
            P_win_norm = playerProbabilities[player.player_id] / totalImpliedProbability;
        }

        finalOdds[player.player_id] = {
            odds: calculateDecimalOdds(P_win_norm),
            probability: P_win_norm
        };
    }

    return finalOdds;
}

/**
 * Converts a fair probability into decimal odds, incorporating the house margin (vig).
 */
function calculateDecimalOdds(probability, margin = HOUSE_MARGIN) {
    if (probability <= 0) return 100.00; 
    const odds = (1 / probability) * (1 + margin);
    return parseFloat(Math.max(1.01, odds).toFixed(2));
}


// --- MAIN MARKET PROCESSING FUNCTION ---

async function processPlayerStatMarkets() {
    console.log('\n=================================================');
    console.log('--- STARTING GENERALIZED PLAYER STAT ODDS CALC ---');
    console.log('=================================================');
    
    // ⚠️ STEP 1: Fetch and Prepare Data using real DB connection
    // NOTE: This function MUST now return k_max, d_max, gpm_max, lh_max, and their AVG and STD_DEV counterparts.
    const activePlayersStats = await fetchAndPreparePlayerData();

    if (activePlayersStats.length === 0) {
        console.log("No relevant players found. Market skipped.");
        return;
    }
    
    const statTypes = Object.keys(MarketConfig);
    
    for (const statType of statTypes) {
        
        console.log(`\n--- Processing Market: Highest Single Match ${statType} ---`);
        
        // Step 2: Calculate Advanced Odds for the current stat type
        const killOddsResults = await calculateHighestSingleMatchOdds(activePlayersStats, statType);

        const marketTitle = `Highest Single Match ${statType} in Playoffs`;
        
        // A. Insert/Get Market ID
        const marketResult = await dbBet.run(`
            INSERT INTO Markets (title, type, reference_id, close_time) 
            VALUES (?, 'player_stat_max_${statType.toLowerCase()}', ?, ?)
        `, marketTitle, 'PLAYOFF_POOL', 'N/A'); 
        const marketId = marketResult.lastID;

        // B. Insert/Update Betting Options
        const marketOutput = [];
        for (const player of activePlayersStats) {
            const result = killOddsResults[player.player_id];
            
            await dbBet.run(`
                INSERT INTO BettingOptions (market_id, name, odds, pool, player_id)
                VALUES (?, ?, ?, 0, ?)
                ON CONFLICT(market_id, player_id) DO UPDATE SET odds = excluded.odds
            `, marketId, `${player.player_name} Highest Match ${statType}`, result.odds, player.player_id);
            
            marketOutput.push({
                'Player Name': player.player_name,
                'G_rem': player.games_remaining,
                'Decimal Odds': result.odds,
                'Implied P': (result.probability * 100).toFixed(2) + '%'
            });
        }
        
        console.log(`| Market ${marketId}: ${marketTitle} updated. (Model: ${MarketConfig[statType].model})`);
        console.table(marketOutput);
    }
    
    console.log('\n✅ Odds calculation and market update complete for all stat types.');
}


// --- MOCK DB AND INITIALIZATION BLOCK ---
// (This section is for testing structure only. Replace with your actual DB logic.)

// MOCK DATA FETCHING (Must be updated to fetch all required columns!)
async function fetchAndPreparePlayerData() {
    console.log("--- MOCK DATA SIMULATION (Ensure your real DB fetches all these columns!) ---");
    return [
        // Player with high Kills/LastHits, low Deaths, high GPM
        { player_id: 101, player_name: 'Faker', team_id: 5, games_remaining: 5, 
          k_max: 45, k_avg: 11.5, k_std_dev: 4.0, 
          d_max: 3, d_avg: 2.1, d_std_dev: 1.5,
          lh_max: 450, lh_avg: 380, lh_std_dev: 45,
          gpm_max: 750, gpm_avg: 600, gpm_std_dev: 60,
        },
        // Benchmark Holder (Eliminated)
        { player_id: 102, player_name: 'Caps', team_id: 6, games_remaining: 0, 
          k_max: 48, k_avg: 10.8, k_std_dev: 5.0, // Benchmark Kill Holder
          d_max: 6, d_avg: 3.5, d_std_dev: 2.0,
          lh_max: 350, lh_avg: 310, lh_std_dev: 30,
          gpm_max: 650, gpm_avg: 550, gpm_std_dev: 50,
        },
        // Active Player with high GPM/LH and high Death variance
        { player_id: 103, player_name: 'Uzi', team_id: 7, games_remaining: 7, 
          k_max: 35, k_avg: 13.1, k_std_dev: 3.5,
          d_max: 5, d_avg: 2.8, d_std_dev: 3.0, // High Death variance
          lh_max: 500, lh_avg: 410, lh_std_dev: 55, // High LastHit benchmark
          gpm_max: 800, gpm_avg: 650, gpm_std_dev: 75, // High GPM benchmark
        },
    ];
}

async function initializeOdds() {
    try {
        await processPlayerStatMarkets();
    } catch (error) {
        console.error('CRITICAL ERROR during odds initialization:', error.message);
    } 
}

// Example call to run the process:
initializeOdds();