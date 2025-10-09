
//should run for each match
/*const get_match_data = 'https://api.opendota.com/api/matches/{match_id}'; //include match_id

//should run 1 time
const get_lads_teams = ''; //include league_id

//should run 1 time a day probably
const get_lads_matches = 'http://api.steampowered.com/IDOTA2Match_570/GetMatchHistory/v1/?key='+key+'&league_id='+league_id+'&start_at_match_id='+lastMatchID +''; //include league_id, include last match id to pull most recent data

//should max 3 times
const get_team_player_data = ''; //include team_id

//should run at time of scouting, 1-2 times a week
const get_player_data = 'https://api.opendota.com/api/players/{account_id}/heroes?date=90&having=1' //include account_id


//RUN_ORDER
get_lads_teams; //include league_id
/THEN/
get_team_player_data; //include team_id, needs a match played
/THEN/
get_lads_matches; //include league_id
/THEN FOR EACH/
get_match_data;  //include match_id from above
/THEN ON SCOUTING DAY/
get_player_data; //include account id from team scouting
*/


const basePlayerURL = 'https://api.opendota.com/api/players/';
const baseMatchData = 'https://api.opendota.com/api/matches/';

//for getting wardmap https://api.opendota.com/api/players/{account_id}/wardmap

export default {basePlayerURL, baseMatchData};