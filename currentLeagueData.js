import db from './database.js';
import apiURL from './apiURL.js';

import dotenv from 'dotenv';
dotenv.config();

async function runRecentMatches() {
    const leagueId = db.getCurrentLeague();

    const result = await checkMatches(leagueId[0].LeagueId);
    console.log(`Completed pulling recent matchs for League ${leagueId[0].LeagueId}, ${result.totalNewMatches} new matches.`);
}

runRecentMatches();

async function checkMatches(leagueId) {
  console.log('Obatining League data for .'+leagueId);
  console.log('---------------------------------------');

  let startAtMatchId = null;//db.getMostRecentMatch();
  console.log(startAtMatchId);
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
      const data = await response.json();

      if (!data.result || !data.result.matches || data.result.matches.length === 0) {
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
    } catch (error) {
      console.error('Error fetching matches:', error);
      break;
    }
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

    let yesterdaysDate = new Date();
    yesterdaysDate.setDate(yesterdaysDate.getDate() - 1);
    yesterdaysDate = yesterdaysDate.toISOString().split('T')[0];

    const matchLeagueIds = allNewMatches.map(match => ({
      match_id: match.match_id,
      league_id: leagueId,
      date_played: yesterdaysDate
    }));

    db.insertMatches(teamMatchData);
    db.insertMatchLeague(matchLeagueIds);

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