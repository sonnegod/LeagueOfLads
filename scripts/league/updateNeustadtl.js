import db from '../../database.js';

const leagueId = db.getActiveLeague()?.[0]?.LeagueId;
if (leagueId) {
  db.rebuildLeagueGroupStandings(leagueId);
  console.log(`Updated group standings and Neustadtl for league ${leagueId}`);
} else {
  console.log('No active league. Skipping group standings update.');
}
