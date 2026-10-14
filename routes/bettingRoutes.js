import express from 'express';
import { fail } from '../betting/scheduleStore.js';
import { parseScheduleTime } from '../betting/scheduleParser.js';
import { ODDS_SCALE } from '../betting/pricing.js';
import { fixtureGuard,seasonGuard } from '../betting/engine.js';
import { queueBettingRefresh } from '../betting/runtime.js';
import { settleLegacy } from '../betting/legacy.js';
import {historicalPreviewPath,readHistoricalPreview} from '../betting/historicalPreview.js';
import {groupPlayerMarkets,groupTeamMarkets} from '../betting/marketView.js';

const positive=value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
export function bettingActor(req) {
  if(!req.isAuthenticated?.()||!req.user)return null;
  try{const id=BigInt(req.user.id)-76561197960265728n;return id>0n&&id<=BigInt(Number.MAX_SAFE_INTEGER)?id.toString():null;}catch{return null;}
}
const endpoint=fn=>(req,res)=>{try{return fn(req,res);}catch(error){
  if(error.status)return res.status(error.status).json({error:error.message,code:error.code});
  console.error('Betting request failed:',error.code||'internal');return res.status(500).json({error:'Betting request failed'});
}};
export function createBettingRoutes({book,schedules,league,analyticsPath,playerName=id=>`Player ${id}`,refresh=queueBettingRefresh}) {
  const publicRoutes=express.Router();const adminRoutes=express.Router();const db=book.db;
  const readEndpoint=fn=>endpoint((req,res)=>db.transaction(()=>fn(req,res))());
  const seasonId=req=>{
    const id=positive(req.query.seasonId||req.body?.seasonId);if(id)return id;
    return league.prepare("SELECT SeasonId FROM LeagueSeasons ORDER BY CASE WHEN Status!='ended' THEN 0 ELSE 1 END,SeasonId DESC LIMIT 1").get()?.SeasonId||null;
  };
  const register=id=>{const season=league.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId=?').get(id);if(!season)fail('Season not found',404);book.registerSeason(season);return season;};
  const self=req=>{const actor=bettingActor(req);if(!actor)fail('Sign in with Steam to access your betting account',401);return actor;};
  publicRoutes.get('/meta',endpoint((req,res)=>{
    const seasons=league.prepare('SELECT SeasonId,LeagueName,Status FROM LeagueSeasons ORDER BY SeasonId DESC LIMIT 30').all();
    return res.json({seasons:seasons.map(s=>({seasonId:s.SeasonId,name:s.LeagueName,status:s.Status})),defaultSeasonId:seasonId(req),
      stakeCap:1000,startingPoints:10000,movementPercent:10});
  }));
  publicRoutes.get('/markets',readEndpoint((req,res)=>{
    const sid=seasonId(req);if(!sid)return res.json({markets:[],nextBefore:null});
    const limit=Math.min(20,positive(req.query.limit)||20);const before=positive(req.query.before);
    const type=req.query.type||null;if(type&&!['series_winner','exact_score','player_prop','season_player','player_leader','champion','placement'].includes(type))fail('Invalid market type');
    const search=String(req.query.search||'').trim();if(search.length>100)fail('Search is too long');
    const event=req.query.eventId?positive(req.query.eventId):null;if(req.query.eventId&&!event)fail('Invalid fixture');
    const view=req.query.view||'all';if(!['all','series','player','team'].includes(view))fail('Invalid market view');
    const teams=view==='player'||view==='team'?schedules.teams(sid):[];
    if(teams.length>200)fail('This season exceeds the supported team count',409);
    const matching=view==='player'?db.prepare(`SELECT DISTINCT PlayerId FROM BettingMarkets WHERE SeasonId=?
      AND MarketType='season_player' AND Status IN ('open','held','locked') ORDER BY PlayerId DESC LIMIT 1001`).all(sid)
      .map(p=>({playerId:p.PlayerId,name:playerName(p.PlayerId)})):[];
    if(matching.length>1000)fail('This season exceeds the supported player count',409);
    const needle=search.toLocaleLowerCase();
    const selected=matching.filter(p=>!before||p.playerId<before).filter(p=>!needle||`${p.name} ${p.playerId}`.toLocaleLowerCase().includes(needle)
      ||db.prepare(`SELECT 1 FROM BettingMarkets WHERE SeasonId=? AND PlayerId=? AND MarketType='season_player'
        AND Status IN ('open','held','locked') AND Title LIKE ? ESCAPE '\\' LIMIT 1`).get(sid,p.playerId,`%${search.replace(/[\\%_]/g,'\\$&')}%`)
      ||teams.some(t=>t.TeamName.toLocaleLowerCase().includes(needle)&&db.prepare(`SELECT 1 FROM BettingMarkets WHERE SeasonId=? AND PlayerId=? AND TeamKey=? AND MarketType='season_player' LIMIT 1`).get(sid,p.playerId,t.TeamSubmissionId)))
      .slice(0,limit+1);
    const playerIds=selected.slice(0,limit).map(p=>p.playerId);
    let rows;
    if(view==='player')rows=playerIds.length?db.prepare(`SELECT * FROM BettingMarkets WHERE SeasonId=?
      AND MarketType='season_player' AND Status IN ('open','held','locked') AND PlayerId IN (${playerIds.map(()=>'?').join(',')})
      AND MarketId IN (SELECT MAX(MarketId) FROM BettingMarkets WHERE SeasonId=? AND MarketType='season_player'
        AND Status IN ('open','held','locked') GROUP BY PlayerId,StatKey,Scope)
      ORDER BY PlayerId DESC,MarketId`).all(sid,...playerIds,sid):[];
    else if(view==='team')rows=db.prepare(`SELECT * FROM BettingMarkets WHERE SeasonId=? AND EventId IS NULL
      AND MarketType IN ('champion','placement') AND Status IN ('open','held','locked') ORDER BY MarketId DESC LIMIT 201`).all(sid);
    else rows=db.prepare(`SELECT * FROM BettingMarkets WHERE SeasonId=? AND Status IN ('open','held','locked')
      AND (? IS NULL OR MarketType=?) AND (? IS NULL OR EventId=?) AND (? IS NULL OR MarketId<?)
      AND (?!='series' OR EventId IS NOT NULL)
      AND Title LIKE ? ESCAPE '\\' ORDER BY MarketId DESC LIMIT ?`).all(sid,type,type,event,event,before,before,
        view,`%${search.replace(/[\\%_]/g,'\\$&')}%`,limit+1);
    const sourceState={};const now=book.now();
    const changed=league.prepare("SELECT DISTINCT PlayerId FROM SeasonRosterChanges WHERE SeasonId=? AND Kind='permanent'").all(sid).map(r=>r.PlayerId);
    const markets=(view==='player'||view==='team'?rows:rows.slice(0,limit)).map(m=>{
      const guard=fixtureGuard(league,m.EventId,m,now)||seasonGuard(league,analyticsPath,sid,m,now,sourceState);
      const locked=Date.parse(m.CloseAtUtc)<=book.now().getTime();
      const selections=db.prepare('SELECT SelectionId,OutcomeKey,Label,OfferedMicros FROM BettingSelections WHERE MarketId=? AND IsActive=1 ORDER BY SelectionId').all(m.MarketId);
      return {marketId:m.MarketId,seasonId:m.SeasonId,eventId:m.EventId,type:m.MarketType,title:m.Title,stat:m.StatKey,scope:m.Scope,
        playerId:m.PlayerId,teamKey:m.TeamKey,line:m.Line,gameNumber:m.GameNumber,bestOf:m.BestOf,stage:m.Stage,
        closeAt:m.CloseAtUtc,status:locked?'locked':guard?'held':m.Status,quoteVersion:m.QuoteVersion,
        notice:guard||(m.Status==='held'?'Market temporarily unavailable':null),selections:selections.map(s=>({selectionId:s.SelectionId,key:s.OutcomeKey,label:s.Label,odds:s.OfferedMicros/ODDS_SCALE,
          available:!s.OutcomeKey.startsWith('player:')||!changed.includes(Number(s.OutcomeKey.slice(7)))}))};
    });
    let groups=[];
    if(view==='team') {
      const season=league.prepare('SELECT ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(sid);
      const groupNames=league.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='GroupNames'").get()
        ?Object.fromEntries(league.prepare('SELECT GroupId,GroupName FROM GroupNames WHERE LeagueId=?').all(season?.ExternalLeagueId).map(g=>[g.GroupId,g.GroupName])):{};
      groups=groupTeamMarkets(markets,teams,groupNames).map(g=>({...g,teams:g.teams.filter(t=>!needle||`${g.name} ${t.name} ${t.teamKey} ${t.teamId||''}`.toLocaleLowerCase().includes(needle))})).filter(g=>g.teams.length);
    }
    res.set('Cache-Control','no-store');return res.json({markets:view==='team'||view==='player'?[]:markets,
      players:view==='player'?groupPlayerMarkets(markets,selected.slice(0,limit),teams):[],teamGroups:groups,
      nextBefore:view==='team'?null:view==='player'?(selected.length>limit?selected[limit-1].playerId:null):rows.length>limit?rows[limit-1].MarketId:null});
  }));
  publicRoutes.get('/events',endpoint((req,res)=>{const sid=seasonId(req);return res.json({events:sid?schedules.list(sid).map(e=>({
    eventId:e.EventId,team1:e.Team1Name,team2:e.Team2Name,stage:e.Stage,bestOf:e.BestOf,startAt:e.ScheduledStartUtc,status:e.Status})):[]});}));
  publicRoutes.get('/quotes',readEndpoint((req,res)=>{
    const ids=String(req.query.ids||'').split(',').map(positive);if(!ids.length||ids.length>8||ids.some(n=>!n))fail('Invalid selections');
    const quotes=ids.map(id=>{
      const row=db.prepare(`SELECT s.SelectionId,s.OfferedMicros,s.OutcomeKey,s.IsActive,m.MarketType,m.PlayerId,m.TeamKey,m.QuoteVersion,m.Status,m.CloseAtUtc,m.SeasonId,m.EventId,m.EventRevision,m.ForecastId,m.RulesJson,m.UpdatedAtUtc
        FROM BettingSelections s JOIN BettingMarkets m ON m.MarketId=s.MarketId WHERE s.SelectionId=?`).get(id);
      if(!row)fail('Selection is unavailable',404);
      const guard=fixtureGuard(league,row.EventId,row,book.now())||seasonGuard(league,analyticsPath,row.SeasonId,row,book.now());
      return {selectionId:id,odds:row.OfferedMicros/ODDS_SCALE,quoteVersion:row.QuoteVersion,status:!row.IsActive||guard?'held':Date.parse(row.CloseAtUtc)<=book.now().getTime()?'locked':row.Status};
    });return res.json({quotes});
  }));
  publicRoutes.get('/wallet',endpoint((req,res)=>{const actor=self(req);const sid=seasonId(req);if(!sid)fail('No season is available',404);register(sid);return res.json(book.wallet(sid,actor));}));
  publicRoutes.get('/tickets',readEndpoint((req,res)=>{
    const actor=self(req);const sid=seasonId(req);const before=positive(req.query.before);
    const rows=db.prepare('SELECT * FROM BettingTickets WHERE UserId=? AND SeasonId=? AND (? IS NULL OR TicketId<?) ORDER BY TicketId DESC LIMIT 51').all(actor,sid,before,before);
    return res.json({tickets:rows.slice(0,50).map(t=>({ticketId:t.TicketId,seasonId:t.SeasonId,stake:t.StakeCents/100,status:t.Status,payout:t.PayoutCents/100,
      placedAt:t.PlacedAtUtc,legs:db.prepare(`SELECT l.AcceptedMicros,l.Result,l.Divisor,m.Title,s.Label FROM BettingTicketLegs l
        JOIN BettingMarkets m ON m.MarketId=l.MarketId JOIN BettingSelections s ON s.SelectionId=l.SelectionId WHERE l.TicketId=?`).all(t.TicketId)
        .map(l=>({title:l.Title,selection:l.Label,odds:l.AcceptedMicros/ODDS_SCALE,result:l.Result,tieDivisor:l.Divisor}))})),nextBefore:rows.length>50?rows[49].TicketId:null});
  }));
  publicRoutes.post('/tickets',endpoint((req,res)=>{const actor=self(req);const sid=positive(req.body?.seasonId);if(!sid)fail('Select a season');register(sid);
    const ticket=book.accept(actor,{...req.body,seasonId:sid});return res.status(ticket.reused?200:201).json(ticket);}));
  publicRoutes.get('/leaderboard',readEndpoint((req,res)=>{
    const sid=seasonId(req);const rows=db.prepare(`SELECT w.UserId,w.BalanceCents,
      COALESCE(SUM(CASE WHEN l.Kind IN ('settlement','correction','stake') THEN l.AmountCents ELSE 0 END),0) AS NetCents
      FROM BettingWallets w LEFT JOIN BettingLedger l ON l.SeasonId=w.SeasonId AND l.UserId=w.UserId WHERE w.SeasonId=?
      GROUP BY w.UserId ORDER BY NetCents DESC,w.UserId LIMIT 20`).all(sid);
    return res.json({players:rows.map(r=>({userId:r.UserId,name:playerName(r.UserId),balance:r.BalanceCents/100,net:r.NetCents/100}))});
  }));
  publicRoutes.get('/legacy',readEndpoint((req,res)=>{
    const actor=self(req);const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ParlayTickets'").get();
    const wallet=db.prepare('SELECT BalanceCents FROM BettingWallets WHERE SeasonId=0 AND UserId=?').get(actor);
    const tickets=exists?db.prepare('SELECT id,status,total_amount,total_odds,total_payout,created_at FROM ParlayTickets WHERE user_id=? ORDER BY id DESC LIMIT 50').all(actor):[];
    const migrated=db.prepare("SELECT RequestKey,Status,PayoutCents FROM BettingTickets WHERE SeasonId=0 AND UserId=?").all(actor);
    return res.json({balance:wallet?.BalanceCents/100||0,tickets:tickets.map(t=>{const resolved=migrated.find(m=>m.RequestKey===`legacy_ticket_${t.id}`);
      return {ticketId:t.id,status:resolved?.Status||t.status,stake:t.total_amount,odds:t.total_odds,payout:resolved?resolved.PayoutCents/100:t.total_payout,placedAt:t.created_at};})});
  }));

  adminRoutes.get('/preview',endpoint((req,res)=>{
    const leagueId=positive(req.query.leagueId);if(!leagueId)fail('Select a valid historical league');
    if(req.query.scope&&!['preseason','series'].includes(req.query.scope)||req.query.preseasonGroup&&!['all','player','team'].includes(req.query.preseasonGroup)||String(req.query.search||'').length>100)fail('Invalid preview filter');
    if(req.query.groupPlayers!==undefined&&req.query.groupPlayers!=='1')fail('Invalid player grouping');
    if(req.query.groupTeams!==undefined&&req.query.groupTeams!=='1')fail('Invalid team grouping');
    const eventId=req.query.eventId?positive(req.query.eventId):null;const before=req.query.before?positive(req.query.before):null;
    if(req.query.eventId&&!eventId||req.query.before&&!before)fail('Invalid preview filter');
    const groupNames=league.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='GroupNames'").get()
      ?Object.fromEntries(league.prepare('SELECT GroupId,GroupName FROM GroupNames WHERE LeagueId=?').all(leagueId).map(g=>[g.GroupId,g.GroupName])):{};
    const payload=readHistoricalPreview(historicalPreviewPath(db.name,leagueId),{scope:req.query.scope||'preseason',preseasonGroup:req.query.preseasonGroup||'all',groupPlayers:req.query.groupPlayers==='1',groupTeams:req.query.groupTeams==='1',groupNames,eventId,before,search:String(req.query.search||'').trim()});
    if(!payload)fail('Run the historical betting preview command for this league first',404);
    res.set('Cache-Control','no-store');return res.json(payload);
  }));

  adminRoutes.get('/status',endpoint((req,res)=>{
    const sid=seasonId(req);const season=sid?register(sid):null;const setup=sid?schedules.setup(sid):null;
    const jobs=db.prepare('SELECT JobId,StartedAtUtc,CompletedAtUtc,Status,MarketsOpened,MarketsSettled,IssueCode FROM BettingJobs ORDER BY JobId DESC LIMIT 5').all();
    const refreshState=league.prepare('SELECT * FROM BettingRefreshState WHERE Id=1').get();
    const messages=league.prepare(`SELECT MessageId,ChannelId,AuthoredAtUtc,EditedAtUtc,ParseStatus,IssueCode,EventId,Deleted FROM ScheduleMessages
      WHERE ParseStatus='needs_review' AND SeasonId=? ORDER BY LastSeenAtUtc DESC LIMIT 50`).all(sid);
    return res.json({season:season?{seasonId:sid,name:season.LeagueName,status:season.Status,leagueId:season.ExternalLeagueId}:null,
      seasons:league.prepare('SELECT SeasonId,LeagueName,Status FROM LeagueSeasons ORDER BY SeasonId DESC LIMIT 30').all().map(s=>({seasonId:s.SeasonId,name:s.LeagueName,status:s.Status})),
      setup:setup?{revision:setup.Revision,gamesPerTeam:setup.RegularGamesPerTeam,gamesByTeam:JSON.parse(setup.SetupJson).gamesByTeam||null,finalizedAt:setup.FinalizedAtUtc,completion:setup.Completion,regularSeasonComplete:!!setup.RegularSeasonComplete}:null,
      teams:sid?schedules.teams(sid).map(t=>({teamKey:t.TeamSubmissionId,name:t.TeamName,teamId:t.ExternalTeamId})):[],
      refresh:{pending:refreshState.RequestedRevision>refreshState.CompletedRevision,lastAttemptAt:refreshState.LastAttemptAtUtc,
        lastCompletedAt:refreshState.LastCompletedAtUtc,failures:refreshState.ConsecutiveFailures,
        error:['refresh_failed','refresh_retry_exhausted'].includes(refreshState.LastErrorCode)?refreshState.LastErrorCode:null,nextRetryAt:refreshState.NextRetryAtUtc},
      events:sid?schedules.list(sid):[],jobs,messages,legacyIssues:db.prepare('SELECT LegacyTicketId,IssueCode FROM BettingLegacyImportIssues ORDER BY LegacyTicketId LIMIT 50').all(),
      aliases:sid?league.prepare('SELECT RoleId,TeamSubmissionId FROM TeamDiscordAliases WHERE SeasonId=?').all(sid):[]});
  }));
  adminRoutes.post('/refresh',endpoint((req,res)=>{refresh();return res.status(202).json({queued:true});}));
  adminRoutes.post('/seasons/:seasonId/setup',endpoint((req,res)=>{
    const sid=positive(req.params.seasonId);if(!sid)fail('Invalid season');schedules.finalizeSetup(sid,req.body?.gamesPerTeam,bettingActor(req));return res.json({saved:true});
  }));
  adminRoutes.put('/seasons/:seasonId/completion',endpoint((req,res)=>{const sid=positive(req.params.seasonId);if(!sid)fail('Invalid season');
    schedules.completion(sid,req.body||{},bettingActor(req));return res.json({saved:true});}));
  adminRoutes.post('/seasons/:seasonId/roster-changes',endpoint((req,res)=>{
    const sid=positive(req.params.seasonId);if(!sid)fail('Invalid season');let body={...req.body};
    if(body.localTime){const parsed=parseScheduleTime(body.localTime,new Date().toISOString(),60,{allowPast:true});if(parsed.error)fail('Effective time needs correction');body.effectiveAtUtc=parsed.scheduledStartUtc;}
    return res.json(schedules.changeRoster(sid,body,bettingActor(req)));
  }));
  adminRoutes.post('/seasons/:seasonId/matches/classify',endpoint((req,res)=>{const sid=positive(req.params.seasonId);if(!sid)fail('Invalid season');
    return res.json(schedules.classifyMatch(sid,req.body||{},bettingActor(req)));}));
  adminRoutes.post('/seasons/:seasonId/events',endpoint((req,res)=>{
    const sid=positive(req.params.seasonId);if(!sid)fail('Invalid season');let parsed={};
    if(req.body?.localTime) {parsed=parseScheduleTime(req.body.localTime,new Date().toISOString(),60,{allowPast:!!req.body.eventId});if(parsed.error)fail(`Schedule needs correction: ${parsed.error}`);}
    const event=schedules.save(sid,{...req.body,...parsed},bettingActor(req));return res.status(201).json({event});
  }));
  adminRoutes.put('/seasons/:seasonId/aliases',endpoint((req,res)=>{
    const sid=positive(req.params.seasonId);const team=positive(req.body?.teamKey);const role=String(req.body?.roleId||'');
    if(!sid||!/^\d{15,22}$/.test(role)||!schedules.teams(sid).some(t=>t.TeamSubmissionId===team))fail('Select a season team and valid Discord role ID');
    league.prepare(`INSERT INTO TeamDiscordAliases VALUES (?,?,?) ON CONFLICT(SeasonId,RoleId) DO UPDATE SET TeamSubmissionId=excluded.TeamSubmissionId`).run(sid,role,team);
    schedules.audit('Schedule Role Linked',`Linked Discord role ${role} to team ${team}`);return res.json({saved:true});
  }));
  adminRoutes.post('/messages/:messageId/resolve',endpoint((req,res)=>{
    const event=schedules.get(positive(req.body?.eventId));if(!event)fail('Select a fixture');
    const post=league.prepare('SELECT SeasonId FROM ScheduleMessages WHERE MessageId=?').get(req.params.messageId);
    if(post?.SeasonId&&post.SeasonId!==event.SeasonId)fail('The fixture must belong to the scheduling post’s season');
    const changed=league.prepare("UPDATE ScheduleMessages SET EventId=?,SeasonId=?,ParseStatus='resolved',IssueCode=NULL WHERE MessageId=?").run(event.EventId,event.SeasonId,req.params.messageId);
    if(!changed.changes)fail('Scheduling post not found',404);
    schedules.audit('Schedule Resolved',`Linked scheduling post ${req.params.messageId} to fixture ${event.EventId}`);return res.json({saved:true});
  }));
  adminRoutes.get('/legacy',endpoint((req,res)=>{
    const rows=db.prepare("SELECT MarketId,Title,RulesJson,Status FROM BettingMarkets WHERE SeasonId=0 AND MarketType='legacy' ORDER BY MarketId LIMIT 200").all();
    return res.json({markets:rows.map(m=>{const rules=JSON.parse(m.RulesJson);const selection=db.prepare('SELECT Label FROM BettingSelections WHERE MarketId=?').get(m.MarketId);
      const options=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='BettingOptions'").get()
        ?db.prepare('SELECT id AS optionId,name AS label FROM BettingOptions WHERE market_id=? ORDER BY id').all(rules.legacyMarketId):[];
      return {marketId:m.MarketId,title:m.Title,status:m.Status,legacyMarketId:rules.legacyMarketId,optionId:rules.legacyOptionId,label:selection.Label,options};})});
  }));
  adminRoutes.post('/legacy/settle',endpoint((req,res)=>{
    const market=positive(req.body?.marketId);const ids=req.body?.winningOptionIds;const seriesId=positive(req.body?.seriesId);const voidAll=req.body?.voidAll===true;
    if(!market||!Array.isArray(ids)||ids.some(id=>!positive(id))||(!voidAll&&!seriesId))fail('Select a legacy market, actual series, and winning options');
    const valid=db.prepare("SELECT RulesJson FROM BettingMarkets WHERE SeasonId=0 AND MarketType='legacy'").all().map(m=>JSON.parse(m.RulesJson))
      .filter(r=>r.legacyMarketId===market);
    const original=db.prepare('SELECT id FROM BettingOptions WHERE market_id=?').all(market).map(r=>r.id);
    if(ids.some(id=>!original.includes(id)))fail('Winning options must belong to this legacy market');
    if(!voidAll&&!league.prepare('SELECT 1 FROM SeriesInfo WHERE SeriesId=?').get(seriesId))fail('Actual series not found');
    const result=settleLegacy(book,market,ids,{voidAll,seriesId,actorId:bettingActor(req)});
    schedules.audit('Legacy Betting Resolved',`Resolved legacy market ${market}${voidAll?' with a refund':` using series ${seriesId}`}`);
    return res.json(result);
  }));
  return {publicRoutes,adminRoutes};
}
