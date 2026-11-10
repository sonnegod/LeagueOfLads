import {ingestWarehouseMatch} from './warehouseIngestion.js';
import {archiveRemakeDraft,linkMatchingRemakeDraft} from './remakeDrafts.js';
import {recordMatchStart} from '../analytics/sourceMetadata.js';
import {rebuildLeagueGroupStandings} from './groupStandings.js';
import {associateTrackedSeries,refreshSeriesLifecycle,advanceCompletedPlayoffSeries} from './seriesLifecycle.js';
import {hasTable,resultsChanged} from './matchResultsSchema.js';
import {markBettingDirty} from '../betting/refreshQueue.js';
import {ingestDraftTelemetry} from './draftTelemetry.js';

const positive=n=>Number.isSafeInteger(n)&&n>0;
const reject=message=>{throw Object.assign(new Error(message),{review:true});};
export function importLeagueMatch(db,data,tracked,now=new Date()) {
  if(data?.match_id!==tracked.MatchId||data.leagueid!==tracked.LeagueId)reject('Match or league identity differs from the queued game');
  if(typeof data.radiant_win!=='boolean'||!positive(data.start_time)||!Number.isSafeInteger(data.duration)||data.duration<0)throw new Error('Completed match result is not available yet');
  if(!positive(data.radiant_team_id)||!positive(data.dire_team_id)||data.radiant_team_id===data.dire_team_id)reject('Played match needs two distinct team IDs');
  const existing=db.prepare('SELECT * FROM MatchTeam WHERE MatchId=?').get(data.match_id);
  if(!existing&&tracked.ResultStatus==='imported'&&!tracked.ManualRequested)reject('This imported match was removed. Only an explicit admin reimport can restore it.');
  if(existing&&(existing.TeamRad!==data.radiant_team_id||existing.TeamDire!==data.dire_team_id))reject('Saved team assignment differs from OpenDota; preserve the admin correction');
  if(!existing&&((tracked.TeamRad&&tracked.TeamRad!==data.radiant_team_id)||(tracked.TeamDire&&tracked.TeamDire!==data.dire_team_id)))reject('Result team IDs differ from the observed live game');
  if(data.duration<300&&data.radiant_score===0&&data.dire_score===0) {
    return db.transaction(()=>{
      const needsDraft=data.game_mode===2&&!data.picks_bans?.length;
      if(data.game_mode===2&&data.picks_bans?.length)archiveRemakeDraft(db,data,now);
      // Never delete an already curated/imported game just because a later response is incomplete.
      if(existing&&db.prepare('SELECT 1 FROM MatchPlayer WHERE MatchId=?').get(data.match_id))reject('Remake response conflicts with an existing played game');
      if(existing){db.prepare('DELETE FROM SeriesMatch WHERE MatchId=?').run(data.match_id);db.prepare('DELETE FROM MatchLeague WHERE MatchId=?').run(data.match_id);db.prepare('DELETE FROM MatchTeam WHERE MatchId=?').run(data.match_id);}
      db.prepare("UPDATE TrackedLeagueMatches SET ResultStatus='remake',EnrichmentStatus=?,NextAttemptAt=?,LastError=? WHERE MatchId=?")
        .run(needsDraft?(data.version==null?'pending':'needs_review'):'not_applicable',needsDraft?new Date(now.getTime()+Math.min(3600000,60000*2**Math.min(tracked.AttemptCount||0,6))).toISOString():null,
          needsDraft?'Remake draft data has not arrived yet':null,data.match_id);
      if(tracked.SeriesId)refreshSeriesLifecycle(db,tracked.SeriesId,now);
      resultsChanged(db);return {remake:true,needsDraft:needsDraft&&data.version==null};
    }).immediate();
  }
  if(!positive(data.duration))throw new Error('Completed match duration is not available yet');
  const fields={Kills:'kills',Deaths:'deaths',Assists:'assists',Networth:'net_worth',Lasthits:'last_hits',HeroDamage:'hero_damage',GPM:'gold_per_min',XPM:'xp_per_min',Healing:'hero_healing',TowerDamage:'tower_damage'};
  if(data.players?.length!==10||new Set(data.players.map(p=>p.account_id)).size!==10
    ||data.players.some(p=>!positive(p.account_id)||p.account_id>=4294967295||!positive(p.hero_id)
      ||![0,1,2,3,4,128,129,130,131,132].includes(p.player_slot)
      ||['kills','deaths','assists','last_hits','gold_per_min','xp_per_min'].some(k=>!Number.isFinite(p[k])||p[k]<0))
    ||new Set(data.players.map(p=>p.player_slot)).size!==10)throw new Error('Completed scoreboard is still incomplete');
  const result=db.transaction(()=>{
    const latest=db.prepare('SELECT TeamRad,TeamDire FROM MatchTeam WHERE MatchId=?').get(data.match_id);
    if(latest&&(latest.TeamRad!==data.radiant_team_id||latest.TeamDire!==data.dire_team_id))reject('Match changed during import; preserve the admin correction');
    if(tracked.LeaseOwner) {
      const reservation=db.prepare('SELECT LeaseOwner,ResultStatus FROM TrackedLeagueMatches WHERE MatchId=?').get(data.match_id);
      if(reservation?.LeaseOwner!==tracked.LeaseOwner||reservation.ResultStatus==='live')throw new Error('Match returned to live or its import lease changed');
    }
    const startedAt=new Date(data.start_time*1000).toISOString();
    const recorded=db.prepare('SELECT LeagueId FROM MatchLeague WHERE MatchId=?').get(data.match_id);
    if(recorded&&recorded.LeagueId!==tracked.LeagueId)reject('Match already belongs to another league');
    db.prepare(`INSERT OR IGNORE INTO MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,SeriesId,Rehost,Duration)
      VALUES(?,?,?,0,?,0,?)`).run(data.match_id,data.radiant_team_id,data.dire_team_id,data.series_id||0,data.duration);
    db.prepare('INSERT OR IGNORE INTO MatchLeague(MatchId,LeagueId,DatePlayed) VALUES(?,?,?)').run(data.match_id,tracked.LeagueId,startedAt);
    const recordedStart=hasTable(db,'MatchSourceDetails')?db.prepare('SELECT StartedAtUtc FROM MatchSourceDetails WHERE MatchId=?').get(data.match_id)?.StartedAtUtc:null;
    if(recordedStart!==startedAt)recordMatchStart(db,data.match_id,data.start_time,'opendota_details',now.toISOString());
    const winner=data.radiant_win?data.radiant_team_id:data.dire_team_id;
    const wasImported=db.prepare('SELECT COUNT(DISTINCT PlayerId) n FROM MatchPlayer WHERE MatchId=?').get(data.match_id).n===10;
    if(!wasImported||!latest)db.prepare('UPDATE MatchTeam SET WinnerId=?,Duration=? WHERE MatchId=?').run(winner,data.duration,data.match_id);
    if(!wasImported) {
      const columns=['MatchId','PlayerId','HeroId',...Object.keys(fields),'Winner','PlayerSlot'];
      const insert=db.prepare(`INSERT INTO MatchPlayer(${columns.join(',')}) SELECT ${columns.map(()=>'?').join(',')} WHERE NOT EXISTS(SELECT 1 FROM MatchPlayer WHERE MatchId=? AND PlayerId=?)`);
      for(const p of data.players) {
        db.prepare('INSERT OR IGNORE INTO PlayerInfo(PlayerId,PlayerName) VALUES(?,?)').run(p.account_id,p.personaname||`Player ${p.account_id}`);
        insert.run(data.match_id,p.account_id,p.hero_id,...Object.values(fields).map(k=>Number.isFinite(p[k])?p[k]:null),Number((p.player_slot<128)===data.radiant_win),p.player_slot,data.match_id,p.account_id);
        db.prepare(`INSERT INTO MatchTeamPlayer(MatchId,PlayerId,TeamId) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM MatchTeamPlayer WHERE MatchId=? AND PlayerId=?)`)
          .run(data.match_id,p.account_id,p.player_slot<128?data.radiant_team_id:data.dire_team_id,data.match_id,p.account_id);
      }
    }
    const observed=hasTable(db,'LiveMatchSnapshots')?db.prepare('SELECT RadiantTeamName,DireTeamName FROM LiveMatchSnapshots WHERE MatchId=? ORDER BY SnapshotId DESC LIMIT 1').get(data.match_id):null;
    for(const [id,name]of [[data.radiant_team_id,data.radiant_name||data.radiant_team?.name||observed?.RadiantTeamName],[data.dire_team_id,data.dire_name||data.dire_team?.name||observed?.DireTeamName]])
      db.prepare('INSERT OR IGNORE INTO TeamInfo(TeamId,TeamName) VALUES(?,?)').run(id,name||`Team ${id}`);
    if(Array.isArray(data.picks_bans)&&!db.prepare('SELECT 1 FROM MatchDraftSources WHERE MatchId=?').get(data.match_id))for(const p of data.picks_bans) {
      if(typeof p.is_pick!=='boolean'||!positive(p.hero_id)||!Number.isSafeInteger(p.order)||![0,1].includes(p.team))continue;
      db.prepare('INSERT INTO PickInfo(MatchId,IsPick,Hero_Id,OrderNum,Team) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM PickInfo WHERE MatchId=? AND OrderNum=?)')
        .run(data.match_id,Number(p.is_pick),p.hero_id,p.order,p.team,data.match_id,p.order);
    }
    const curated=db.prepare('SELECT SeriesId FROM SeriesMatch WHERE MatchId=? ORDER BY SeriesId LIMIT 1').get(data.match_id);
    const association=associateTrackedSeries(db,{...tracked,SeriesId:curated?.SeriesId||tracked.SeriesId,TeamRad:data.radiant_team_id,TeamDire:data.dire_team_id,StartedAt:startedAt},now);
    if(curated)db.prepare('UPDATE TrackedLeagueMatches SET SeriesId=? WHERE MatchId=?').run(curated.SeriesId,data.match_id);
    if(association.seriesId&&!db.prepare('SELECT 1 FROM SeriesMatch WHERE MatchId=? AND SeriesId=?').get(data.match_id,association.seriesId))
      db.prepare('INSERT INTO SeriesMatch(SeriesId,MatchId,DateCreated) VALUES(?,?,?)').run(association.seriesId,data.match_id,db.prepare('SELECT DateCreated FROM SeriesInfo WHERE SeriesId=?').get(association.seriesId).DateCreated);
    db.prepare(`UPDATE TrackedLeagueMatches SET ResultStatus='imported',StartedAt=?,ImportedAt=COALESCE(ImportedAt,?),LastError=?,
      TeamRad=?,TeamDire=? WHERE MatchId=?`).run(startedAt,now.toISOString(),association.issue||null,data.radiant_team_id,data.dire_team_id,data.match_id);
    linkMatchingRemakeDraft(db,data.match_id,data);
    if(hasTable(db,'GroupNames'))rebuildLeagueGroupStandings(db,tracked.LeagueId);
    if(association.seriesId){refreshSeriesLifecycle(db,association.seriesId,now);advanceCompletedPlayoffSeries(db,tracked.LeagueId,now);}
    if(!wasImported||!latest||!tracked.SeriesId&&association.seriesId) {
      if(hasTable(db,'BettingRefreshState'))markBettingDirty(db,now,{refreshAnalytics:true});
      resultsChanged(db);
    }
    return {imported:true,seriesId:association.seriesId,review:association.issue};
  }).immediate();
  return result;
}
export function enrichLeagueMatch(db,data,tracked,now=new Date()) {
  const previous=hasTable(db,'MatchIngestionState')?db.prepare('SELECT SourceHash FROM MatchIngestionState WHERE MatchId=?').get(tracked.MatchId)?.SourceHash:null;
  let result;
  try{result=ingestWarehouseMatch(db,data,{expectedMatchId:tracked.MatchId,now:now.toISOString(),skipUnchanged:true});}
  catch(error){if(hasTable(db,'BettingRefreshState'))try{markBettingDirty(db,now,{refreshAnalytics:true});}catch{/* Preserve the import error. */}throw error;}
  if(!result.unchanged)try{ingestDraftTelemetry(db,data);}catch{/* Draft analysis can remain partial without holding verified results. */}
  const current=db.prepare('SELECT SourceHash FROM MatchIngestionState WHERE MatchId=?').get(tracked.MatchId)?.SourceHash;
  if(previous!==current&&hasTable(db,'BettingRefreshState'))markBettingDirty(db,now,{refreshAnalytics:true});
  db.prepare('UPDATE TrackedLeagueMatches SET EnrichmentStatus=? WHERE MatchId=?').run(result.status,tracked.MatchId);
  return result;
}
