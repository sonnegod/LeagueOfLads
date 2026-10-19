import db from '../../database.js';
import apiURL from '../../apiURL.js';
import { startSourceLoad, finishSourceLoad, recordMatchStart } from '../../analytics/sourceMetadata.js';

import dotenv from 'dotenv';
dotenv.config();

async function runRecentMatches() {
    const leagueId = db.getActiveLeague()?.[0]?.LeagueId;
    if (!leagueId) {
      console.log('No active league. Skipping current league match load.');
      return;
    }

    console.log("Beginning load of new matches");
    const result = await checkMatches(leagueId);
    console.log(`Completed pulling recent matchs for League ${leagueId}, ${result.totalNewMatches} new matches.`);
    return result.totalNewMatches;
}

const sourceRunId = startSourceLoad(db.db, 'match_history');
try {
  const records = await runRecentMatches();
  finishSourceLoad(db.db, sourceRunId, { records: records || 0 });
} catch {
  finishSourceLoad(db.db, sourceRunId, { failed: true, failures: 1 });
  console.error('Current league match load failed; source freshness was not advanced.');
  process.exitCode = 1;
}

async function checkMatches(leagueId) {
  console.log('Obatining League data for .'+leagueId);
  console.log('---------------------------------------');

  let startAtMatchId = null;//db.getMostRecentMatch();

  const preloadedMatchDetailIds = db.preloadedData.matches.map(match => match.MatchId);
  let allNewMatches = [];

  while (true) {
    const url = new URL('http://api.steampowered.com/IDOTA2Match_570/GetMatchHistory/v1/');
    url.searchParams.append('key', process.env.STEAM_API_KEY);
    url.searchParams.append('league_id', leagueId);
    url.searchParams.append('matches_requested', 100);
    if (startAtMatchId !== null) {
      url.searchParams.append('start_at_match_id', startAtMatchId);
    }

    try {
      const response = await fetch(url.toString(), { method: 'GET' });
      if (!response.ok) throw new Error('Steam match history request failed');
      const data = await response.json();

      if (!data.result || data.result.status !== 1 || !Array.isArray(data.result.matches)) {
        throw new Error('Invalid Steam match history response');
      }
      if (data.result.matches.length === 0) {
        console.log('No more matches found.');
        break; // no more matches
      }

      // Filter out matches already in DB
      const newMatches = data.result.matches.filter(match => !preloadedMatchDetailIds.includes(match.match_id));
      if (newMatches.length === 0) {
        console.log('No new matches found in this batch.');
        break; // no new matches to process
      }

      allNewMatches = allNewMatches.concat(newMatches);

      // Prepare for next pagination
      const lastMatchId = data.result.matches[data.result.matches.length - 1].match_id;
      startAtMatchId = lastMatchId - 1;

      console.log(`Fetched ${newMatches.length} new matches, total new so far: ${allNewMatches.length}`);
    } catch (error) { throw error; }
  }

  console.log(`${allNewMatches.length} new Matches to parse from Dota`);
  
  if (allNewMatches.length > 0) {
    // Prepare data for DB inserts
    const teamMatchData = allNewMatches.map(match => ({
      series_id: match.series_id,
      match_id: match.match_id,
      radiant_team_id: match.radiant_team_id,
      dire_team_id: match.dire_team_id
    }));

    const matchLeagueIds = allNewMatches.map(match => ({
      match_id: match.match_id,
      league_id: leagueId,
      date_played: match.start_time > 0 ? new Date(match.start_time * 1000).toISOString() : null
    }));

    db.db.transaction(() => {
      if (db.insertMatches(teamMatchData) !== 1 || db.insertMatchLeague(matchLeagueIds) !== 1) {
        throw new Error('Could not persist match history');
      }
      for (const match of allNewMatches) recordMatchStart(db.db, match.match_id, match.start_time, 'steam_history');
    })();

    // Prepare list of match IDs for detail fetching
    const matchDetailIds = allNewMatches.map(match => ({ match_id: match.match_id }));
    console.log(`Total new matches to get details for: ${matchDetailIds.length}`);

    return { totalNewMatches: allNewMatches.length };

    //await getMatchDetails(matchDetailIds);
  } else {
    console.log('No new matches to process.');
  }
  return { totalNewMatches: allNewMatches.length };

}
