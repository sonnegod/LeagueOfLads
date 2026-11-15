import db from '../../database.js';
import {closeNightlySeries} from '../../config/seriesLifecycle.js';

const leagueId=db.getActiveLeague()?.[0]?.LeagueId;
if(leagueId) {
  const closed=closeNightlySeries(db.db,leagueId);
  console.log(JSON.stringify({leagueId,closedIncompleteSeries:closed.length,seriesIds:closed}));
}else console.log('No active league. Skipping nightly series closure.');
