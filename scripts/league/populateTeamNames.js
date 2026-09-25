import db from '../../database.js';
import apiURL from '../../apiURL.js';

import dotenv from 'dotenv';
dotenv.config();


populateTeamNames();

async function populateTeamNames(){
    console.log('Populating Team Information');

    const teams = db.getAllTeamsBase();

    const preloadedTeams = db.preloadedData.teamNames.map(team => team.TeamId);


    const newTeams = teams.filter(team => !preloadedTeams.includes(team.TeamId));
console.log(newTeams);

    for(const teamId of newTeams){
        console.log(teamId);

        const url = new URL('https://api.steampowered.com/IDOTA2Match_570/GetTeamInfoByTeamID/v1/');
        url.searchParams.append('key', process.env.STEAM_API_KEY);
        url.searchParams.append('start_at_team_id', teamId.TeamId);

        try {
        const response = await fetch(url.toString());
        const data = await response.json();
        const teamInfo = data?.result?.teams?.[0];

        if (teamInfo && (teamInfo.team_id == null || Number(teamInfo.team_id) === teamId.TeamId)) {
          console.log(teamInfo.name);
          // Insert into TeamInfo table
          const teamInformation = {
            team_id: teamId.TeamId,
            team_name: teamInfo.name
          }
          db.insertTeam(teamInformation);

        } else {
          console.warn(`No matching team info returned for ID: ${teamId.TeamId}`);
        }

        // Optional delay to avoid rate-limiting
        await new Promise(res => setTimeout(res, 200));
      } catch (error) {
        console.error(`Failed to fetch team ${teamId}:`, error);
      }
    }

    const leagueId = db.getActiveLeague()?.[0]?.LeagueId;
    if (leagueId) {
      const linked = db.autoLinkLeagueRosterEntries(leagueId);
      console.log(`Linked ${linked.length} preseason teams to IDs for league ${leagueId}.`);
    }
}
