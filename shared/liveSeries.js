const playingTime=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function playingDay(value) {
  if(value==null||value==='')return null;
  const date=value instanceof Date?value:new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value)?value:String(value).replace(' ','T')+'Z');
  if(!Number.isFinite(date.getTime()))return null;
  const parts=Object.fromEntries(playingTime.formatToParts(date).map(part=>[part.type,part.value]));
  const day=`${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour)>=5?day:new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10);
}

export function isActiveLiveSeries(series) {
  return series.live||series.status!=='closed'&&(['in_progress','needs_format','needs_review'].includes(series.status)
    ||series.games.some(game=>['pending','needs_review'].includes(game.ImportStatus?.result)));
}

export function groupLiveSeries(live,recent,now=new Date()) {
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
    // Snapshot changes, not repeated successful polls, define the playing window.
    // Expire public cards independently of import/review status and nightly retries.
    const days=group.games.map(game=>playingDay(game.LastChangedAt||game.CreatedAt||game.LastUpdated||game.MatchStartedAt)).filter(Boolean);
    const expired=days.length&&days.sort().at(-1)<playingDay(now);
    group.games=group.games.map(game=>({...game,isLive:Boolean(game.isLive&&!expired
      &&!['imported','remake'].includes(game.ImportStatus?.result))}));
    group.live=group.games.some(game=>game.isLive);
    if(expired&&group.status!=='completed')group.status='closed';
    group.games.sort((a,b)=>(a.MatchStartedAt||'').localeCompare(b.MatchStartedAt||'')||a.MatchId-b.MatchId);
    let number=0;
    group.games=group.games.map(game=>({...game,gameNumber:game.ImportStatus?.result==='remake'?null:++number}));
  }
  return [...groups.values()].sort((a,b)=>Number(b.live)-Number(a.live)||b.games.at(-1).MatchId-a.games.at(-1).MatchId);
}
