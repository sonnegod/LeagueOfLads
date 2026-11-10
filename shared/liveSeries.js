export function groupLiveSeries(live,recent) {
  const liveIds=new Set(live.map(m=>m.MatchId)),byId=new Map([...recent,...live].map(m=>[m.MatchId,m])),groups=new Map();
  for(const match of byId.values()) {
    const key=match.TrackedSeriesId?'series:'+match.TrackedSeriesId:'match:'+match.MatchId;
    if(!groups.has(key))groups.set(key,{key,seriesId:match.TrackedSeriesId||null,
      team1:{id:match.SeriesTeam1||match.RadiantTeamId,name:match.SeriesTeam1Name||match.RadiantTeamName||'Radiant'},
      team2:{id:match.SeriesTeam2||match.DireTeamId,name:match.SeriesTeam2Name||match.DireTeamName||'Dire'},
      bestOf:match.SeriesBestOf||null,status:match.SeriesStatus||'unassigned',
      score:[match.SeriesTeam1Wins||0,match.SeriesTeam2Wins||0],games:[],live:false});
    const group=groups.get(key);group.live ||= liveIds.has(match.MatchId);
    group.games.push({...match,isLive:liveIds.has(match.MatchId)});
  }
  for(const group of groups.values()) {
    group.games.sort((a,b)=>(a.MatchStartedAt||'').localeCompare(b.MatchStartedAt||'')||a.MatchId-b.MatchId);
    let number=0;
    group.games=group.games.map(game=>({...game,gameNumber:game.ImportStatus?.result==='remake'?null:++number}));
  }
  return [...groups.values()].sort((a,b)=>Number(b.live)-Number(a.live)||b.games.at(-1).MatchId-a.games.at(-1).MatchId);
}
