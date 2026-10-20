import express from 'express';
import {groupTeamKey,leagueGroupBoardRevision,saveLeagueGroupBoard} from '../config/leagueGroupBoard.js';

// Mounted below the existing /admin authentication and mutation-refresh middleware.
export function createLeagueGroupBoardRouter({db,getActiveLeague,getGroups,getAvailableTeams,getUnregisteredTeams=()=>[],getRoster=()=>null,rebuild,audit}) {
  const router=express.Router();
  const readBoard=()=>db.transaction(()=>{
    const league=getActiveLeague()||null;
    const board={league,groups:league?getGroups(league.LeagueId):[],availableTeams:league?getAvailableTeams(league.LeagueId):[],
      unregisteredTeams:league?getUnregisteredTeams(league.LeagueId):[]};
    return {...board,revision:leagueGroupBoardRevision(board)};
  })();
  router.get('/leagueSetup',(_req,res,next)=>{
    try{res.set('Cache-Control','private, no-store').json(readBoard());}catch(error){next(error);}
  });
  router.get('/leagueSetup/players',(req,res,next)=>{
    try {
      const players=db.transaction(()=>{
        const board=readBoard();
        if(!board.league)return null;
        const team=[...board.groups.flatMap(group=>group.teams),...board.availableTeams]
          .find(candidate=>groupTeamKey(candidate)===req.query.team)
          || board.unregisteredTeams.find(candidate=>`submission:${candidate.TeamSubmissionId}`===req.query.team);
        if(!team)return null;
        const roster=getRoster(board.league.LeagueId,team);
        return [...(roster?.players||[]).map(player=>({PlayerId:player.PlayerId,PlayerName:String(player.PlayerName??`Player ${player.PlayerId}`)})),
          ...(roster?.pendingSlots||[]).map(()=>({PlayerId:null,PlayerName:'Player TBD'}))];
      })();
      if(!players)return res.status(404).json({error:'Team is not in the current group setup'});
      res.set('Cache-Control','private, no-store').json({players});
    }catch(error){next(error);}
  });
  router.put('/leagueSetup',(req,res,next)=>{
    try {
      saveLeagueGroupBoard(db,req.body,{readBoard,rebuild,audit});
      res.set('Cache-Control','private, no-store').json({success:true,...readBoard()});
    }catch(error){
      if(error.status)return res.status(error.status).json({error:error.message});
      if(error.code?.startsWith('SQLITE_CONSTRAINT')) {
        const message=error.code==='SQLITE_CONSTRAINT_UNIQUE'
          ?'A group or team name is already assigned. Check the draft and try again.'
          :error.code==='SQLITE_CONSTRAINT_FOREIGNKEY'
            ?'This team is still referenced by league data and cannot be removed.'
            :'The group setup conflicts with existing league data. Reload the groups and try again.';
        return res.status(409).json({error:message});
      }
      next(error);
    }
  });
  return router;
}
