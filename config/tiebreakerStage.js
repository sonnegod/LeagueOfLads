import {createHash} from 'node:crypto';
import {classifyStandings,normalizeLeagueRules,normalizeQualificationPlan,qualificationPools} from './leagueRules.js';

const fail=message=>{throw Object.assign(Error(message),{status:409});};
const destination=(pool,index)=>index<pool.upper?'upper':index<pool.upper+pool.lower?'lower':'eliminated';
const signature=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function ensureTiebreakerStageSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS LeagueQualificationStages (
    LeagueId INTEGER PRIMARY KEY, SnapshotJson TEXT NOT NULL, ResultsJson TEXT,
    StartedAtUtc TEXT NOT NULL, FinalizedAtUtc TEXT
  )`);
}

export function createQualificationSnapshot(groups,rawRules) {
  const rules=normalizeLeagueRules(rawRules);
  if(!rules.QualificationPlan)return null;
  normalizeQualificationPlan(rules.QualificationPlan,groups.map(group=>group.teams.length));
  const seen=new Set();
  const teams=groups.flatMap((group,index)=>classifyStandings(group.teams,rules,index+1).map(team=>{
    if(!Number.isSafeInteger(team.TeamId)||team.TeamId<=0||seen.has(team.TeamId))fail('Every tiebreaker and playoff team needs a unique Team ID.');
    seen.add(team.TeamId);
    return {TeamId:team.TeamId,TeamName:team.TeamName,GroupId:group.GroupId,GroupName:group.GroupName,
      GroupRank:team.Rank,Qualification:team.Qualification,
      ...(team.TiebreakerId?{TiebreakerId:team.TiebreakerId,TiebreakerName:team.TiebreakerName}:{})};
  }));
  return {rules,teams,pools:qualificationPools(teams,rules)};
}

export function readQualificationStage(db,leagueId) {
  const row=db.prepare('SELECT * FROM LeagueQualificationStages WHERE LeagueId=?').get(leagueId);
  return row?{snapshot:JSON.parse(row.SnapshotJson),results:row.ResultsJson?JSON.parse(row.ResultsJson):null,
    startedAt:row.StartedAtUtc,finalizedAt:row.FinalizedAtUtc}:null;
}

export function readQualificationMatches(db,leagueId,boundary) {
  return db.prepare(`SELECT DISTINCT m.MatchId,m.TeamRad AS TeamA,m.TeamDire AS TeamB,m.WinnerId
    FROM MatchTeam m JOIN MatchLeague l ON l.MatchId=m.MatchId WHERE l.LeagueId=? AND m.MatchId>?
    AND (? IS NULL OR m.MatchId<=?) ORDER BY m.MatchId`)
    .all(leagueId,boundary.GroupEndMatchId,boundary.TieBreakerEndMatchId,boundary.TieBreakerEndMatchId);
}

export function startQualificationStage(db,leagueId,snapshot,now=new Date()) {
  if(readQualificationStage(db,leagueId))fail('The tiebreaker entrants have already been saved.');
  db.prepare('INSERT INTO LeagueQualificationStages(LeagueId,SnapshotJson,StartedAtUtc) VALUES(?,?,?)')
    .run(leagueId,JSON.stringify(snapshot),now.toISOString());
}

// One round-robin encounter per pair; series wins then Neustadtl decide pool order.
// Remaining equal scores need an explicit admin order if a qualification cutoff splits them.
export function rankQualificationPools(snapshot,matches,orders={}) {
  if(!orders||Array.isArray(orders)||typeof orders!=='object')fail('Provide valid tiebreaker finishing orders.');
  for(const id of Object.keys(orders))if(!snapshot.pools.some(pool=>pool.id===id))fail('Unknown tiebreaker pool in the finishing order.');
  return snapshot.pools.map(pool=>{
    let teams=pool.teams.map(team=>({...team,SeriesWins:0,SeriesLosses:0,GameWins:0,GameLosses:0,Neustadtl:0}));
    const ids=new Set(teams.map(team=>team.TeamId)),games=matches.filter(match=>ids.has(match.TeamA)&&ids.has(match.TeamB));
    const victories=[],problems=[],headToHead=[];let completedPairs=0;
    for(let a=0;a<teams.length;a++)for(let b=a+1;b<teams.length;b++) {
      const first=teams[a],second=teams[b],pair=games.filter(game=>game.TeamA!==game.TeamB&&
        (game.TeamA===first.TeamId&&game.TeamB===second.TeamId||game.TeamB===first.TeamId&&game.TeamA===second.TeamId));
      const firstWins=pair.filter(game=>game.WinnerId===first.TeamId).length,secondWins=pair.filter(game=>game.WinnerId===second.TeamId).length;
      headToHead.push({TeamA:first.TeamId,TeamB:second.TeamId,WinsA:firstWins,WinsB:secondWins});
      first.GameWins+=firstWins;first.GameLosses+=secondWins;second.GameWins+=secondWins;second.GameLosses+=firstWins;
      const target=(pool.bestOf+1)/2;
      const finished=pair.length<=pool.bestOf&&pair.length===firstWins+secondWins&&
        (firstWins===target&&secondWins<target||secondWins===target&&firstWins<target);
      if(!finished) {
        problems.push(`${first.TeamName} vs ${second.TeamName}: ${pair.length>pool.bestOf?'too many recorded games; check the results':`BO${pool.bestOf} result is incomplete`}.`);
        continue;
      }
      completedPairs++;
      const winner=firstWins>secondWins?first:second,loser=winner===first?second:first;
      winner.SeriesWins++;loser.SeriesLosses++;victories.push([winner,loser]);
    }
    for(const [winner,loser] of victories)winner.Neustadtl+=loser.SeriesWins;
    teams.sort((a,b)=>b.SeriesWins-a.SeriesWins||b.Neustadtl-a.Neustadtl||a.TeamId-b.TeamId);
    const tieKey=team=>`${team.SeriesWins}:${team.Neustadtl}`;
    const tieGroups=[];
    for(let index=0;index<teams.length;) {
      let end=index+1;while(end<teams.length&&tieKey(teams[end])===tieKey(teams[index]))end++;
      if(end-index>1)tieGroups.push({teamIds:teams.slice(index,end).map(team=>team.TeamId),
        crossesCutoff:destination(pool,index)!==destination(pool,end-1)});
      index=end;
    }
    const needsOrder=tieGroups.some(group=>group.crossesCutoff),order=Object.hasOwn(orders,pool.id)?orders[pool.id]:undefined;
    if(order!==undefined) {
      if(!Array.isArray(order)||order.length!==teams.length||new Set(order).size!==teams.length||order.some(id=>!ids.has(id)))
        fail(`${pool.name}: the finishing order must contain every entrant exactly once.`);
      const byId=new Map(teams.map(team=>[team.TeamId,team]));
      if(order.some((id,index)=>tieKey(byId.get(id))!==tieKey(teams[index])))
        fail(`${pool.name}: only teams tied on series wins and Neustadtl can change order.`);
      teams=order.map(id=>byId.get(id));
    }
    return {...pool,teams:teams.map((team,index)=>({...team,Rank:index+1,Qualification:destination(pool,index)})),
      completedPairs,totalPairs:teams.length*(teams.length-1)/2,problems,tieGroups,needsOrder,
      orderConfirmed:order!==undefined,complete:!problems.length&&(!needsOrder||order!==undefined),
      headToHead,MatchIds:games.map(game=>game.MatchId)};
  });
}

export function qualificationPreview(snapshot,matches,orders={}) {
  const pools=rankQualificationPools(snapshot,matches,orders);
  return {enabled:true,pools,ready:pools.every(pool=>pool.complete),revision:signature({snapshot,matches})};
}

// Called inside the same transaction that closes the tiebreaker stage.
export function finalizeQualificationStage(db,leagueId,snapshot,matches,{revision,orders={}}={},now=new Date()) {
  const previous=readQualificationStage(db,leagueId);
  if(previous?.results)fail('Tiebreaker results have already been finalized.');
  const preview=qualificationPreview(snapshot,matches,orders);
  if(revision!==preview.revision)fail('Tiebreaker results changed. Reload the results before starting playoffs.');
  const pending=preview.pools.find(pool=>!pool.complete);
  if(pending)fail(`${pending.name}: ${pending.problems[0]||'confirm the order of tied qualifiers before starting playoffs.'}`);
  const teams=[...snapshot.teams.filter(team=>team.Qualification!=='tiebreaker'),...preview.pools.flatMap(pool=>pool.teams)];
  const results={teams,pools:preview.pools,MatchIds:matches.map(match=>match.MatchId)};
  if(!previous)startQualificationStage(db,leagueId,snapshot,now);
  db.prepare('UPDATE LeagueQualificationStages SET ResultsJson=?,FinalizedAtUtc=? WHERE LeagueId=?')
    .run(JSON.stringify(results),now.toISOString(),leagueId);
  db.prepare('DELETE FROM PlayoffSeeding WHERE LeagueId=?').run(leagueId);
  const insert=db.prepare('INSERT INTO PlayoffSeeding(LeagueId,TeamId,Seed,Bracket) VALUES(?,?,?,?)');
  for(const bracket of ['upper','lower'])teams.filter(team=>team.Qualification===bracket)
    .sort((a,b)=>(a.TiebreakerId?1:0)-(b.TiebreakerId?1:0)||(a.TiebreakerId?a.Rank:a.GroupRank)-(b.TiebreakerId?b.Rank:b.GroupRank)||a.TeamId-b.TeamId)
    .forEach((team,index)=>insert.run(leagueId,team.TeamId,index+1,bracket));
  return results;
}

export function qualificationStageResponse(stage,matches=[]) {
  const {snapshot,results}=stage,pools=results?.pools||rankQualificationPools(snapshot,matches);
  const teams=results?.teams||snapshot.teams;
  return {success:true,tiebreakerPools:pools,tiebreakerTeams:pools.flatMap(pool=>pool.teams),
    upperBracketTeams:teams.filter(team=>team.Qualification==='upper'),lowerBracketTeams:teams.filter(team=>team.Qualification==='lower'),
    eliminatedTeams:teams.filter(team=>team.Qualification==='eliminated'),finalized:!!results};
}
