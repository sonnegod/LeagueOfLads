import express from 'express';
import {leagueGroupBoardRevision,saveLeagueGroupBoard} from '../config/leagueGroupBoard.js';

// Mounted below the existing /admin authentication and mutation-refresh middleware.
export function createLeagueGroupBoardRouter({db,getActiveLeague,getGroups,getAvailableTeams,rebuild,audit}) {
  const router=express.Router();
  const readBoard=()=>db.transaction(()=>{
    const league=getActiveLeague()||null;
    const board={league,groups:league?getGroups(league.LeagueId):[],availableTeams:league?getAvailableTeams(league.LeagueId):[]};
    return {...board,revision:leagueGroupBoardRevision(board)};
  })();
  router.get('/leagueSetup',(_req,res,next)=>{
    try{res.set('Cache-Control','private, no-store').json(readBoard());}catch(error){next(error);}
  });
  router.put('/leagueSetup',(req,res,next)=>{
    try {
      saveLeagueGroupBoard(db,req.body,{readBoard,rebuild,audit});
      res.set('Cache-Control','private, no-store').json({success:true,...readBoard()});
    }catch(error){
      if(error.status)return res.status(error.status).json({error:error.message});
      if(error.code?.startsWith('SQLITE_CONSTRAINT'))return res.status(409).json({error:'A group or team name is already assigned. Check the draft and try again.'});
      next(error);
    }
  });
  return router;
}
