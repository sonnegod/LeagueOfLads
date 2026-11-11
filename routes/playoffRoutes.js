import express from 'express';
import {readPlayoffBracket,savePlayoffBracket} from '../config/playoffBracketAdmin.js';

// Admin paths are mounted after the existing checkAdmin middleware.
export function createPlayoffRouter({db,activeLeague,publicLeague=activeLeague,audit=()=>{}}) {
  const router=express.Router();
  const endpoint=run=>(req,res)=>{try{return run(req,res);}catch(error){
    if(error.status)return res.status(error.status).json({error:error.message});
    console.error('Playoff request failed:',error.code||error.name);return res.status(500).json({error:'Unable to update or load the playoff bracket.'});
  }};
  router.get('/admin/playoffBracket',endpoint((req,res)=>{
    res.set('Cache-Control','private, no-store');const leagueId=activeLeague();
    if(!leagueId)return res.status(409).json({error:'Select an active league before setting up playoffs.'});
    return res.json(readPlayoffBracket(db,leagueId));
  }));
  router.get('/getCurrentBracket',endpoint((req,res)=>{
    res.set('Cache-Control','no-store');const leagueId=req.query.leagueId==null?publicLeague():Number(req.query.leagueId);
    if(req.query.leagueId!=null&&(!Number.isSafeInteger(leagueId)||leagueId<=0))return res.status(400).json({error:'Invalid league.'});
    if(!leagueId)return res.json({playoffBracket:null,matchDetails:{}});
    const {playoffBracket,matchDetails}=readPlayoffBracket(db,leagueId);return res.json({playoffBracket,matchDetails});
  }));
  router.post('/admin/saveBracket',endpoint((req,res)=>{
    const leagueId=activeLeague();if(!leagueId)return res.status(409).json({error:'Select an active league.'});
    return res.json(savePlayoffBracket(db,leagueId,req.body||{},audit));
  }));
  return router;
}
