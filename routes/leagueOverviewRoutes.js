import express from 'express';
import {currentSeasonRoster} from '../betting/rosterMembership.js';
import {buildLeagueOverview} from '../config/leagueOverview.js';

// Mounted behind /admin. Return operational counts, never signup MMR or screenshots.
export function createLeagueOverviewRouter({league,readRoster=currentSeasonRoster,now=()=>new Date()}) {
  const router=express.Router();
  router.get('/:seasonId',(req,res)=>{
    res.set('Cache-Control','private, no-store');
    const id=Number(req.params.seasonId);
    if(!/^\d+$/.test(req.params.seasonId)||!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'Invalid season'});
    try {
      const season=league.prepare('SELECT SeasonId,LeagueName,Status,ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(id);
      if(!season)return res.status(404).json({error:'Season not found'});
      if(season.Status!=='active')return res.status(409).json({error:'This league is not active'});
      const entries=league.prepare(`SELECT EntryId,TeamSubmissionId,TeamId,GroupId,DisplayName AS TeamName FROM LeagueRosterEntries
        WHERE LeagueId=? ORDER BY SortOrder,EntryId`).all(season.ExternalLeagueId);
      const groups=league.prepare('SELECT GroupId,GroupName FROM GroupNames WHERE LeagueId=? ORDER BY GroupId').all(season.ExternalLeagueId);
      const boundary=league.prepare('SELECT GroupEndMatchId,TieBreakerEndMatchId FROM LeagueStageBoundaries WHERE LeagueId=?').get(season.ExternalLeagueId);
      const matches=league.prepare(`SELECT m.TeamRad,m.TeamDire,m.WinnerId FROM MatchLeague l JOIN MatchTeam m ON m.MatchId=l.MatchId
        WHERE l.LeagueId=? AND m.WinnerId IN (m.TeamRad,m.TeamDire) AND (? IS NULL OR m.MatchId<=?)`)
        .all(season.ExternalLeagueId,boundary?.GroupEndMatchId??null,boundary?.GroupEndMatchId??null);
      const overrides=league.prepare('SELECT GroupId,TeamA,TeamB,WinsA,WinsB,BaseWinsA,BaseWinsB FROM GroupResultOverrides WHERE LeagueId=?').all(season.ExternalLeagueId);
      return res.json(buildLeagueOverview({season,entries,groups,matches,overrides,
        roster:readRoster(league,id,season.Status),stage:boundary?.TieBreakerEndMatchId!=null?'playoffs':boundary?.GroupEndMatchId!=null?'tiebreakers':'groups'},now()));
    }catch(error){
      console.error('Could not load league overview:',error.code||'internal');
      return res.status(500).json({error:'Could not load league overview'});
    }
  });
  return router;
}
