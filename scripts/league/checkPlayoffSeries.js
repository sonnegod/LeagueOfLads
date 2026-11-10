import db from '../../database.js';
import {refreshSeriesLifecycle,advanceCompletedPlayoffSeries,currentLeagueStage} from '../../config/seriesLifecycle.js';
const leagueId=db.getActiveLeague()?.[0]?.LeagueId;
if(leagueId&&currentLeagueStage(db.db,leagueId)==='p') {
  for(const row of db.db.prepare("SELECT SeriesId FROM SeriesInfo WHERE LeagueId=? AND Stage='p'").all(leagueId))refreshSeriesLifecycle(db.db,row.SeriesId);
  db.db.transaction(()=>advanceCompletedPlayoffSeries(db.db,leagueId)).immediate();
  console.log('Playoff bracket updated using verified completed series.');
}else console.log('Not in playoffs, ending job');
