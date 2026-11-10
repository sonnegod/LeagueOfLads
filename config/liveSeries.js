import {hasTable} from './matchResultsSchema.js';
import {matchImportStatus} from './matchResults.js';

export function attachLiveResultStatus(db,rows) {
  if(!db||!hasTable(db,'TrackedLeagueMatches'))return rows;
  const read=db.prepare(`SELECT t.*,s.Team1,s.Team2,s.DateCreated,l.BestOf,l.Status SeriesStatus,l.Team1Wins,l.Team2Wins,
    COALESCE(na.DisplayName,a.TeamName) Team1Name,COALESCE(nb.DisplayName,b.TeamName) Team2Name,m.WinnerId FROM TrackedLeagueMatches t
    LEFT JOIN SeriesInfo s USING(SeriesId) LEFT JOIN SeriesLifecycle l USING(SeriesId)
    LEFT JOIN TeamInfo a ON a.TeamId=s.Team1 LEFT JOIN TeamInfo b ON b.TeamId=s.Team2
    LEFT JOIN LeagueTeamNames na ON na.LeagueId=t.LeagueId AND na.TeamId=s.Team1
    LEFT JOIN LeagueTeamNames nb ON nb.LeagueId=t.LeagueId AND nb.TeamId=s.Team2
    LEFT JOIN MatchTeam m USING(MatchId) WHERE t.MatchId=?`);
  return rows.map(row=>{const t=read.get(row.MatchId);return t?{...row,TrackedSeriesId:t.SeriesId,
    SeriesTeam1:t.Team1,SeriesTeam2:t.Team2,SeriesTeam1Name:t.Team1Name,SeriesTeam2Name:t.Team2Name,
    SeriesBestOf:t.BestOf,SeriesStatus:t.SeriesStatus,SeriesTeam1Wins:t.Team1Wins,SeriesTeam2Wins:t.Team2Wins,
    MatchStartedAt:t.StartedAt,WinnerTeamId:t.ResultStatus==='imported'?t.WinnerId:null,ImportStatus:matchImportStatus(db,row.MatchId)}:row;});
}
export {groupLiveSeries} from '../shared/liveSeries.js';
