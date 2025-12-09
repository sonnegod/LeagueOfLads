import { Client, GatewayIntentBits } from 'discord.js';
import db from '../database.js';
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
 * Parses a single Discord message to extract match data.
 * * ASSUMED MESSAGE FORMAT: "Team Alpha vs Team Beta on 2025-12-15 19:00 EST"
 * @param {string} content The message content string
 * @returns {object|null} An object with { team1, team2, date } or null if parsing fails.
*/
function parseMatchMessage(message) {
    // 1. Extract Team Names from Mentions (Most reliable way)
    const mentionedRoles = message.mentions.roles;

    if (mentionedRoles.size < 2) {
        return null; // Not enough teams mentioned
    }
    const rolesArray = Array.from(mentionedRoles.values());
    const team1Name = rolesArray[0].name; 
    const team2Name = rolesArray[1].name;


    // 2. Clean the message content to isolate the date/time string
    // Remove all user/role mention tags (<@&...>) and the "vs"
    const contentWithoutMentions = message.content
        .replace(/<@&?\d+>/g, '') // Removes all user/role mention tags
        .replace(/\s+vs\s+/i, ' ') // Replaces ' vs ' with a single space
        .trim();
        
    // The content should now look roughly like: "Sunday 12/7 7pm"

    // 3. Regex to isolate the date/time components
    // Captures: DayName(Sunday), Month/Day(12/7), Time(7pm)
    // (\w+) captures the day name (e.g., Sunday)
    // (\d{1,2}\/\d{1,2}) captures the month/day (e.g., 12/7)
    // (\d{1,2}(?::\d{2})?\s*[ap]m) captures the time (e.g., 7pm)
    const dateRegex = /(\w+)\s+(\d{1,2}\/\d{1,2})\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i;
    const dateMatch = contentWithoutMentions.match(dateRegex);

    if (dateMatch && dateMatch.length > 3) {
        // dateMatch[1] = Day name (e.g., Sunday) - not strictly needed for parsing, but good for validation
        const monthDay = dateMatch[2]; // e.g., 12/7
        const time = dateMatch[3];     // e.g., 7pm

        // Construct a full date string for JavaScript's Date object
        // NOTE: We must append the current year to the month/day for valid parsing.
        const currentYear = new Date().getFullYear();
        const fullDateString = `${monthDay}/${currentYear}`; 

        // 4. Create and validate the Date object
        let matchDate = new Date(fullDateString);

        if (isNaN(matchDate.getTime())) {
            console.warn(`[PARSING WARNING] Invalid date generated from: ${fullDateString}`);
            return null;
        }

        matchDate = matchDate.toISOString().split('T')[0];

        return {
            team1: team1Name,
            team2: team2Name,
            date: matchDate
        };
    }
    
    return null; // Failed to match the date pattern
}

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

            const matchup = parseMatchMessage(message);

            if (matchup) {
                console.log(`[PARSED] ✅ Success: ${message.content}`);
                parsedMatchups.push(matchup);
            } else {
                console.log(`[PARSED] ❌ Failed to parse: ${message.content.substring(0, 50)}...`);
            }
        });

        console.log('\n=======================================');
        console.log('Final Parsed Matchups Array:');
        db.insertScheduledSeries(parsedMatchups);
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