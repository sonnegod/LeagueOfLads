import {buildGroupResults} from './groupResults.js';

const pair=(a,b)=>Number(a)>0&&Number(b)>0?[Number(a),Number(b)].sort((x,y)=>x-y).join(':'):null;
const terminal=new Set(['completed','closed']);

export function buildLeagueOverview({season,groups,entries,roster,series,events,stage,matches=[],overrides=[]},now=new Date()) {
  const submissions=new Set(entries.map(entry=>entry.TeamSubmissionId).filter(id=>id!=null));
  const lifecycle=new Map(series.map(item=>[item.SeriesId,item.Status]));
  const fixtures=events.filter(event=>!['cancelled','replaced','needs_review'].includes(event.Status));
  const remainingGroups=groups.map(group=>{
    const members=entries.filter(entry=>entry.GroupId===group.GroupId);
    const results=buildGroupResults(members.filter(team=>team.TeamId>0),matches,overrides.filter(row=>row.GroupId===group.GroupId));
    const scores=new Map(results.pairs.map(score=>[pair(score.TeamA,score.TeamB),score]));
    const counts=new Map(members.map(team=>[team.EntryId,0]));
    let remainingSeries=0;
    for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++){
      const a=members[i],b=members[j];
      const key=pair(a.TeamId,b.TeamId),score=scores.get(key);
      const games=score?score.WinsA+score.WinsB:0;
      // Use the same effective H2H scores as the group matrix, including admin edits.
      if(games>=2)continue;
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
