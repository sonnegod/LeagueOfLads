import express from 'express';
import {addSameDayMatchSuggestions} from '../config/matchRecordSuggestions.js';

const positive=value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;

// Saved match metadata only: no player payloads or external API calls.
export function readMatchRecords(db,leagueId) {
  const records=db.prepare(`SELECT m.MatchId,m.TeamRad,m.TeamDire,m.WinnerId,m.RadiantScore,m.DireScore,
      l.DatePlayed,(SELECT MAX(s.SeriesId) FROM SeriesMatch s WHERE s.MatchId=m.MatchId) AS SeriesId,
      COALESCE(nr.DisplayName,tr.TeamName,'Team '||m.TeamRad) AS RadiantName,
      COALESCE(nd.DisplayName,td.TeamName,'Team '||m.TeamDire) AS DireName,
      tr.TeamName AS RadiantSourceName,td.TeamName AS DireSourceName,
      EXISTS(SELECT 1 FROM LeagueGroups g JOIN GroupNames n ON n.LeagueId=g.LeagueId AND n.GroupId=g.GroupId
        WHERE g.LeagueId=l.LeagueId AND g.TeamId=m.TeamRad) AS RadiantLinked,
      EXISTS(SELECT 1 FROM LeagueGroups g JOIN GroupNames n ON n.LeagueId=g.LeagueId AND n.GroupId=g.GroupId
        WHERE g.LeagueId=l.LeagueId AND g.TeamId=m.TeamDire) AS DireLinked
    FROM MatchLeague l JOIN MatchTeam m ON m.MatchId=l.MatchId
    LEFT JOIN TeamInfo tr ON tr.TeamId=m.TeamRad LEFT JOIN TeamInfo td ON td.TeamId=m.TeamDire
    LEFT JOIN LeagueTeamNames nr ON nr.LeagueId=l.LeagueId AND nr.TeamId=m.TeamRad
    LEFT JOIN LeagueTeamNames nd ON nd.LeagueId=l.LeagueId AND nd.TeamId=m.TeamDire
    WHERE l.LeagueId=? ORDER BY l.DatePlayed DESC,m.MatchId DESC`).all(leagueId).map(row=>({
      matchId:row.MatchId,seriesId:row.SeriesId,playedAt:row.DatePlayed,winnerId:row.WinnerId,
      radiantScore:row.RadiantScore,direScore:row.DireScore,
      team1:{id:row.TeamRad,name:row.RadiantName,sourceName:row.RadiantSourceName,needsReview:!row.RadiantLinked},
      team2:{id:row.TeamDire,name:row.DireName,sourceName:row.DireSourceName,needsReview:!row.DireLinked},
    }));
  return addSameDayMatchSuggestions(db,leagueId,records);
}

// Mounted behind the shared /admin authentication middleware.
export function createAdminMatchBrowserRouter({league,activeLeague}) {
  const router=express.Router();
  router.get('/',(req,res)=>{
    res.set('Cache-Control','private, no-store');
    const requested=req.query.leagueId;
    if(requested!==undefined&&!positive(requested))return res.status(400).json({error:'Invalid season'});
    try {
      const id=requested===undefined?activeLeague()?.LeagueId:positive(requested);
      const selected=id?league.prepare('SELECT LeagueId,LeagueName FROM LeagueInfo WHERE LeagueId=?').get(id):null;
      if(requested!==undefined&&!selected)return res.status(404).json({error:'Season not found'});
      return res.json({league:selected||null,matches:selected?readMatchRecords(league,selected.LeagueId):[]});
    }catch(error){
      console.error('Could not browse match records:',error.code||'internal');
      return res.status(500).json({error:'Could not load match records'});
    }
  });
  return router;
}
