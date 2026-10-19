import express from 'express';
import {confirmPlayerName} from '../config/playerLogin.js';

export function createPlayerLoginRouter(db,accountIdFromSteamId) {
  const router=express.Router();
  router.post('/auth/confirm-player-name',(req,res,next)=>{
    if(!req.isAuthenticated?.()||!req.user)return res.status(401).json({error:'Not logged in'});
    try {
      const result=confirmPlayerName(db,accountIdFromSteamId(req.user.id),req.body?.name);
      if(!result.success)return res.status(result.status||400).json({error:result.message,nextNameChangeAt:result.nextNameChangeAt});
      res.set('Cache-Control','no-store').json(result);
    }catch(error){next(error);}
  });
  return router;
}
