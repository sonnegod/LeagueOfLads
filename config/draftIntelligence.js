import { metaWeight } from '../shared/metaPolicy.js';
import { addSignal } from './draftHistory.js';
const finite = n => typeof n==='number' && Number.isFinite(n);
const average = values => { const v=values.filter(finite); return { value: v.length ? v.reduce((a,b)=>a+b,0)/v.length : null, samples:v.length }; };
const median = values => { const v=values.filter(finite).sort((a,b)=>a-b); return v.length ? (v[Math.floor((v.length-1)/2)]+v[Math.ceil((v.length-1)/2)])/2 : null; };
const record = (matches,team) => ({ games: matches.length, wins: matches.filter(m=>m.winner===team(m)).length });

export function buildDraftIntelligence(history, config, teamIds, meta) {
  if(config.metaMode==='current' || config.metaMode==='recent') history={...history,raw:history.raw.filter(m=>
    config.metaMode==='current' ? Boolean(meta.current && m.patch===meta.current.key) : Date.parse(config.asOf)-Date.parse(m.date)<=30*86400000)};
  const out = {};
  // Baselines match hero AND patch; a lane classification is not a numbered farm position.
  const baselines = new Map();
  for (const m of history.raw) for (const p of m.telemetry?.players || []) {
    if (!m.players.some(r=>r.PlayerId===p.id && r.HeroId===p.heroId)) continue;
    const key=`${m.patch}:${p.heroId}:${p.lane}`;
    const b=baselines.get(key) || []; b.push(p); baselines.set(key,b);
  }
  for (const side of ['our','opponent']) {
    const ids=config.lineups[side].map(p=>p.id), idSet=new Set(ids), teamId=teamIds[side];
    const chemistry=[], pairs=new Map(), heroPairs={};
    for (const m of history.raw) for (const t of [m.rad,m.dire]) {
      const members=m.players.filter(p=>p.TeamId===t && idSet.has(p.PlayerId));
      if (members.length>=3) chemistry.push({ m,team:t,overlap:members.length });
      for (let a=0;a<members.length;a++) for (let b=a+1;b<members.length;b++) {
        const key=[members[a].PlayerId,members[b].PlayerId].sort((x,y)=>x-y).join(':');
        const row=pairs.get(key)||{ players:key.split(':').map(Number),games:0,wins:0,currentGames:0 };
        row.games++;row.wins+=Number(m.winner===t);row.currentGames+=Number(m.patch===meta.current?.key);pairs.set(key,row);
        const heroIds=[members[a].HeroId,members[b].HeroId].sort((x,y)=>x-y),heroKey=heroIds.join(':');
        if(heroIds[0]===heroIds[1])continue;
        const h=heroPairs[heroKey] ||= {games:0,wins:0,effectiveGames:0,effectiveWins:0,practiceGames:0,currentGames:0,unknownGames:0,patches:{}};
        const date=m.kickoff && Date.parse(m.kickoff)<Date.parse(config.asOf) ? m.kickoff : m.date;
        const w=metaWeight(meta,{date,precise:date.length>10,heroes:heroIds,mode:config.metaMode || 'adaptive'}),won=Number(m.winner===t);
        addSignal(h,won,w,w.patch===meta.current?.key);
        const split=h.patches[w.patch||'unknown'] ||= {games:0,wins:0};split.games++;split.wins+=won;
      }
    }
    const teamMatches=history.raw.filter(m=>teamId && [m.rad,m.dire].includes(teamId));
    const current=teamMatches.filter(m=>m.patch===meta.current?.key), latest=teamMatches.slice(-10), previous=teamMatches.slice(-20,-10);
    const observed = history.raw.filter(m=>m.players.some(p=>idSet.has(p.PlayerId)));
    const playerStats={};
    for (const id of ids) {
      const appearances=observed.flatMap(m=>m.players.filter(p=>p.PlayerId===id).map(p=>({m,p})));
      const recents=appearances.slice(-10), rows=recents.map(({m,p})=>{
        const teammates=m.players.filter(t=>t.TeamId===p.TeamId), complete=teammates.length===5;
        const kills=complete ? teammates.reduce((s,t)=>s+t.Kills,0) : null;
        const sum = key => complete && teammates.every(t=>finite(t[key])) ? teammates.reduce((s,t)=>s+t[key],0) : null;
        const net=sum('Networth'), damage=sum('HeroDamage');
        const parsed=m.telemetry?.players.find(t=>t.id===id && t.heroId===p.HeroId);
        const base=parsed ? (baselines.get(`${m.patch}:${p.HeroId}:${parsed.lane}`)||[]).filter(t=>t.id!==id) : [];
        const goldBase=base.map(t=>t.gold10).filter(finite);
        return { gpm:p.GPM,xpm:p.XPM,kp:kills>0 ? (p.Kills+p.Assists)/kills : null,
          netShare:net>0 ? p.Networth/net : null,damageShare:damage>0 ? p.HeroDamage/damage : null,
          damageMin:m.duration>0 && finite(p.HeroDamage) ? p.HeroDamage/(m.duration/60) : null,
          towerMin:m.duration>0 && finite(p.TowerDamage) ? p.TowerDamage/(m.duration/60) : null,
          healMin:m.duration>0 && finite(p.Healing) ? p.Healing/(m.duration/60) : null,
          gold10:parsed?.gold10,xp10:parsed?.xp10,lh10:parsed?.lh10,
          laneDelta:finite(parsed?.gold10)&&goldBase.length>=5 ? parsed.gold10-average(goldBase).value : null,
          wards:parsed?.wards,sentries:parsed?.sentries,stacks:parsed?.stacks,stuns:parsed?.stuns };
      });
      const stats=Object.fromEntries(['gpm','xpm','kp','netShare','damageShare','damageMin','towerMin','healMin','gold10','xp10','lh10','laneDelta','wards','sentries','stacks','stuns'].map(k=>[k,average(rows.map(r=>r[k]))]));
      const items={};
      for (const {m,p} of recents) {
        const parsed=m.telemetry?.players.find(t=>t.id===id && t.heroId===p.HeroId);
        for (const [item,time] of Object.entries(parsed?.purchases||{})) (items[item] ||= []).push(time);
      }
      const heroForm={};for(const {m,p} of recents){const r=heroForm[p.HeroId] ||= {heroId:p.HeroId,games:0,wins:0};r.games++;r.wins+=Number(m.winner===p.TeamId);}
      const formRecord=list=>({games:list.length,wins:list.filter(({m,p})=>m.winner===p.TeamId).length});
      playerStats[id]={ appearances:appearances.length,recent:recents.length,form:{recent:formRecord(recents),previous:formRecord(appearances.slice(-20,-10))},heroForm:Object.values(heroForm).sort((a,b)=>b.games-a.games),patches:[...new Set(recents.map(({m})=>m.patch||'unknown'))],stats,
        items:Object.entries(items).map(([item,times])=>({ item,seconds:median(times),buyers:times.length })).sort((a,b)=>b.buyers-a.buyers).slice(0,10) };
    }
    const telemetry=teamMatches.filter(m=>m.telemetry), gold20=telemetry.filter(m=>finite(m.telemetry.gold20));
    const signed = m => m.telemetry.gold20*(m.rad===teamId ? 1 : -1);
    const lead=gold20.filter(m=>signed(m)>=3000), deficit=gold20.filter(m=>signed(m)<=-2000);
    const objective = type => {
      const candidates=telemetry.filter(m=>m.telemetry.parsed && m.telemetry.objectives.some(o=>o.type===type));
      const first=candidates.filter(m=>m.telemetry.objectives.filter(o=>o.type===type).sort((a,b)=>a.time-b.time)[0].side===(m.rad===teamId?0:1));
      return { eligible:candidates.length,first:first.length,wins:first.filter(m=>m.winner===teamId).length,
        medianSeconds:median(first.map(m=>m.telemetry.objectives.filter(o=>o.type===type).sort((a,b)=>a.time-b.time)[0].time)) };
    };
    const wonFights=telemetry.flatMap(m=>(m.telemetry.fights||[]).filter(f=>f.winner===(m.rad===teamId?0:1)));
    const draftRows=new Map(), responses=new Map();
    for (const m of teamMatches) {
      const picks=m.draft.filter(r=>r.isPick), teamSide=m.rad===teamId ? 0 : 1;
      picks.forEach((r,i)=>{ if(r.side!==teamSide)return;
        const row=draftRows.get(r.heroId)||{ heroId:r.heroId,picks:0,currentPicks:0,early:0,middle:0,late:0 };
        row.picks++;row.currentPicks+=Number(m.patch===meta.current?.key);row[i<4?'early':i<8?'middle':'late']++;draftRows.set(r.heroId,row);
        const prior=picks[i-1];if(prior&&prior.side!==teamSide){const k=`${prior.heroId}:${r.heroId}`;const q=responses.get(k)||{enemy:prior.heroId,reply:r.heroId,games:0,currentGames:0};q.games++;q.currentGames+=Number(m.patch===meta.current?.key);responses.set(k,q);}
      });
    }
    const patches=Object.entries(history.patchCounts).map(([patch])=>({patch,...record(teamMatches.filter(m=>(m.patch||'unknown')===patch),()=>teamId)})).filter(r=>r.games);
    const durations=[['Under 30 min',0,1800],['30–45 min',1800,2700],['45+ min',2700,Infinity]].map(([label,min,max])=>({label,...record(teamMatches.filter(m=>finite(m.duration)&&m.duration>=min&&m.duration<max),()=>teamId)}));
    const pool=ids.map(id=>{
      const heroes=Object.values(history.players[id]?.heroes||{}), counts=heroes.map(h=>h.games), total=counts.reduce((s,n)=>s+n,0);
      return {id,heroes:heroes.length,currentHeroes:heroes.filter(h=>h.currentGames>0).length,
        practicedHeroes:heroes.filter(h=>h.practiceGames>=2).length,topThreeShare:total?counts.sort((a,b)=>b-a).slice(0,3).reduce((s,n)=>s+n,0)/total:null,
        entropy:total?-counts.reduce((s,n)=>s+(n/total)*Math.log2(n/total),0):null};
    });
    out[side]={ teamId,teamKey:side==='our'?config.ourTeam:config.opponentTeam,teamGames:teamMatches.length,heroPairs,current:record(current,()=>teamId),form:{recent:record(latest,()=>teamId),previous:record(previous,()=>teamId)},
      chemistry:{exact:record(chemistry.filter(r=>r.overlap===5).map(r=>r.m),m=>chemistry.find(r=>r.m===m).team),
        overlaps:[3,4,5].map(n=>{const r=chemistry.filter(q=>q.overlap>=n);return{players:n,games:r.length,wins:r.filter(q=>q.m.winner===q.team).length};}),pairs:[...pairs.values()].sort((a,b)=>b.games-a.games)},
      durations,patches,players:playerStats,pools:pool,
      draft:{heroes:[...draftRows.values()].sort((a,b)=>b.currentPicks-a.currentPicks||b.picks-a.picks).slice(0,20),responses:[...responses.values()].filter(r=>r.games>=2).sort((a,b)=>b.currentGames-a.currentGames||b.games-a.games).slice(0,10)},
      timeline:{coverage:{eligible:teamMatches.length,observed:telemetry.length,timeline:gold20.length},
        leadConversion:record(lead,()=>teamId),comebacks:record(deficit,()=>teamId),gold10:average(telemetry.map(m=>finite(m.telemetry.gold10)?m.telemetry.gold10*(m.rad===teamId?1:-1):null)),
        objectives:{firstBlood:objective('firstBlood'),tower:objective('tower'),roshan:objective('roshan')},
        fights:{wins:wonFights.length,converted:wonFights.filter(f=>f.objectiveFollowup).length}},
      context:'Team-ID history may include other rosters. Player style uses the last 10 eligible appearances, including observed stand-ins. Descriptive results are split by patch; they are not causal hero effects.' };
  }
  return out;
}
