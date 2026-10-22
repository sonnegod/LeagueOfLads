import express from 'express';
import {fail} from '../betting/scheduleStore.js';
import {parseScheduleTime} from '../betting/scheduleParser.js';
import {readRosterOrder} from '../config/rosterDisplayOrder.js';
import {requestAccountId} from './utility/requestAccountId.js';

const positive=value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const endpoint=fn=>(req,res)=>{
  try{return fn(req,res);}catch(error){
    if(error.status)return res.status(error.status).json({error:error.message,code:error.code});
    console.error('Roster request failed:',error.code||'internal');
    return res.status(500).json({error:'Roster request failed'});
  }
};
function effectiveTime(body) {
  if(!body.localTime)return body;
  const parsed=parseScheduleTime(body.localTime,new Date().toISOString(),60,{allowPast:true});
  if(parsed.error)fail('Effective time needs correction');
  return {...body,effectiveAtUtc:parsed.scheduledStartUtc};
}

// Shared with the existing site-management URL for backward compatibility.
export function createRosterChangeHandler({schedules}) {
  return endpoint((req,res)=>{
    const sid=positive(req.params.seasonId);if(!sid)fail('Invalid season');
    return res.json(schedules.changeRoster(sid,effectiveTime({...req.body}),requestAccountId(req)));
  });
}

// Mounted behind the league-admin middleware in routes.js.
export function createAdminRosterRouter({league,schedules}) {
  const router=express.Router();
  router.get('/status',endpoint((req,res)=>{
    const sid=positive(req.query.seasonId||req.body?.seasonId)||league.prepare(`SELECT SeasonId FROM LeagueSeasons
      ORDER BY CASE WHEN Status!='ended' THEN 0 ELSE 1 END,ExternalLeagueId DESC NULLS LAST,SeasonId DESC LIMIT 1`).get()?.SeasonId||null;
    const season=sid?league.prepare('SELECT SeasonId,LeagueName,Status FROM LeagueSeasons WHERE SeasonId=?').get(sid):null;
    res.set('Cache-Control','no-store');
    return res.json({season:season?{seasonId:season.SeasonId,name:season.LeagueName,status:season.Status}:null,
      teams:sid?schedules.teams(sid).map(t=>({teamKey:t.TeamSubmissionId,name:t.TeamName,teamId:t.ExternalTeamId})):[],
      rosterSlots:sid?schedules.rosterSlots(sid):[],
      captains:sid?schedules.teamCaptains(sid):[],
      rosterOrders:sid?schedules.teams(sid).map(t=>({teamKey:t.TeamSubmissionId,order:readRosterOrder(league,t.TeamSubmissionId)})):[]});
  }));
  router.get('/players',endpoint((req,res)=>{
    const search=String(req.query.search||'').trim();if(search.length>100)fail('Search is too long');
    if(!search)return res.json({players:[]});
    const pattern=`%${search.replace(/[!%_]/g,'!$&')}%`;
    return res.json({players:league.prepare(`SELECT PlayerId,CAST(PlayerName AS TEXT) AS PlayerName FROM PlayerInfo
      WHERE PlayerId>0 AND (CAST(PlayerName AS TEXT) LIKE ? ESCAPE '!' OR CAST(PlayerId AS TEXT) LIKE ? ESCAPE '!')
      ORDER BY PlayerName COLLATE NOCASE,PlayerId LIMIT 50`).all(pattern,pattern)});
  }));
  const action=operation=>endpoint((req,res)=>{
    const sid=positive(req.params.seasonId);if(!sid)fail('Invalid season');
    return res.json(operation(sid,req.body||{},requestAccountId(req)));
  });
  router.put('/seasons/:seasonId/roster-order',action((sid,body,actor)=>schedules.reorderRoster(sid,body,actor)));
  router.put('/seasons/:seasonId/captain',action((sid,body,actor)=>schedules.changeCaptain(sid,body,actor)));
  router.post('/seasons/:seasonId/pending-slots',action((sid,body,actor)=>schedules.setPendingSlot(sid,body,actor)));
  router.post('/seasons/:seasonId/pending-slots/confirm',action((sid,body,actor)=>schedules.confirmPendingSlot(sid,effectiveTime(body),actor)));
  router.post('/seasons/:seasonId/roster-changes',createRosterChangeHandler({schedules}));
  return router;
}
