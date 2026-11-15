import express from 'express';
import {signupSeasons,signupHistory} from '../config/signupHistory.js';

// Mounted under /admin after checkAdmin in routes.js. No mutation endpoints.
export function createAdminSignupRouter({league}) {
  const router=express.Router();
  router.use((req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    if(!['GET','HEAD'].includes(req.method))return res.set('Allow','GET, HEAD').status(405).json({error:'Signups history is read-only'});
    next();
  });
  const read=fn=>(req,res)=>{
    try{return fn(req,res);}catch(error){
      console.error('Signup history unavailable:',error.code||'internal');
      return res.status(500).json({error:'Could not load signup history'});
    }
  };
  router.get('/',read((req,res)=>{
    const seasons=signupSeasons(league);
    return res.json({seasons,defaultSeasonId:(seasons.find(season=>season.TeamCount>0)||seasons[0])?.SeasonId??null});
  }));
  router.get('/:seasonId',read((req,res)=>{
    const raw=req.params.seasonId,seasonId=Number(raw);
    if(!/^\d+$/.test(raw)||!Number.isSafeInteger(seasonId)||seasonId<1)return res.status(400).json({error:'Invalid season'});
    const history=signupHistory(league,seasonId);
    return history?res.json(history):res.status(404).json({error:'Season not found'});
  }));
  return router;
}
