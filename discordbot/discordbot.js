import { Client, GatewayIntentBits } from 'discord.js';
import db from '../database.js';
import dbBet from '../databaseBet.js';
import { autoDraftScheduledSeries } from '../betting/analytics/autoDraftScheduledSeries.js';
import { parseScheduledMatch } from './parseScheduledMatch.js';
import { syncSeriesCloseTimes } from '../betting/syncSeriesCloseTimes.js';
import dotenv from 'dotenv';

dotenv.config();

// --- Configuration ---
const TOKEN = process.env.DISCORD_TOKEN; // **IMPORTANT: Use an environment variable**
const TARGET_CHANNEL_ID = '626493827544514580'; // Replace with your games channel ID

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

/**
 * Connects to Discord, fetches messages, parses data, and logs the output.
 */
async function fetchAndLogMatchups() {
    console.log(`\n--- [Scheduler] Starting Discord fetch at ${new Date().toLocaleTimeString()} ---`);

    try {
        const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
        if (!channel) {
            console.error(`[Discord ERROR] Channel with ID ${TARGET_CHANNEL_ID} not found.`);
            return;
        }

        // Fetch up to the last 10 messages
        const messages = await channel.messages.fetch({ limit: 10 });
        const parsedMatchups = [];

        messages.forEach(message => {

            const matchup = parseScheduledMatch(message);

            if (matchup) {
                console.log(`[PARSED] ✅ Success: ${message.content}`);
                parsedMatchups.push(matchup);
            } else {
                console.log(`[PARSED] ❌ Failed to parse: ${message.content.substring(0, 50)}...`);
            }
        });

        console.log('\n=======================================');
        console.log('Final Parsed Matchups Array:');
        const seriesUids = db.insertScheduledSeries(parsedMatchups);
        const draftResult = autoDraftScheduledSeries({ seriesUids });
        if (!draftResult.skipped) {
            const closeTimes = syncSeriesCloseTimes({ seriesUids,
                ladsPath: db.dbPath, bettingPath: dbBet.dbPath });
            if (closeTimes.tightened || closeTimes.locked) {
                console.log(`[Betting schedule] Tightened ${closeTimes.tightened} close times; locked ${closeTimes.locked} expired markets`);
            }
        }
        if (draftResult.skipped) {
            console.log(`[Betting drafts] ${draftResult.skipped}`);
        } else {
            for (const series of draftResult.series) {
                if (series.error) console.warn(`[Betting drafts] Series ${series.seriesUid}: ${series.error}`);
                else console.log(`[Betting drafts] Series ${series.seriesUid}: ${series.marketsCreated} DRAFT markets created`);
            }
        }
        console.log('=======================================\n');

    } catch (error) {
        console.error('[CRITICAL ERROR] Failed to fetch data:', error.message);
    }
}

/**
 * Starts the main process and cron job.
 */
async function start() {
    try {
        // 1. Log in to Discord
        await client.login(TOKEN);
        console.log(`[Discord] Logged in successfully as ${client.user.tag}!`);

        // 2. Run the initial fetch immediately
        await fetchAndLogMatchups();


        if (client) client.destroy();
        process.exit(1);
    } catch (err) {
        console.error('Fatal Initialization Error:', err.message);
        // Clean up client before exiting
        if (client) client.destroy();
        process.exit(1);
    }
}

// Start the application
start();
