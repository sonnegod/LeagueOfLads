import express from 'express';
import {fail} from '../betting/scheduleStore.js';
import {parseScheduleTime} from '../betting/scheduleParser.js';
import {requestAccountId} from './utility/requestAccountId.js';

const positive=value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const endpoint=fn=>(req,res)=>{
  try{return fn(req,res);}catch(error){
    if(error.status)return res.status(error.status).json({error:error.message,code:error.code});
    console.error('Match administration request failed:',error.code||'internal');
    return res.status(500).json({error:'Match administration request failed'});
  }
};

// Mounted behind checkAdmin. Scheduling access does not grant betting management.
export function createAdminMatchRouter({league,schedules,includeLocalTests=false}) {
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.get('/status',endpoint((req,res)=>{
    const requested=req.query.seasonId;
    if(requested!==undefined&&!positive(requested))fail('Invalid season');
    const sid=positive(requested)||league.prepare(`SELECT SeasonId FROM LeagueSeasons
      ORDER BY CASE WHEN Status!='ended' THEN 0 ELSE 1 END,ExternalLeagueId DESC NULLS LAST,SeasonId DESC LIMIT 1`).get()?.SeasonId||null;
    const season=sid?league.prepare('SELECT SeasonId,LeagueName,Status,ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(sid):null;
    if(sid&&!season)fail('Season not found',404);
    return res.json({localTesting:includeLocalTests,
      season:season?{seasonId:sid,name:season.LeagueName,status:season.Status,leagueId:season.ExternalLeagueId}:null,
      seasons:league.prepare('SELECT SeasonId,LeagueName,Status FROM LeagueSeasons ORDER BY ExternalLeagueId DESC NULLS LAST,SeasonId DESC LIMIT 30')
        .all().map(s=>({seasonId:s.SeasonId,name:s.LeagueName,status:s.Status})),
      teams:sid?schedules.teams(sid).map(t=>({teamKey:t.TeamSubmissionId,name:t.TeamName,teamId:t.ExternalTeamId})):[],
      events:sid?schedules.list(sid,{includeLocalTests}):[],
      messages:sid?league.prepare(`SELECT MessageId,ChannelId,AuthoredAtUtc,EditedAtUtc,Content,DisplayContent,ParseStatus,IssueCode,EventId,Deleted
        FROM ScheduleMessages WHERE ParseStatus='needs_review' AND SeasonId=? ORDER BY LastSeenAtUtc DESC LIMIT 50`).all(sid):[],
      aliases:sid?league.prepare('SELECT RoleId,TeamSubmissionId FROM TeamDiscordAliases WHERE SeasonId=?').all(sid):[]});
  }));
  router.post('/seasons/:seasonId/events',endpoint((req,res)=>{
    const sid=positive(req.params.seasonId);if(!sid)fail('Invalid season');let parsed={};
    if(req.body?.localTime) {
      parsed=parseScheduleTime(req.body.localTime,new Date().toISOString(),60,{allowPast:!!req.body.eventId});
      if(parsed.error)fail(`Schedule needs correction: ${parsed.error}`);
    }
    const event=schedules.save(sid,{...req.body,...parsed},requestAccountId(req));
    return res.status(201).json({event});
  }));
  router.put('/seasons/:seasonId/aliases',endpoint((req,res)=>{
    const sid=positive(req.params.seasonId),team=positive(req.body?.teamKey),role=String(req.body?.roleId||'');
    if(!sid||!/^\d{15,22}$/.test(role)||!schedules.teams(sid).some(t=>t.TeamSubmissionId===team))fail('Select a season team and valid Discord role ID');
    league.prepare(`INSERT INTO TeamDiscordAliases VALUES (?,?,?) ON CONFLICT(SeasonId,RoleId) DO UPDATE SET TeamSubmissionId=excluded.TeamSubmissionId`).run(sid,role,team);
    schedules.audit('Schedule Role Linked',`Linked Discord role ${role} to team ${team}`);
    return res.json({saved:true});
  }));
  router.post('/messages/:messageId/resolve',endpoint((req,res)=>{
    const event=schedules.get(positive(req.body?.eventId));if(!event)fail('Select a fixture');
    const post=league.prepare('SELECT SeasonId FROM ScheduleMessages WHERE MessageId=?').get(req.params.messageId);
    if(post?.SeasonId&&post.SeasonId!==event.SeasonId)fail('The fixture must belong to the scheduling post’s season');
    const changed=league.prepare("UPDATE ScheduleMessages SET EventId=?,SeasonId=?,ParseStatus='resolved',IssueCode=NULL WHERE MessageId=?")
      .run(event.EventId,event.SeasonId,req.params.messageId);
    if(!changed.changes)fail('Scheduling post not found',404);
    schedules.audit('Schedule Resolved',`Linked scheduling post ${req.params.messageId} to fixture ${event.EventId}`);
    return res.json({saved:true});
  }));
  return router;
}
