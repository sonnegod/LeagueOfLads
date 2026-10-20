import express from 'express';
import {createQualificationSnapshot,readQualificationStage,readQualificationMatches,startQualificationStage,qualificationPreview,finalizeQualificationStage} from '../config/tiebreakerStage.js';

// Mounted behind the existing admin authentication and refresh middleware.
// Legacy seasons keep their existing stage controls.
export function createQualificationStageRouter({db,getActiveLeague,getRules,getGroups,getLastMatch,getUnlinkedCount=()=>0,audit=()=>{}}) {
  const router=express.Router();
  const fail=message=>{throw Object.assign(Error(message),{status:409});};
  function context(req) {
    const league=getActiveLeague();if(!league)fail('No active league');
    if(req.body?.leagueId!=null&&req.body.leagueId!==league.LeagueId)fail('The active league changed. Reload the league controls.');
    if(req.query?.leagueId!=null&&Number(req.query.leagueId)!==league.LeagueId)fail('The active league changed. Reload the league controls.');
    const saved=readQualificationStage(db,league.LeagueId);
    const snapshot=saved?.snapshot||createQualificationSnapshot(getGroups(league.LeagueId),getRules(league.LeagueId)||{});
    const boundary=db.prepare('SELECT * FROM LeagueStageBoundaries WHERE LeagueId=?').get(league.LeagueId);
    return {leagueId:league.LeagueId,saved,snapshot,boundary};
  }
  const matches=({leagueId,boundary})=>readQualificationMatches(db,leagueId,boundary);
  const route=handler=>(req,res,next)=>{
    try {handler(req,res,next);}catch(error){res.status(error.status||500).json({success:false,error:error.status?error.message:'Unable to update the tiebreaker stage'});}
  };
  router.use(['/playoffBracket','/saveBracket'],route((req,_res,next)=>{
    if(!getActiveLeague())return next();
    const state=context(req);
    if(state.snapshot?.pools.length&&!state.saved?.results&&state.boundary?.TieBreakerEndMatchId==null)
      fail('Finish tiebreakers and save their qualification results before setting up the playoff bracket.');
    next();
  }));
  router.get('/tiebreakerResults',route((req,res)=>{
    const state=context(req);
    res.set('Cache-Control','private, no-store');
    if(!state.snapshot?.pools.length)return res.json({enabled:false,ready:true});
    if(!state.boundary?.GroupEndMatchId)fail('Start tiebreakers before reviewing their results.');
    res.json({...qualificationPreview(state.snapshot,matches(state)),finalized:!!state.saved?.results});
  }));
  router.post('/activateTiebreakers',route((req,res,next)=>{
    if(!context(req).snapshot?.pools.length)return next();
    const result=db.transaction(()=>{
      const state=context(req);
      if(state.boundary)fail('Group stage already closed');
      if(getUnlinkedCount(state.leagueId))fail('All team names must have linked Team IDs before starting tiebreakers.');
      const last=getLastMatch();if(!last?.MatchId)fail('No matches found');
      startQualificationStage(db,state.leagueId,state.snapshot);
      db.prepare('INSERT INTO LeagueStageBoundaries(LeagueId,GroupEndMatchId,TieBreakerEndMatchId) VALUES(?,?,NULL)').run(state.leagueId,last.MatchId);
      audit('Tiebreakers Started',`Saved ${state.snapshot.pools.length} tiebreaker pools and their entrants for league ${state.leagueId}`);
      return {success:true,created:true};
    })();
    res.json(result);
  }));
  router.post('/activatePlayoffs',route((req,res,next)=>{
    if(!context(req).snapshot?.pools.length)return next();
    const result=db.transaction(()=>{
      const state=context(req);
      if(!state.boundary?.GroupEndMatchId)fail('Start and complete the configured tiebreakers before starting playoffs.');
      if(state.boundary.TieBreakerEndMatchId!=null)fail('Playoffs have already started');
      const last=getLastMatch();if(!last?.MatchId)fail('No matches found');
      const results=finalizeQualificationStage(db,state.leagueId,state.snapshot,matches(state),{
        revision:req.body?.qualificationRevision,orders:req.body?.poolOrders??{},
      });
      db.prepare('UPDATE LeagueStageBoundaries SET TieBreakerEndMatchId=? WHERE LeagueId=?').run(last.MatchId,state.leagueId);
      audit('Tiebreakers Finalized',`Saved final tiebreaker placements and playoff seeds for league ${state.leagueId}`);
      return {success:true,qualifiers:results.teams.filter(team=>team.Qualification!=='eliminated').length};
    })();
    res.json(result);
  }));
  return router;
}
