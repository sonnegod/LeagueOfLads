import {ensureMatchResultsSchema,hasTable} from './matchResultsSchema.js';

const nyDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
export const stageCode=stage=>({regular:'g',playoff:'p',tiebreaker:'t'})[stage]||stage;
export const stageName=stage=>({g:'regular',p:'playoff',t:'tiebreaker'})[stage]||stage;
const pair=(a,b,x,y)=>(a===x&&b===y)||(a===y&&b===x);
export function currentLeagueStage(db,leagueId) {
  const row=hasTable(db,'LeagueStageBoundaries')?db.prepare('SELECT * FROM LeagueStageBoundaries WHERE LeagueId=?').get(leagueId):null;
  return !row?.GroupEndMatchId?'g':!row.TieBreakerEndMatchId?'t':'p';
}
export function stageForLeagueMatch(db,leagueId,matchId) {
  const row=hasTable(db,'LeagueStageBoundaries')?db.prepare('SELECT * FROM LeagueStageBoundaries WHERE LeagueId=?').get(leagueId):null;
  return !row?.GroupEndMatchId||matchId<=row.GroupEndMatchId?'g':!row.TieBreakerEndMatchId||matchId<=row.TieBreakerEndMatchId?'t':'p';
}
export function seriesFormat(db,leagueId,stage,teams,event=null,seriesId=null) {
  ensureMatchResultsSchema(db);
  const settings=db.prepare('SELECT * FROM MatchResultsSettings WHERE Id=1').get();
  if(stageCode(stage)==='g')return {bestOf:event?.BestOf||2,source:event?'fixture':'groups'};
  if(stageCode(stage)==='p') {
    const row=hasTable(db,'PlayoffBracket')?db.prepare('SELECT PlayoffStructure FROM PlayoffBracket WHERE LeagueId=?').get(leagueId):null;
    const bracket=row?JSON.parse(row.PlayoffStructure):null;
    const all=[...(bracket?.upperBracket||[]),...(bracket?.lowerBracket||[]),{matches:bracket?.grandFinals||[]}].flatMap(r=>r.matches||[]);
    const used=seriesId&&all.find(m=>Number(m.seriesId)===seriesId);
    const available=all.filter(m=>!m.seriesId&&pair(m.team1Id,m.team2Id,...teams));
    const match=used||(available.length===1?available[0]:null);
    const final=match&&(bracket?.grandFinals||[]).some(m=>m.id===match.id);
    return {bestOf:event?.BestOf||match?.bestOf||(final?settings.GrandFinalBestOf:settings.PlayoffBestOf),source:event?'fixture':final?'grand_final':'playoffs',bracketMatchId:match?.id==null?null:String(match.id)};
  }
  if(event)return {bestOf:event.BestOf,source:'fixture'};
  if(stageCode(stage)==='t'&&hasTable(db,'LeagueQualificationStages')) {
    const row=db.prepare('SELECT SnapshotJson FROM LeagueQualificationStages WHERE LeagueId=?').get(leagueId);
    const pools=row?(JSON.parse(row.SnapshotJson).pools||[]).filter(pool=>teams.every(id=>pool.teams.some(team=>team.TeamId===id))):[];
    if(pools.length===1)return {bestOf:pools[0].bestOf,source:'tiebreaker_pool'};
  }
  return {bestOf:null,source:'needs_format'};
}
export function associateTrackedSeries(db,tracked,now=new Date()) {
  if(tracked.SeriesId)return {seriesId:tracked.SeriesId,eventId:tracked.EventId};
  if(!tracked.TeamRad||!tracked.TeamDire||tracked.TeamRad===tracked.TeamDire)return {issue:'Team IDs are missing or identical'};
  const start=new Date(tracked.StartedAt||tracked.FirstSeenAt);
  let fixtures=[];
  if(hasTable(db,'ScheduledEvents'))fixtures=db.prepare(`SELECT e.* FROM ScheduledEvents e
    JOIN LeagueSeasons s USING(SeasonId) JOIN SeasonTeams a ON a.TeamSubmissionId=e.Team1Key
    JOIN SeasonTeams b ON b.TeamSubmissionId=e.Team2Key WHERE s.ExternalLeagueId=?
    AND ((a.ExternalTeamId=? AND b.ExternalTeamId=?) OR (a.ExternalTeamId=? AND b.ExternalTeamId=?))
    AND e.Status NOT IN ('cancelled','replaced','forfeit') AND (e.SourceMessageId IS NULL OR e.SourceMessageId NOT LIKE 'local-test:%')`).all(tracked.LeagueId,tracked.TeamRad,tracked.TeamDire,tracked.TeamDire,tracked.TeamRad)
    .filter(e=>Math.abs(Date.parse(e.ScheduledStartUtc)-start.getTime())<=12*3600000);
  if(fixtures.length>1)return {issue:'Multiple scheduled fixtures match these teams and start time'};
  const event=fixtures[0],stage=event?stageCode(event.Stage):tracked.Stage;
  if(event?.Status==='needs_review')return {issue:'The scheduled fixture needs review before automatic pairing'};
  let seriesId=event?.SeriesId;
  if(!seriesId) {
    const candidates=db.prepare(`SELECT s.SeriesId,l.Status FROM SeriesInfo s LEFT JOIN SeriesLifecycle l USING(SeriesId)
      WHERE s.LeagueId=? AND s.Stage=? AND ((s.Team1=? AND s.Team2=?) OR (s.Team1=? AND s.Team2=?))
      AND (s.DateCreated=? OR (l.Status IN ('in_progress','needs_format') AND EXISTS(SELECT 1 FROM TrackedLeagueMatches t
        WHERE t.SeriesId=s.SeriesId AND t.FirstSeenAt>?)))
      AND (l.EventId IS NULL OR l.EventId=?)`).all(tracked.LeagueId,stage,tracked.TeamRad,tracked.TeamDire,tracked.TeamDire,tracked.TeamRad,
        nyDay.format(start),new Date(start.getTime()-12*3600000).toISOString(),event?.EventId||null);
    if(candidates.length>1)return {issue:'Multiple played series match these teams'};
    if(candidates[0]?.Status==='completed')return {issue:'A previous series between these teams is already complete. Assign this game to its scheduled fixture.'};
    seriesId=candidates[0]?.SeriesId;
  }
  if(!seriesId)seriesId=Number(db.prepare('INSERT INTO SeriesInfo(Team1,Team2,LeagueId,Stage,DateCreated) VALUES(?,?,?,?,?)')
    .run(tracked.TeamRad,tracked.TeamDire,tracked.LeagueId,stage,nyDay.format(start)).lastInsertRowid);
  const format=seriesFormat(db,tracked.LeagueId,stage,[tracked.TeamRad,tracked.TeamDire],event,seriesId);
  db.prepare(`INSERT OR IGNORE INTO SeriesLifecycle(SeriesId,EventId,BestOf,FormatSource,BracketMatchId,Status,UpdatedAt) VALUES(?,?,?,?,?,?,?)`)
    .run(seriesId,event?.EventId||null,format.bestOf,format.source,format.bracketMatchId||null,format.bestOf?'in_progress':'needs_format',now.toISOString());
  if(event) {
    db.prepare('UPDATE SeriesLifecycle SET EventId=? WHERE SeriesId=?').run(event.EventId,seriesId);
    // Pairing is not fixture completion and does not change accepted quotes.
    db.prepare('UPDATE ScheduledEvents SET SeriesId=? WHERE EventId=? AND SeriesId IS NULL').run(seriesId,event.EventId);
  }
  db.prepare('UPDATE TrackedLeagueMatches SET SeriesId=?,EventId=?,Stage=? WHERE MatchId=?').run(seriesId,event?.EventId||null,stage,tracked.MatchId);
  return {seriesId,eventId:event?.EventId||null,stage};
}
export function refreshSeriesLifecycle(db,seriesId,now=new Date()) {
  ensureMatchResultsSchema(db);
  const series=db.prepare('SELECT * FROM SeriesInfo WHERE SeriesId=?').get(seriesId);
  if(!series)return null;
  let lifecycle=db.prepare('SELECT * FROM SeriesLifecycle WHERE SeriesId=?').get(seriesId);
  if(!lifecycle) {
    const event=hasTable(db,'ScheduledEvents')?db.prepare("SELECT * FROM ScheduledEvents WHERE SeriesId=? AND Status NOT IN ('replaced','cancelled','forfeit')").get(seriesId):null;
    const format=seriesFormat(db,series.LeagueId,series.Stage,[series.Team1,series.Team2],event,seriesId);
    db.prepare('INSERT INTO SeriesLifecycle(SeriesId,EventId,BestOf,FormatSource,BracketMatchId,UpdatedAt) VALUES(?,?,?,?,?,?)').run(seriesId,event?.EventId||null,format.bestOf,format.source,format.bracketMatchId||null,now.toISOString());
    lifecycle=db.prepare('SELECT * FROM SeriesLifecycle WHERE SeriesId=?').get(seriesId);
  }
  const fixture=hasTable(db,'ScheduledEvents')?db.prepare("SELECT * FROM ScheduledEvents WHERE SeriesId=? AND Status NOT IN ('replaced','cancelled','forfeit')").get(seriesId):null;
  if(fixture&&(fixture.BestOf!==lifecycle.BestOf||fixture.EventId!==lifecycle.EventId)) {
    db.prepare("UPDATE SeriesLifecycle SET EventId=?,BestOf=?,FormatSource='fixture' WHERE SeriesId=?").run(fixture.EventId,fixture.BestOf,seriesId);
    lifecycle={...lifecycle,EventId:fixture.EventId,BestOf:fixture.BestOf,FormatSource:'fixture'};
  }
  let games=db.prepare(`SELECT DISTINCT m.MatchId,m.WinnerId,m.StartTimeUtc FROM SeriesMatch sm JOIN MatchTeam m USING(MatchId)
    WHERE sm.SeriesId=? AND m.Rehost=0 AND m.WinnerId IN (?,?)
      AND (SELECT COUNT(DISTINCT PlayerId) FROM MatchPlayer p WHERE p.MatchId=m.MatchId)=10
    ORDER BY m.StartTimeUtc,m.MatchId`).all(seriesId,series.Team1,series.Team2);
  let missingReplacement=false;
  if(hasTable(db,'OfficialMatchStatus')) {
    const classified=db.prepare(`SELECT c.* FROM OfficialMatchStatus c JOIN LeagueSeasons s USING(SeasonId) WHERE s.ExternalLeagueId=?`).all(series.LeagueId);
    const ids=new Set(games.map(game=>game.MatchId));
    games=games.filter(game=>{const status=classified.find(c=>c.MatchId===game.MatchId);
      if(status?.Status==='superseded'&&!ids.has(status.ReplacementMatchId))missingReplacement=true;
      return !['abandoned','superseded'].includes(status?.Status);});
  }
  const a=games.filter(g=>g.WinnerId===series.Team1).length,b=games.filter(g=>g.WinnerId===series.Team2).length;
  const target=lifecycle.BestOf===2?Infinity:(lifecycle.BestOf+1)/2;
  const pending=db.prepare("SELECT 1 FROM TrackedLeagueMatches WHERE SeriesId=? AND ResultStatus NOT IN ('imported','remake') LIMIT 1").get(seriesId);
  let clinchedEarly=false,aRunning=0,bRunning=0,overlap=false;
  for(let i=0;i<games.length;i++) {
    if(lifecycle.BestOf!==2&&Math.max(aRunning,bRunning)>=target)clinchedEarly=true;
    if(i&&games[i-1].StartTimeUtc) {
      const duration=db.prepare('SELECT Duration FROM MatchTeam WHERE MatchId=?').get(games[i-1].MatchId)?.Duration;
      if(games[i].StartTimeUtc&&games[i-1].StartTimeUtc+duration>games[i].StartTimeUtc)overlap=true;
    }
    if(games[i].WinnerId===series.Team1)aRunning++;else bRunning++;
  }
  const completed=(lifecycle.BestOf===2?games.length===2:Math.max(a,b)===target)&&!missingReplacement;
  const status=!lifecycle.BestOf?'needs_format':games.length>lifecycle.BestOf||clinchedEarly||overlap?'needs_review':completed&&!pending?'completed':'in_progress';
  db.prepare('UPDATE SeriesLifecycle SET Status=?,Team1Wins=?,Team2Wins=?,UpdatedAt=? WHERE SeriesId=? AND (Status!=? OR Team1Wins!=? OR Team2Wins!=?)')
    .run(status,a,b,now.toISOString(),seriesId,status,a,b);
  return {...lifecycle,Status:status,Team1Wins:a,Team2Wins:b,games};
}
export function advanceCompletedPlayoffSeries(db,leagueId,now=new Date()) {
  if(!hasTable(db,'PlayoffBracket'))return;
  const row=db.prepare('SELECT PlayoffStructure FROM PlayoffBracket WHERE LeagueId=?').get(leagueId);if(!row)return;
  const bracket=JSON.parse(row.PlayoffStructure),matches=[...(bracket.upperBracket||[]),...(bracket.lowerBracket||[]),{matches:bracket.grandFinals||[]}].flatMap(round=>round.matches||[]);
  let changed=false;
  for(const match of matches) {
    if(!match.team1Id||!match.team2Id||match.seriesId)continue;
    const series=db.prepare(`SELECT s.* FROM SeriesInfo s JOIN SeriesLifecycle l USING(SeriesId)
      WHERE s.LeagueId=? AND s.Stage='p' AND l.Status='completed' AND l.BracketMatchId=?
      AND ((s.Team1=? AND s.Team2=?) OR (s.Team1=? AND s.Team2=?)) ORDER BY s.SeriesId DESC LIMIT 1`).get(leagueId,String(match.id),match.team1Id,match.team2Id,match.team2Id,match.team1Id);
    if(!series)continue;
    const state=refreshSeriesLifecycle(db,series.SeriesId,now);if(state.Status!=='completed')continue;
    const a=series.Team1===match.team1Id?state.Team1Wins:state.Team2Wins,b=series.Team1===match.team1Id?state.Team2Wins:state.Team1Wins;
    if(a===b)continue;
    Object.assign(match,{seriesId:series.SeriesId,team1Score:a,team2Score:b});changed=true;
    for(const [target,slot,id,name]of [[match.winnerTo,match.winnerToSlot||1,a>b?match.team1Id:match.team2Id,a>b?match.team1Name:match.team2Name],
      [match.loserTo,match.loserToSlot||2,a>b?match.team2Id:match.team1Id,a>b?match.team2Name:match.team1Name]]) {
      const next=matches.find(m=>m.id===target);if(next&&!next.seriesId){next['team'+slot+'Id']=id;next['team'+slot+'Name']=name;}
    }
  }
  if(changed)db.prepare('UPDATE PlayoffBracket SET PlayoffStructure=? WHERE LeagueId=?').run(JSON.stringify(bracket),leagueId);
}
