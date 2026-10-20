import express from 'express';
import {qualificationRevision} from '../config/qualificationStore.js';

// The parent /admin router supplies authentication and refresh middleware.
export function createLeagueRulesRouter({db,getActiveLeague,getRules,saveRules,changed=()=>false}) {
  const router=express.Router();
  const error=(res,error)=>res.status(error.status||500).json({error:error.status?error.message:'Unable to update league rules'});
  router.get('/leagueRules',(_req,res)=>{
    try {
      const league=getActiveLeague();if(!league)return res.status(404).json({error:'No active league'});
      const rules=getRules(league.LeagueId);
      res.set('Cache-Control','private, no-store').json({league,rules,revision:qualificationRevision(rules)});
    }catch(failure){error(res,failure);}
  });
  router.post('/leagueRules',(req,res)=>{
    try {
      const result=db.transaction(()=>{
        const league=getActiveLeague();if(!league)throw Object.assign(Error('No active league'),{status:404});
        const input=req.body||{};
        if(input.leagueId!=null&&input.leagueId!==league.LeagueId)throw Object.assign(Error('The active league changed. Reload the groups.'),{status:409});
        if(input.revision!=null&&input.revision!==qualificationRevision(getRules(league.LeagueId)))
          throw Object.assign(Error('Another admin changed these rules. Reload saved rules before trying again.'),{status:409});
        const rules=saveRules(league.LeagueId,input),bettingSetupUpdated=changed(league.LeagueId);
        return {success:true,rules,revision:qualificationRevision(rules),bettingSetupUpdated};
      })();
      res.json(result);
    }catch(failure){error(res,failure);}
  });
  return router;
}
