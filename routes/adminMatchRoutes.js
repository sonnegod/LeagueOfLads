import express from 'express';
import {fail} from '../betting/scheduleStore.js';
import {parseScheduleTime} from '../betting/scheduleParser.js';
import {requestAccountId} from './utility/requestAccountId.js';
import {archiveRemakeDraft,heldRemakeDrafts,heldRemakeDraft,canonicalDraftTarget,linkRemakeDraft,linkMatchingRemakeDraft,discardHeldRemakeDraft} from '../config/remakeDrafts.js';

const positive=value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const endpoint=fn=>(req,res)=>{
  const report=error=>{
    if(error.status)return res.status(error.status).json({error:error.message,code:error.code});
    console.error('Match administration request failed:',error.code||'internal');
    return res.status(500).json({error:'Match administration request failed'});
  };
  try{const result=fn(req,res);return result?.then?result.catch(report):result;}catch(error){return report(error);}
};

// Mounted behind checkAdmin. Scheduling access does not grant betting management.
export function createAdminMatchRouter({league,schedules,includeLocalTests=false,loadDraft=async id=>{
  const response=await fetch(`https://api.opendota.com/api/matches/${id}`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)fail('Could not retrieve the draft match from OpenDota. Try again later.',502);
  return response.json();
}}) {
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.post('/held-drafts/import',endpoint(async(req,res)=>{
    const sourceId=positive(req.body?.sourceMatchId),sid=positive(req.body?.seasonId);
    if(!sourceId||!sid)fail('Select a season and draft match ID');
    const season=league.prepare('SELECT ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(sid);
    if(!season?.ExternalLeagueId)fail('Season is not linked to a league');
    const data=await loadDraft(sourceId);
    if(data?.match_id!==sourceId||data.leagueid!==season.ExternalLeagueId)fail('Draft match does not belong to the selected league');
    const result=league.transaction(()=>{
      if(league.prepare('SELECT 1 FROM MatchTeam WHERE MatchId=?').get(sourceId))fail('This draft source is still recorded as a played match. Remove that record first.',409);
      const source=archiveRemakeDraft(league,data);
      if(!source)fail('This held draft was deleted and will not be reimported.',409);
      const existing=league.prepare('SELECT MatchId FROM MatchDraftSources WHERE SourceMatchId=?').get(sourceId);
      if(existing)return {held:false,matchId:existing.MatchId};
      const held=heldRemakeDrafts(league,source.leagueId).find(draft=>draft.sourceMatchId===sourceId);
      if(held?.candidates.length===1){
        const matchId=held.candidates[0].matchId;
        const linked=linkMatchingRemakeDraft(league,matchId,canonicalDraftTarget(league,matchId,source.leagueId));
        if(linked.status==='linked'){
          schedules.audit('Remake Draft Linked',`Imported draft ${sourceId} and linked it to played match ${matchId}`);
          return {held:false,matchId};
        }
      }
      schedules.audit('Remake Draft Held',`Imported draft ${sourceId} for review`);
      return {held:true};
    }).immediate();
    return res.json({...result,sourceMatchId:sourceId});
  }));
  router.get('/held-drafts',endpoint((req,res)=>{
    const sid=positive(req.query.seasonId);if(!sid)fail('Select a season');
    const season=league.prepare('SELECT ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(sid);
    if(!season)fail('Season not found',404);
    return res.json({drafts:season.ExternalLeagueId?heldRemakeDrafts(league,season.ExternalLeagueId):[]});
  }));
  router.post('/held-drafts/:sourceId/link',endpoint((req,res)=>{
    const sourceId=positive(req.params.sourceId),matchId=positive(req.body?.matchId);
    if(!sourceId||!matchId)fail('Select a held draft and played match');
    const result=league.transaction(()=>{
      const source=heldRemakeDraft(league,sourceId);if(!source)fail('Held draft not found. Refresh the list.',404);
      const target=canonicalDraftTarget(league,matchId,source.leagueId);
      const result=linkRemakeDraft(league,source,matchId,target);
      schedules.audit('Remake Draft Linked',`Linked draft ${sourceId} to played match ${matchId}`);
      return {matchId:result.matchId,sourceMatchId:result.sourceMatchId,picks:result.picks,bans:result.bans};
    }).immediate();
    return res.json(result);
  }));
  router.delete('/held-drafts/:sourceId',endpoint((req,res)=>{
    const sourceId=positive(req.params.sourceId);if(!sourceId)fail('Invalid held draft');
    league.transaction(()=>{
      if(!heldRemakeDraft(league,sourceId))fail('Held draft not found. Refresh the list.',404);
      if(!discardHeldRemakeDraft(league,sourceId))fail('Held draft changed. Refresh the list.',409);
      schedules.audit('Remake Draft Deleted',`Deleted held draft ${sourceId}`);
    }).immediate();
    return res.json({deleted:true});
  }));
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
        FROM ScheduleMessages WHERE ParseStatus='needs_review' AND Deleted=0 AND SeasonId=? ORDER BY LastSeenAtUtc DESC LIMIT 50`).all(sid):[],
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
    const post=league.prepare('SELECT SeasonId,Deleted FROM ScheduleMessages WHERE MessageId=?').get(req.params.messageId);
    if(!post)fail('Scheduling post not found',404);
    if(post.Deleted)fail('This scheduling post was deleted. Refresh the review list.',409);
    if(post.SeasonId&&post.SeasonId!==event.SeasonId)fail('The fixture must belong to the scheduling post’s season');
    const changed=league.prepare("UPDATE ScheduleMessages SET EventId=?,SeasonId=?,ParseStatus='resolved',IssueCode=NULL WHERE MessageId=? AND Deleted=0")
      .run(event.EventId,event.SeasonId,req.params.messageId);
    if(!changed.changes)fail('Scheduling post changed. Refresh the review list.',409);
    schedules.audit('Schedule Resolved',`Linked scheduling post ${req.params.messageId} to fixture ${event.EventId}`);
    return res.json({saved:true});
  }));
  return router;
}
