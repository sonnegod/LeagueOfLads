import {createHash} from 'node:crypto';
import {playoffMatches,playoffResult,playoffFormat,playoffHasResult,playoffSources,resolvePlayoffProgression,generatePlayoffBracket} from '../shared/playoffBracket.js';
import {hasTable,resultsChanged} from './matchResultsSchema.js';
import {refreshSeriesLifecycle,advanceCompletedPlayoffSeries} from './seriesLifecycle.js';
import {markBettingDirty} from '../betting/refreshQueue.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const version=raw=>createHash('sha256').update(raw||'unpublished').digest('hex');
const identity=value=>value==null||value===''?null:Number(value);
const pathFields=['id','bracket','round','matchNum','winnerTo','winnerToSlot','loserTo','loserToSlot'];
const shape=bracket=>playoffMatches(bracket).map(match=>pathFields.map(key=>match[key]??null));
const samePair=(a,b,c,d)=>(a===c&&b===d)||(a===d&&b===c);

export function playoffEntrants(db,leagueId) {
  const aliases=hasTable(db,'LeagueTeamNames');
  const rows=db.prepare(`SELECT p.TeamId,${aliases?'COALESCE(n.DisplayName,t.TeamName)':'t.TeamName'} TeamName,p.Seed,p.Bracket,
    g.GroupId,gn.GroupName FROM PlayoffSeeding p JOIN TeamInfo t USING(TeamId)
    LEFT JOIN LeagueGroups g ON g.LeagueId=p.LeagueId AND g.TeamId=p.TeamId
    LEFT JOIN GroupNames gn ON gn.LeagueId=g.LeagueId AND gn.GroupId=g.GroupId
    ${aliases?'LEFT JOIN LeagueTeamNames n ON n.LeagueId=p.LeagueId AND n.TeamId=p.TeamId':''}
    WHERE p.LeagueId=? AND p.UID=(SELECT MAX(UID) FROM PlayoffSeeding WHERE LeagueId=p.LeagueId AND TeamId=p.TeamId)
    ORDER BY p.Bracket DESC,p.Seed,p.TeamId`).all(leagueId);
  const stage=hasTable(db,'LeagueQualificationStages')?db.prepare('SELECT SnapshotJson,ResultsJson FROM LeagueQualificationStages WHERE LeagueId=?').get(leagueId):null;
  const recorded=stage?JSON.parse(stage.ResultsJson||stage.SnapshotJson).teams||[]:[];
  return rows.map(team=>{const source=recorded.find(item=>item.TeamId===team.TeamId);
    return {...team,GroupRank:source?.GroupRank||null,TiebreakerName:source?.TiebreakerName||null,TiebreakerRank:source?.TiebreakerId?source.Rank||null:null};});
}
export function readPlayoffBracket(db,leagueId) {
  const raw=db.prepare('SELECT PlayoffStructure FROM PlayoffBracket WHERE LeagueId=?').get(leagueId)?.PlayoffStructure;
  const bracket=raw?JSON.parse(raw):null,details={},result=playoffEntrants(db,leagueId),names=new Map(result.map(team=>[team.TeamId,team]));
  const defaults=hasTable(db,'MatchResultsSettings')?db.prepare('SELECT GrandFinalBestOf FROM MatchResultsSettings WHERE Id=1').get():null;
  const finals=bracket?.grandFinals||[];
  for(const match of playoffMatches(bracket)) {
    for(const slot of [1,2]) {const team=names.get(Number(match[`team${slot}Id`]));if(team){match[`team${slot}Name`]=String(team.TeamName);match[`team${slot}Seed`]=team.Seed;}}
    const lifecycle=hasTable(db,'SeriesLifecycle')?db.prepare(`SELECT l.*,s.Team1,s.Team2 FROM SeriesLifecycle l JOIN SeriesInfo s USING(SeriesId)
      WHERE s.LeagueId=? AND s.Stage='p' AND (l.SeriesId=? OR l.BracketMatchId=?) ORDER BY l.SeriesId DESC LIMIT 1`).get(leagueId,match.seriesId||null,String(match.id)):null;
    const fixture=hasTable(db,'ScheduledEvents')?db.prepare(`SELECT e.* FROM ScheduledEvents e JOIN LeagueSeasons s USING(SeasonId)
      JOIN SeasonTeams a ON a.TeamSubmissionId=e.Team1Key JOIN SeasonTeams b ON b.TeamSubmissionId=e.Team2Key
      WHERE s.ExternalLeagueId=? AND e.Stage='playoff' AND e.Status NOT IN ('cancelled','replaced','forfeit','needs_review')
      AND ((? IS NOT NULL AND e.SeriesId=?) OR (e.SeriesId IS NULL AND ((a.ExternalTeamId=? AND b.ExternalTeamId=?) OR (a.ExternalTeamId=? AND b.ExternalTeamId=?))))
      ORDER BY CASE WHEN e.SeriesId IS NOT NULL THEN 0 ELSE 1 END,e.ScheduledStartUtc LIMIT 2`).all(leagueId,lifecycle?.SeriesId||match.seriesId||null,lifecycle?.SeriesId||match.seriesId||null,
        match.team1Id||null,match.team2Id||null,match.team2Id||null,match.team1Id||null):[];
    const event=fixture.find(item=>item.SeriesId&&(item.SeriesId===lifecycle?.SeriesId||item.SeriesId===Number(match.seriesId)))||(fixture.length===1?fixture[0]:null);
    const connected=lifecycle&&samePair(lifecycle.Team1,lifecycle.Team2,Number(match.team1Id),Number(match.team2Id));
    const live=connected&&hasTable(db,'LiveMatchCurrentState')&&db.prepare(`SELECT 1 FROM LiveMatchCurrentState c
      JOIN TrackedLeagueMatches t USING(MatchId) WHERE t.SeriesId=? LIMIT 1`).get(lifecycle.SeriesId);
    details[match.id]={seriesId:connected?lifecycle.SeriesId:match.seriesId||null,
      bestOf:event?.BestOf||lifecycle?.BestOf||playoffFormat({...match,bracket:finals.some(final=>final.id===match.id)?'grand':match.bracket},defaults?.GrandFinalBestOf),
      ...(connected?{team1Score:Number(match.team1Id)===lifecycle.Team1?lifecycle.Team1Wins:lifecycle.Team2Wins,
        team2Score:Number(match.team1Id)===lifecycle.Team1?lifecycle.Team2Wins:lifecycle.Team1Wins,seriesStatus:lifecycle.Status}:{}),
      kickoff:event?.ScheduledStartUtc||null,live:Boolean(live),eventId:event?.EventId||null,
      ...(lifecycle&&!connected?{seriesStatus:'needs_review'}:{})};
  }
  return {leagueId,playoffBracket:bracket,revision:version(raw),matchDetails:details,result,grandFinalDefault:defaults?.GrandFinalBestOf||null};
}
export function savePlayoffBracket(db,leagueId,{bracketData,revision},audit=()=>{}) {
  return db.transaction(()=>{
    const current=readPlayoffBracket(db,leagueId);
    if(revision!==current.revision)fail('The bracket changed while you were editing. Reload to include the latest results.',409);
    if(!bracketData||!Array.isArray(bracketData.upperBracket)||!Array.isArray(bracketData.lowerBracket)||!Array.isArray(bracketData.grandFinals))fail('Provide a valid playoff bracket.');
    const bracket=structuredClone(bracketData),matches=playoffMatches(bracket);
    if(!matches.length||matches.length>256||bracket.grandFinals.length!==1)fail('Provide one grand final and a supported bracket structure.');
    const template=current.playoffBracket||generatePlayoffBracket(current.result);
    if(JSON.stringify(shape(bracket))!==JSON.stringify(shape(template)))fail('Match paths cannot change after the bracket is generated.');
    const sources=playoffSources(bracket),ids=new Set(),entrants=new Map(current.result.map(team=>[team.TeamId,team]));
    const old=new Map(playoffMatches(current.playoffBracket).map(match=>[match.id,match]));
    const started=playoffMatches(current.playoffBracket).some(match=>playoffHasResult(match)||current.matchDetails[match.id]?.seriesId);
    for(const match of matches) {
      match.bestOf=playoffFormat(match);
      if(match.bracket==='grand'?![3,5].includes(match.bestOf):match.bestOf!==3)fail('Playoffs use BO3. Choose BO3 or BO5 for the grand final.');
      for(const slot of [1,2]) {
        const key=`team${slot}Id`,teamId=identity(match[key]);
        if(teamId!==null&&(!Number.isSafeInteger(teamId)||teamId<=0))fail('Select valid teams.');
        match[key]=teamId;
        if(teamId&&entrants.has(teamId)) {match[`team${slot}Name`]=String(entrants.get(teamId).TeamName);match[`team${slot}Seed`]=entrants.get(teamId).Seed;}
        if(sources.has(`${match.id}:${slot}`))continue;
        if(!teamId||ids.has(teamId)||!entrants.has(teamId)||entrants.get(teamId).Bracket!==match.bracket)fail('Assign each qualified team once in its upper or lower starting pool.');
        ids.add(teamId);
        if(started&&teamId!==Number(old.get(match.id)?.[key]))fail('Starting teams cannot change after playoff play has begun.',409);
      }
      match.team1Score=Number(match.team1Score||0);match.team2Score=Number(match.team2Score||0);
      if(!playoffResult(match).valid)fail(`Enter a valid BO${match.bestOf} score.`);
      if((match.team1Score||match.team2Score)&&(!match.team1Id||!match.team2Id))fail('Both teams must be known before entering a score.');
      const previous=old.get(match.id),detail=current.matchDetails[match.id];
      if(detail?.eventId&&detail.bestOf!==match.bestOf)fail('Update the scheduled fixture format first so its rules match the bracket.',409);
      if(identity(match.seriesId)!==identity(previous?.seriesId))fail('Series links are supplied by recorded games.');
      if(detail?.seriesId&&previous) {
        if(['team1Id','team2Id','team1Score','team2Score'].some(key=>Number(match[key]||0)!==Number(previous[key]||0)))
          fail('This match has a recorded series. Correct its games in the match editor instead.',409);
        if(detail.bestOf&&match.bestOf!==detail.bestOf)fail('The format must match the linked fixture or recorded series.',409);
      }
    }
    if(ids.size!==entrants.size)fail('Every qualified team needs a starting slot.');
    const resolved=resolvePlayoffProgression(bracket);
    if(resolved.errors.length)fail(resolved.errors[0],409);
    db.prepare(`INSERT INTO PlayoffBracket(LeagueId,PlayoffStructure) VALUES(?,?) ON CONFLICT(LeagueId) DO UPDATE SET PlayoffStructure=excluded.PlayoffStructure`)
      .run(leagueId,JSON.stringify(resolved.bracket));
    for(const match of playoffMatches(resolved.bracket)) {
      const detail=current.matchDetails[match.id];
      if(detail?.seriesId&&!detail.bestOf&&hasTable(db,'SeriesLifecycle')) {
        db.prepare("UPDATE SeriesLifecycle SET BestOf=?,FormatSource='bracket' WHERE SeriesId=? AND BestOf IS NULL").run(match.bestOf,detail.seriesId);
        refreshSeriesLifecycle(db,detail.seriesId);
      }
    }
    if(hasTable(db,'SeriesLifecycle'))advanceCompletedPlayoffSeries(db,leagueId);
    if(hasTable(db,'BettingRefreshState'))markBettingDirty(db,new Date(),{refreshAnalytics:true});
    if(hasTable(db,'MatchResultsState'))resultsChanged(db);
    audit('Playoff Bracket',`Saved playoff seeding, results and formats for league ${leagueId}`);
    return {success:true,...readPlayoffBracket(db,leagueId)};
  }).immediate();
}
