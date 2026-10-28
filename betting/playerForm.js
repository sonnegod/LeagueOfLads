// Observed form, not inferred historical roles. No older game is labelled core/support.
export const PLAYER_FORM_VERSION='player-form-v1';
export const PLAYER_FORM_POLICY=Object.freeze({minimumRecent:1,maximumRecent:6,minimumBaseline:5,
  minimumRelativeChange:.25,minimumStandardizedChange:1.5,consistency:.75,maximumRecentWeight:.8});
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const floors={GPM:50,XPM:50,LastHits:1,Kills:.1,Deaths:.1,Assists:.1,HeroDamage:100,TowerDamage:20,Healing:20};
const completedAt=row=>Date.parse(row.StartedAtUtc)+Number(row.DurationSeconds)*1000;
export const metricAvailableAt=row=>Math.max(completedAt(row),Date.parse(row.SourceObservedAtUtc));

// Canonical current-season rows replace cached rows, including deletions/corrections.
export function mergePlayerMetricHistory(current,historical,season,at){
  const cutoff=Date.parse(at),rows=new Map();
  for(const row of historical||[])if(row.SeasonId!==season.SeasonId&&row.LeagueId!==season.LeagueId)rows.set(`${row.MatchId}:${row.PlayerId}`,row);
  for(const row of current||[])rows.set(`${row.MatchId}:${row.PlayerId}`,row);
  return [...rows.values()].filter(row=>row.DurationSeconds>0&&metricAvailableAt(row)<=cutoff)
    .sort((a,b)=>completedAt(a)-completedAt(b)||a.MatchId-b.MatchId||a.PlayerId-b.PlayerId);
}

function normalized(row,column){
  if(!Number.isFinite(row[column])||row[column]<0)return null;
  if(['GPM','XPM'].includes(column))return row[column];
  return row.DurationSeconds>0?row[column]*60/row.DurationSeconds:null;
}

export function playerStatDistribution(personal,pool,column,seasonId){
  personal=personal.filter(row=>Number.isFinite(row[column])&&row[column]>=0).slice(-100);
  pool=pool.filter(row=>Number.isFinite(row[column])&&row[column]>=0).slice(-2000);
  if(!pool.length)return null;
  const current=Number.isSafeInteger(seasonId)&&seasonId>0?personal.filter(row=>row.SeasonId===seasonId):[];
  let baseline=personal,recent=[],recentWeight=0,change=null;
  for(let n=Math.min(PLAYER_FORM_POLICY.maximumRecent,current.length);n>=PLAYER_FORM_POLICY.minimumRecent;n--){
    const candidate=current.slice(-n),ids=new Set(candidate.map(row=>row.MatchId));
    const prior=personal.filter(row=>!ids.has(row.MatchId));
    const previous=prior.map(row=>normalized(row,column)).filter(value=>value!==null);
    const latest=candidate.map(row=>normalized(row,column));
    if(previous.length<PLAYER_FORM_POLICY.minimumBaseline||latest.some(value=>value===null))continue;
    const oldMedian=median(previous),newMedian=median(latest),difference=newMedian-oldMedian;
    const scale=Math.max(1.4826*median(previous.map(value=>Math.abs(value-oldMedian))),Math.abs(oldMedian)*.2,floors[column]||.1);
    const relative=Math.abs(difference)/Math.max(Math.abs(oldMedian),floors[column]||.1);
    const standardized=Math.abs(difference)/scale;
    const consistent=latest.filter(value=>Math.sign(value-oldMedian)===Math.sign(difference)&&Math.abs(value-oldMedian)>=scale).length/latest.length;
    if(relative<PLAYER_FORM_POLICY.minimumRelativeChange||standardized<PLAYER_FORM_POLICY.minimumStandardizedChange||consistent<PLAYER_FORM_POLICY.consistency)continue;
    baseline=prior;recent=candidate;recentWeight=Math.min(PLAYER_FORM_POLICY.maximumRecentWeight,.3+.1*n);
    change={direction:difference>0?'up':'down',relativeChange:relative,standardizedChange:standardized};break;
  }
  const personalWeight=baseline.length/(baseline.length+10);
  const own=baseline.map(row=>row[column]),peers=pool.map(row=>row[column]),latest=recent.map(row=>row[column]);
  const expected=(1-recentWeight)*(personalWeight*(own.length?average(own):0)+(1-personalWeight)*average(peers))
    +recentWeight*(latest.length?average(latest):0);
  const probabilityOver=line=>{
    const rate=values=>values.filter(value=>value>line).length/values.length;
    return (1-recentWeight)*(personalWeight*(own.length?rate(own):0)+(1-personalWeight)*rate(peers))
      +recentWeight*(latest.length?rate(latest):0);
  };
  return {own,peers,recent:latest,personalWeight,recentWeight,expected,probabilityOver,
    form:{version:PLAYER_FORM_VERSION,historyGames:personal.length,currentSeasonGames:current.length,
      recentGames:recent.length,recentWeight,...(change||{}),reason:change?'recent_stat_change':'historical_baseline'}};
}

// Historical replays may use completion order for backfilled records, explicitly
// marked retrospective. Live validation also requires original observation times.
export function validatePlayerStatHistory(history,metrics,{retrospective=false}={}){
  const ordered=[...history].filter(row=>Number.isFinite(Date.parse(row.StartedAtUtc)))
    .sort((a,b)=>Date.parse(a.StartedAtUtc)-Date.parse(b.StartedAtUtc)||a.MatchId-b.MatchId||a.PlayerId-b.PlayerId);
  const available=[...ordered].filter(row=>Number.isFinite(retrospective?completedAt(row):metricAvailableAt(row)))
    .sort((a,b)=>(retrospective?completedAt(a)-completedAt(b):metricAvailableAt(a)-metricAvailableAt(b))||a.MatchId-b.MatchId);
  const reports={};
  for(const [stat,column] of Object.entries(metrics)){
    let cursor=0,samples=0,brier=0,referenceBrier=0,adaptedSamples=0;
    const pool=[],byPlayer=new Map();
    for(const game of ordered){
      const kickoff=Date.parse(game.StartedAtUtc);
      while(cursor<available.length&&(retrospective?completedAt(available[cursor]):metricAvailableAt(available[cursor]))<kickoff){
        const row=available[cursor++];if(!Number.isFinite(row[column])||row[column]<0)continue;
        const previous=byPlayer.get(row.PlayerId)||[];previous.push(row);if(previous.length>100)previous.shift();byPlayer.set(row.PlayerId,previous);
        pool.push(row);if(pool.length>2000)pool.shift();
      }
      const past=byPlayer.get(game.PlayerId)||[];
      if(past.length<5||pool.length<50||!Number.isFinite(game[column])||game[column]<0)continue;
      const candidate=playerStatDistribution(past,pool,column,game.SeasonId);
      const reference=playerStatDistribution(past,pool,column,null);
      const line=Math.floor(candidate.expected)+.5,actual=Number(game[column]>line);
      brier+=(candidate.probabilityOver(line)-actual)**2;referenceBrier+=(reference.probabilityOver(line)-actual)**2;
      samples++;if(candidate.recentWeight)adaptedSamples++;
    }
    const score=samples?brier/samples:null,reference=samples?referenceBrier/samples:null;
    reports[stat]={modelVersion:PLAYER_FORM_VERSION,samples,brier:score,referenceBrier:reference,adaptedSamples,
      method:retrospective?'retrospective_completed_game_replay':'completed_and_observed_game_replay',
      validated:samples>=20&&score<=.30&&score<=reference+1e-12};
  }
  return reports;
}
