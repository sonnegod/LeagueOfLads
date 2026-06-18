import db from '../../database.js';

const activeLeagueId = db.getActiveLeague()?.[0]?.LeagueId;

if (activeLeagueId) {
    process.stdout.write(String(activeLeagueId));
}
