import { seriesDistribution } from './pricing.js';
import { classifyStandings } from '../config/leagueRules.js';
import { generatePlayoffBracket } from '../client/src/utils/playoffBracket.js';
import {activeLineup,lineupPrior,resultAvailableAt} from './rosterStrength.js';
import {plannedGameCounts} from './seasonFormat.js';

export const MODEL_VERSION = 'league-lineup-v3';
export const METRICS = Object.freeze({ kills:'Kills',deaths:'Deaths',assists:'Assists',last_hits:'LastHits',
  hero_damage:'HeroDamage',tower_damage:'TowerDamage',healing:'Healing',gpm:'GPM',xpm:'XPM' });
export const metricLabel = key => ({ last_hits:'Last hits',hero_damage:'Hero damage',tower_damage:'Tower damage',gpm:'GPM',xpm:'XPM' })[key] || key[0].toUpperCase()+key.slice(1);
export function seededRandom(seed) { let state=seed>>>0; return () => { state+=0x6D2B79F5; let t=state; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
const bound = p => Math.max(.03,Math.min(.97,p));
const log5 = (a,b) => bound(a*(1-b)/(a+b-2*a*b));
const mean = values => values.reduce((sum,n)=>sum+n,0)/values.length;
const availableAt=game=>Math.max(Date.parse(game.SourceObservedAtUtc),Date.parse(game.StartedAtUtc)+Number(game.DurationSeconds)*1000);
const probabilityCache=new WeakMap();const metricCache=new WeakMap();
export function teamProbability(inputs,a,b) {
  let cache=probabilityCache.get(inputs);if(!cache){cache=new Map();probabilityCache.set(inputs,cache);}
  const key=`${inputs.modelMode}:${a}:${b}`;if(cache.has(key))return cache.get(key);
  const mmrs=inputs.teams.filter(t=>Number.isFinite(t.AverageSignupMMR)).map(t=>t.AverageSignupMMR);
  const prior=teamKey=> {
    const priorKey=`prior:${inputs.modelMode}:${teamKey}`;if(cache.has(priorKey))return cache.get(priorKey);
    const team=inputs.teams.find(t=>t.TeamSubmissionId===teamKey);
    const mmrPrior=(inputs.modelMode==='roster'||inputs.modelMode?.startsWith('lineup'))&&Number.isFinite(team?.AverageSignupMMR)&&mmrs.length
      ? Math.max(.1,Math.min(.9,1/(1+Math.exp(-(team.AverageSignupMMR-mean(mmrs))/1000)))) : .5;
    const strength=inputs.modelMode?.startsWith('lineup')?lineupPrior({mmrPrior,
      lineup:activeLineup(inputs.rosterIntervals?.length?inputs.rosterIntervals:inputs.roster,teamKey,inputs.asOf),
      history:inputs.strengthHistory||[],seasonId:inputs.season.SeasonId,at:inputs.asOf,
      publicFeatures:inputs.modelMode==='lineup_public'?inputs.publicFeatureHistory||[]:[]}):null;
    const value=strength?.ready?strength.probability:mmrPrior;
    cache.set(priorKey,value);return value;
  };
  const records = team => { const games=inputs.teamStats.filter(g=>g.TeamSubmissionId===team); const n=games.reduce((s,g)=>s+g.GamesPlayed,0);
    const wins=games.reduce((s,g)=>s+g.Wins,0); return (wins+16*prior(team))/(n+16); };
  // A richer prior is used only after that exact model passes temporal validation.
  const result=log5(records(a),records(b));cache.set(key,result);return result;
}

export function validateLineupModel(inputs,{includePublic=false}={}) {
  const history=inputs.history||[];const records=new Map(),players=new Map();let cursor=0,gameCursor=0,samples=0,brier=0,referenceBrier=0,loss=0;
  const available=[...(inputs.strengthHistory||[])].filter(g=>Number.isFinite(resultAvailableAt(g))).sort((a,b)=>resultAvailableAt(a)-resultAvailableAt(b));
  const completed=[...history].filter(g=>Number.isFinite(resultAvailableAt(g))).sort((a,b)=>resultAvailableAt(a)-resultAvailableAt(b));
  const publicByPlayer=new Map();
  for(const row of includePublic?inputs.publicFeatureHistory||[]:[]) {
    if(!publicByPlayer.has(row.PlayerId))publicByPlayer.set(row.PlayerId,[]);publicByPlayer.get(row.PlayerId).push(row);
  }
  for(const game of [...history].sort((a,b)=>Date.parse(a.StartedAtUtc)-Date.parse(b.StartedAtUtc)||a.MatchId-b.MatchId)) {
    const at=Date.parse(game.StartedAtUtc);
    while(cursor<available.length&&resultAvailableAt(available[cursor])<at) {
      const row=available[cursor++];if(!players.has(row.PlayerId))players.set(row.PlayerId,new Map());
      const seasons=players.get(row.PlayerId);if(!seasons.has(row.SeasonId))seasons.set(row.SeasonId,[]);
      const games=seasons.get(row.SeasonId);games.push(row);if(games.length>100)games.shift();
    }
    while(gameCursor<completed.length&&resultAvailableAt(completed[gameCursor])<at) {
      const row=completed[gameCursor++];
      for(const [key,won] of [[row.Team1Key,row.Team1Won],[row.Team2Key,1-row.Team1Won]]) {
        const prior=records.get(key)||{n:0,w:0};records.set(key,{n:prior.n+1,w:prior.w+won});
      }
    }
    const teams=(inputs.historyTeams||[]).filter(t=>t.SeasonId===game.SeasonId&&t.EffectiveFromUtc&&t.FromEstimated===0
      &&Date.parse(t.EffectiveFromUtc)<=at&&Number.isFinite(t.AverageSignupMMR));
    const priors=[game.Team1Key,game.Team2Key].map(key=>{
      const team=teams.find(t=>t.TeamSubmissionId===key);if(!team)return null;
      const lineup=activeLineup(inputs.historyRosters||[],key,game.StartedAtUtc);if(!lineup)return null;
      const past=lineup.flatMap(p=>[...(players.get(p.PlayerId)||new Map()).values()].flat());
      return lineupPrior({mmrPrior:Math.max(.1,Math.min(.9,1/(1+Math.exp(-(team.AverageSignupMMR-mean(teams.map(t=>t.AverageSignupMMR)))/1000)))),
        lineup,history:past,seasonId:game.SeasonId,at:game.StartedAtUtc,publicFeatures:includePublic?lineup.flatMap(p=>publicByPlayer.get(p.PlayerId)||[]):[]});
    });
    if(priors.some(p=>!p?.ready||includePublic&&!p.publicReady))continue;
    const strengths=[game.Team1Key,game.Team2Key].map((key,i)=>{const r=records.get(key)||{n:0,w:0};return (r.w+16*priors[i].probability)/(r.n+16);});
    const probability=log5(...strengths),actual=game.Team1Won;
    const reference=log5(...[game.Team1Key,game.Team2Key].map((key,i)=>{const r=records.get(key)||{n:0,w:0};
      return (r.w+16*(includePublic?priors[i].leagueProbability:priors[i].mmrPrior))/(r.n+16);}));
    referenceBrier+=(reference-actual)**2;
    brier+=(probability-actual)**2;loss-=actual*Math.log(probability)+(1-actual)*Math.log(1-probability);samples++;
  }
  const score=samples?brier/samples:null,logLoss=samples?loss/samples:null;
  const baseline=samples?referenceBrier/samples:null;
  return {modelVersion:`${MODEL_VERSION}-${includePublic?'lineup_public':'lineup'}`,samples,brier:score,referenceBrier:baseline,logLoss,
    validated:samples>=20&&score<=.27&&logLoss<=.8&&score<=baseline,
    reason:samples<20?'insufficient_temporal_samples':score>.27||logLoss>.8?'baseline_validation_failed':score>baseline?'candidate_worse_than_reference':null};
}
export function validateBaseline(history,historyTeams=[],mode='league') {
  const records=new Map(); let samples=0,brier=0,loss=0;
  const available=history.filter(g=>Number.isFinite(availableAt(g))).sort((a,b)=>availableAt(a)-availableAt(b));let cursor=0;
  for (const game of [...history].sort((a,b)=>a.StartedAtUtc.localeCompare(b.StartedAtUtc)||a.MatchId-b.MatchId)) {
    // Score each kickoff using only results already completed and observed.
    // Today's source corrections cannot impersonate historical knowledge.
    while(cursor<available.length&&availableAt(available[cursor])<Date.parse(game.StartedAtUtc)) {
      const past=available[cursor++];const a=records.get(past.Team1Key)||{n:0,w:0};const b=records.get(past.Team2Key)||{n:0,w:0};
      records.set(past.Team1Key,{n:a.n+1,w:a.w+past.Team1Won});records.set(past.Team2Key,{n:b.n+1,w:b.w+1-past.Team1Won});
    }
    const a=records.get(game.Team1Key)||{n:0,w:0}; const b=records.get(game.Team2Key)||{n:0,w:0};
    const seasonTeams=historyTeams.filter(t=>t.SeasonId===game.SeasonId&&t.EffectiveFromUtc&&t.EffectiveFromUtc<=game.StartedAtUtc
      &&t.FromEstimated===0&&Number.isFinite(t.AverageSignupMMR));
    const known=seasonTeams.some(t=>t.TeamSubmissionId===game.Team1Key)&&seasonTeams.some(t=>t.TeamSubmissionId===game.Team2Key);
    const prior=key=>mode==='roster'&&known ? Math.max(.1,Math.min(.9,1/(1+Math.exp(-(
      seasonTeams.find(t=>t.TeamSubmissionId===key).AverageSignupMMR-mean(seasonTeams.map(t=>t.AverageSignupMMR)))/1000)))) : .5;
    if ((mode==='roster'?known:a.n+b.n>=10)) { const p=log5((a.w+16*prior(game.Team1Key))/(a.n+16),(b.w+16*prior(game.Team2Key))/(b.n+16)); const y=game.Team1Won;
      brier+=(p-y)**2; loss-=y*Math.log(p)+(1-y)*Math.log(1-p); samples++; }
  }
  const score=samples ? brier/samples : null; const logLoss=samples ? loss/samples : null;
  return { modelVersion:`${MODEL_VERSION}-${mode}`,samples,brier:score,logLoss,validated:samples>=20&&score<=.27&&logLoss<=.8,
    reason:samples<20?'insufficient_temporal_samples':score>.27||logLoss>.8?'baseline_validation_failed':null };
}
export function validateStatDistributions(history) {
  const ordered=[...history].sort((a,b)=>a.StartedAtUtc.localeCompare(b.StartedAtUtc)||a.MatchId-b.MatchId);
  const reports={};
  const available=ordered.filter(g=>Number.isFinite(availableAt(g))).sort((a,b)=>availableAt(a)-availableAt(b));
  for(const [stat,column] of Object.entries(METRICS)) {
    const pooled=[];const personal=new Map();let count=0,brier=0,cursor=0;
    for(const game of ordered) {
      while(cursor<available.length&&availableAt(available[cursor])<Date.parse(game.StartedAtUtc)) {
        const previous=available[cursor++];const value=previous[column];if(!Number.isFinite(value))continue;
        personal.set(previous.PlayerId,[...(personal.get(previous.PlayerId)||[]),value].slice(-100));
        pooled.push(value);if(pooled.length>2000)pooled.shift();
      }
      const value=game[column];if(!Number.isFinite(value))continue;
      const past=personal.get(game.PlayerId)||[];
      if(pooled.length>=50&&past.length>=5) {
        const weight=past.length/(past.length+10);const expected=weight*mean(past)+(1-weight)*mean(pooled);
        const line=Math.floor(expected)+.5;
        const probability=weight*(past.filter(v=>v>line).length+1)/(past.length+2)
          +(1-weight)*(pooled.filter(v=>v>line).length+1)/(pooled.length+2);
        brier+=(probability-Number(value>line))**2;count++;
      }
    }
    reports[stat]={samples:count,brier:count?brier/count:null,validated:count>=20&&brier/count<=.30};
  }
  return reports;
}
export function seriesForecast(inputs,event) {
  const p=teamProbability(inputs,event.Team1Key,event.Team2Key); const scores=seriesDistribution(p,event.BestOf);
  const win=[{key:'team1',probability:scores.filter(s=>s.a>s.b).reduce((s,o)=>s+o.probability,0)},
    {key:'team2',probability:scores.filter(s=>s.b>s.a).reduce((s,o)=>s+o.probability,0)}];
  if(event.BestOf===2) win.push({key:'draw',probability:scores.find(s=>s.a===s.b).probability});
  return { gameProbability:p,scores,winner:win };
}
export function statSampler(inputs,playerId,stat,random) {
  const column=METRICS[stat]; if(!column) return null;
  let cache=metricCache.get(inputs);if(!cache){cache=new Map();metricCache.set(inputs,cache);}
  if(!cache.has(stat)) {
    const pooled=[];const players=new Map();
    for(const game of inputs.metricHistory)if(Number.isFinite(game[column])) {
      if(pooled.length<2000)pooled.push(game[column]);
      if(!players.has(game.PlayerId))players.set(game.PlayerId,[]);players.get(game.PlayerId).push(game[column]);
    }
    cache.set(stat,{pooled,players});
  }
  const {pooled,players}=cache.get(stat);const personal=players.get(playerId)||[];
  if(pooled.length<5) return null;
  const weight=personal.length/(personal.length+10);
  return () => { const source=personal.length&&random()<weight ? personal : pooled; return source[Math.floor(random()*source.length)]; };
}
export function statForecast(inputs,{playerId,stat,scope,games=1,event,teamKey,line:fixedLine=null},random,samples=2000) {
  const sampler=statSampler(inputs,playerId,stat,random); if(!sampler) return null;
  const values=[]; const scoreModel=event?seriesForecast(inputs,event).scores:null;
  for(let i=0;i<samples;i++) {
    let n=games;
    if(event) { let draw=random(); const picked=scoreModel.find(s=>(draw-=s.probability)<=0)||scoreModel.at(-1); n=picked.a+picked.b; }
    let total=0; for(let g=0;g<n;g++) total+=sampler(); values.push(scope==='average'?total/n:total);
  }
  const expected=mean(values); const line=fixedLine??Math.floor(expected)+.5;
  const over=(values.filter(v=>v>line).length+1)/(values.length+2);
  return {line,over,under:1-over,samples,expected,teamKey};
}

export function simulateSeason(inputs,setup,random,samples=2000) {
  const rules=JSON.parse(inputs.season.RulesJson||'null'); if(!rules) return null;
  if(rules.HasTiebreaker) return null;
  const groups=[...new Set(inputs.teams.map(t=>t.GroupId))];
  const gameCounts=plannedGameCounts(setup);
  if(groups.includes(null)) return null;
  // Model the published standard group format only. A nonstandard calendar
  // stays pending rather than assuming a made-up number of meetings.
  if(groups.some(group=>inputs.teams.filter(t=>t.GroupId===group).some(team=>2*(inputs.teams.filter(t=>t.GroupId===group).length-1)
    !==(typeof gameCounts==='object'?gameCounts[team.TeamSubmissionId]:gameCounts)))) return null;
  const placement=new Map(inputs.teams.map(t=>[t.TeamSubmissionId,{upper:0,lower:0,eliminated:0}]));
  const champion=new Map(inputs.teams.map(t=>[t.TeamSubmissionId,0])); const finalist=new Map(champion);
  const counts=[];
  for(let sim=0;sim<samples;sim++) {
    const seeded=[];
    for(const group of groups) {
      const teams=inputs.teams.filter(t=>t.GroupId===group); const stats=new Map(teams.map(t=>[t.TeamSubmissionId,{wins:0,opponents:[]}]));
      for(let a=0;a<teams.length;a++) for(let b=a+1;b<teams.length;b++) for(let game=0;game<2;game++) {
        const pa=teamProbability(inputs,teams[a].TeamSubmissionId,teams[b].TeamSubmissionId); const win=random()<pa;
        const ta=stats.get(teams[a].TeamSubmissionId),tb=stats.get(teams[b].TeamSubmissionId);
        ta.wins+=Number(win);tb.wins+=Number(!win);ta.opponents.push({key:teams[b].TeamSubmissionId,won:win});tb.opponents.push({key:teams[a].TeamSubmissionId,won:!win});
      }
      const rows=teams.map(t=>({...t,Wins:stats.get(t.TeamSubmissionId).wins,
        Neustadtl:stats.get(t.TeamSubmissionId).opponents.filter(o=>o.won).reduce((s,o)=>s+stats.get(o.key).wins,0),tie:random()}))
        .sort((a,b)=>b.Wins-a.Wins||b.Neustadtl-a.Neustadtl||a.tie-b.tie);
      const qualified=classifyStandings(rows,rules);
      // An unresolved tiebreaker slot is a real format ambiguity for simulation.
      // Placement buckets still work; bracket futures wait for a supported format.
      qualified.forEach((t,i)=> { const bucket=t.Qualification==='tiebreaker'?'lower':t.Qualification;
        placement.get(t.TeamSubmissionId)[bucket]++; seeded.push({...t,Bracket:bucket,SeedNumber:i+1,TeamId:t.TeamSubmissionId}); });
    }
    const upper=seeded.filter(t=>t.Bracket==='upper');const lower=seeded.filter(t=>t.Bracket==='lower');
    const power=n=>n>=2&&(n&(n-1))===0;
    const supported=power(upper.length)&&power(lower.length)&&(lower.length===upper.length||lower.length===2*upper.length)&&!rules.HasTiebreaker;
    if(!supported) continue;
    const bracket=generatePlayoffBracket(seeded); const nodes=[...bracket.upperBracket.flatMap(r=>r.matches),...bracket.lowerBracket.flatMap(r=>r.matches),...bracket.grandFinals];
    const byId=new Map(nodes.map(n=>[n.id,n]));
    const seed=(round,list)=> { const matches=round[0]?.matches||[]; for(let i=0;i<matches.length;i++) {
      matches[i].team1Id=list[i]?.TeamId;matches[i].team2Id=list[list.length-1-i]?.TeamId; } };
    seed(bracket.upperBracket,upper);seed(bracket.lowerBracket,lower);
    const pending=new Set(nodes);let resolved=0;let winner=null;let finalists=[];
    while(pending.size) {
      let progress=false;
      for(const node of [...pending]) {
        if(!node.team1Id||!node.team2Id) continue;
        const p=teamProbability(inputs,node.team1Id,node.team2Id);
        const scores=seriesDistribution(p,node.bracket==='grand'?5:3);let draw=random();const score=scores.find(s=>(draw-=s.probability)<=0)||scores.at(-1);
        const win=score.a>score.b?node.team1Id:node.team2Id;const lose=win===node.team1Id?node.team2Id:node.team1Id;
        if(node.winnerTo) { const target=byId.get(node.winnerTo); if(!target) return null; target[`team${node.winnerToSlot}Id`]=win; }
        if(node.loserTo) { const target=byId.get(node.loserTo); if(!target) return null; target.team2Id=lose; }
        if(node.bracket==='grand') {winner=win;finalists=[node.team1Id,node.team2Id];}
        pending.delete(node);progress=true;resolved++;
      }
      if(!progress) break;
    }
    if(winner&&resolved===nodes.length) {champion.set(winner,champion.get(winner)+1);finalists.forEach(key=>finalist.set(key,finalist.get(key)+1));counts.push(1);}
  }
  return { samples,placement:Object.fromEntries([...placement].map(([key,b])=>[key,Object.fromEntries(Object.entries(b).map(([k,n])=>[k,n/samples]))])),
    champion:counts.length===samples?Object.fromEntries([...champion].map(([k,n])=>[k,(n+1)/(samples+champion.size)])):null,
    finalist:counts.length===samples?Object.fromEntries([...finalist].map(([k,n])=>[k,(n+1)/(samples+2)])):null };
}

export function leaderForecast(inputs,roster,stat,scope,games,random,samples=2000) {
  const samplers=roster.map(p=>statSampler(inputs,p.PlayerId,stat,random));if(samplers.some(s=>!s)||roster.length<2)return null;
  const wins=Array(roster.length).fill(1);
  for(let run=0;run<samples;run++) {
    const values=samplers.map((sample,i)=>{const n=typeof games==='object'?games[roster[i].TeamSubmissionId]:games;
      if(!Number.isInteger(n)||n<1)throw new Error('Invalid planned game count');let total=0;for(let g=0;g<n;g++)total+=sample();return scope==='average'?total/n:total;});
    const high=Math.max(...values);const tied=values.map((v,i)=>v===high?i:-1).filter(i=>i>=0);tied.forEach(i=>wins[i]+=1/tied.length);
  }
  const total=wins.reduce((s,n)=>s+n,0);return roster.map((p,i)=>({key:`player:${p.PlayerId}`,probability:wins[i]/total,label:p.PlayerName}));
}
