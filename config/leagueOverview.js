const pair=(a,b)=>Number(a)>0&&Number(b)>0?[Number(a),Number(b)].sort((x,y)=>x-y).join(':'):null;
const terminal=new Set(['completed','closed']);

export function buildLeagueOverview({season,groups,entries,roster,series,events,stage,matches=[],overrides=[]},now=new Date()) {
  const submissions=new Set(entries.map(entry=>entry.TeamSubmissionId).filter(id=>id!=null));
  const lifecycle=new Map(series.map(item=>[item.SeriesId,item.Status]));
  const fixtures=events.filter(event=>!['cancelled','replaced','needs_review'].includes(event.Status));
  const playedPairs=new Set(series.filter(item=>['g','regular'].includes(item.Stage)&&terminal.has(item.Status))
    .map(item=>pair(item.Team1,item.Team2)).filter(Boolean));
  const finishedFixtures=new Set(fixtures.filter(event=>event.Stage==='regular'&&['completed','forfeit'].includes(event.Status))
    .map(event=>pair(event.Team1Key,event.Team2Key)).filter(Boolean));
  const closedPairs=new Set(series.filter(item=>['g','regular'].includes(item.Stage)&&item.Status==='closed')
    .map(item=>pair(item.Team1,item.Team2)).filter(Boolean));
  const remainingGroups=groups.map(group=>{
    const members=entries.filter(entry=>entry.GroupId===group.GroupId);
    const results=buildGroupResults(members.filter(team=>team.TeamId>0),matches,overrides.filter(row=>row.GroupId===group.GroupId));
    const manualScores=new Map(results.pairs.filter(score=>score.Overridden).map(score=>[pair(score.TeamA,score.TeamB),score]));
    const counts=new Map(members.map(team=>[team.EntryId,0]));
    let remainingSeries=0;
    for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++){
      const a=members[i],b=members[j];
      const key=pair(a.TeamId,b.TeamId),manual=manualScores.get(key);
      // An H2H override takes precedence over imported or fixture results.
      // Keep later imported wins using the same baseline rules as standings.
      const played=manual?manual.WinsA+manual.WinsB>=2||(manual.WinsA+manual.WinsB>0&&closedPairs.has(key))
        :playedPairs.has(key)||finishedFixtures.has(pair(a.TeamSubmissionId,b.TeamSubmissionId));
      if(played)continue;
      counts.set(a.EntryId,counts.get(a.EntryId)+1);counts.set(b.EntryId,counts.get(b.EntryId)+1);remainingSeries++;
    }
    return {groupId:group.GroupId,name:String(group.GroupName),remainingSeries,
      teams:members.map(team=>({entryId:team.EntryId,name:String(team.TeamName??`Team ${team.TeamId||team.EntryId}`),remainingSeries:counts.get(team.EntryId)}))
        .sort((a,b)=>b.remainingSeries-a.remainingSeries||a.name.localeCompare(b.name))};
  });
  return {
    season:{seasonId:season.SeasonId,name:season.LeagueName,leagueId:season.ExternalLeagueId,stage},
    snapshot:{teams:entries.length,groups:groups.length,
      players:new Set(roster.filter(player=>submissions.has(player.TeamSubmissionId)&&player.PlayerId>0).map(player=>player.PlayerId)).size,
      completedSeries:series.filter(item=>item.Status==='completed').length,
      closedSeries:series.filter(item=>item.Status==='closed').length,
      inProgressSeries:series.filter(item=>!terminal.has(item.Status)).length,
      scheduledSeries:fixtures.filter(event=>event.Status==='scheduled'&&Date.parse(event.ScheduledStartUtc)>now.getTime()
        &&!lifecycle.has(event.SeriesId)).length},
    remaining:{totalSeries:remainingGroups.reduce((total,group)=>total+group.remainingSeries,0),groups:remainingGroups},updatedAt:now.toISOString(),
  };
}
import {buildGroupResults} from './groupResults.js';

