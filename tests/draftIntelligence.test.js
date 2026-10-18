import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { metaWeight,patchAt } from '../shared/metaPolicy.js';
import { normalizeTelemetry,ingestDraftTelemetry } from '../config/draftTelemetry.js';
import { buildDraftIntelligence } from '../config/draftIntelligence.js';
import { buildDraftHistory } from '../config/draftHistory.js';
import { syncDraftPatches } from '../config/draftMeta.js';
import { supportedAssignments,poolPressure,banImpact,analyzeDraft,DEFAULT_FORMAT } from '../shared/draftModel.js';

const patches=[
  {key:'1.0',startsAt:'2026-01-01T00:00:00Z',major:true,notesKnown:true,heroes:{}},
  {key:'1.0a',startsAt:'2026-02-01T00:00:00Z',major:false,notesKnown:true,heroes:{2:'changed'}},
  {key:'2.0',startsAt:'2026-03-01T00:00:00Z',major:true,notesKnown:true,heroes:{1:'reset'}},
];
const meta={patches,current:patches[2],asOf:'2026-03-10T00:00:00Z',overrides:{}};
test('patch sync stores derived change markers, retains overrides, and resumes missing notes only',async()=>{
  const db=new Database(':memory:');let calls=0;
  const fetcher=async url=>{calls++;return {ok:true,json:async()=>url.includes('patchnoteslist')
    ?{patches:[{patch_number:'7.40',patch_timestamp:1765785600},{patch_number:'7.40b',patch_timestamp:1766476800}]}
    :{success:true,heroes:[{hero_id:1,abilities:[{note:'Reworked ability'}]},{hero_id:2,abilities:[{note:'Damage increased'}]}]}};};
  try {
    await syncDraftPatches(db,{fetcher,limit:1});assert.equal(calls,2);
    assert.deepEqual(JSON.parse(db.prepare("SELECT ChangesJson FROM DraftGodPatches WHERE PatchKey='7.40b'").get().ChangesJson),{1:'reset',2:'changed'});
    db.exec("INSERT INTO DraftGodMetaOverrides VALUES ('7.40b',1,1,'Owner judgement','now')");
    await syncDraftPatches(db,{fetcher,limit:1});assert.equal(calls,4); // Calendar plus the remaining major patch.
    await syncDraftPatches(db,{fetcher,limit:1});assert.equal(calls,5); // Calendar only.
    assert.equal(db.prepare('SELECT Transfer FROM DraftGodMetaOverrides').get().Transfer,1);
    assert.equal(db.prepare("SELECT Major FROM DraftGodPatches WHERE PatchKey='7.40b'").get().Major,0);
  }finally{db.close();}
});
test('patch transfers distinguish stable practice, changed heroes, reworks, pairs and unknown dates',()=>{
  const base={date:'2026-01-15T00:00:00Z'},stable=metaWeight(meta,{...base,heroes:[3]}),changed=metaWeight(meta,{...base,heroes:[2]}),reset=metaWeight(meta,{...base,heroes:[1]});
  assert.ok(stable.outcome>changed.outcome);assert.equal(reset.outcome,0);assert.ok(reset.practice>0);
  assert.equal(metaWeight(meta,{...base,heroes:[1,3]}).outcome,0);
  assert.equal(metaWeight(meta,{...base,mode:'current',heroes:[3]}).outcome,0);
  assert.equal(metaWeight(meta,{...base,mode:'recent',heroes:[3]}).outcome,0);
  assert.equal(patchAt(patches,'2026-02-01',false),null);
  assert.equal(metaWeight(meta,{date:'2025-01-01',heroes:[3]}).unknown,true);
  const override={...meta,overrides:{'2.0:1':{transfer:1}}};
  assert.ok(metaWeight(override,{...base,heroes:[1]}).outcome>0);
  assert.equal(metaWeight({...meta,overrides:{'2.0:0':{transfer:0}}},{...base,heroes:[3]}).outcome,0);
});

function payload() {
  return {match_id:100,start_time:1772409600,duration:2100,version:22,patch:60,radiant_win:true,
    radiant_gold_adv:Array(36).fill(3500),radiant_xp_adv:Array(36).fill(2000),
    players:Array.from({length:10},(_,i)=>({account_id:i+1,hero_id:i+1,player_slot:i<5?i:128+i-5,
      lane_role:i%3+1,times:[0,600,1200],gold_t:[0,5000,10000],xp_t:[0,4000,9000],lh_t:[0,60,150],obs_placed:0,
      purchase_log:[{key:'blink',time:700},{key:'blink',time:1200},{key:'black_king_bar',time:2300}]})),
    objectives:[{type:'building_kill',key:'npc_dota_badguys_tower1_top',time:600,player_slot:0},
      {type:'building_kill',key:'npc_dota_goodguys_tower1_top',time:610,player_slot:0},
      {type:'building_kill',key:'npc_dota_goodguys_tower1_mid',time:620,unit:'npc_dota_creep_badguys'},
      {type:'CHAT_MESSAGE_ROSHAN_KILL',time:1000,team:2},{type:'CHAT_MESSAGE_FIRSTBLOOD',time:20,player_slot:128}],
    teamfights:[{end:950,players:Array.from({length:10},(_,i)=>({deaths:i>=5?1:0}))}]};
}
test('parsed telemetry preserves missing vs zero, seconds-based snapshots, enemy towers and first purchase',()=>{
  const p=payload();delete p.players[1].gold_t;delete p.players[1].obs_placed;
  const r=normalizeTelemetry(p);
  assert.equal(r.players[0].gold10,5000);assert.equal(r.players[1].gold10,null);
  assert.equal(r.players[0].wards,0);assert.equal(r.players[1].wards,null);
  assert.equal(r.players[0].purchases.blink,700);assert.equal(r.players[0].purchases.black_king_bar,undefined);
  assert.equal(r.objectives.filter(o=>o.type==='tower').length,2); // Own tower denial omitted.
  assert.equal(r.fights[0].objectiveFollowup,true);assert.equal(r.gold20,3500);
  delete p.radiant_gold_adv; assert.equal(normalizeTelemetry(p).gold20,null);
  const db=new Database(':memory:');try {
    ingestDraftTelemetry(db,payload());ingestDraftTelemetry(db,p);
    const stored=db.prepare('SELECT * FROM DraftGodMatchTelemetry').get();assert.equal(stored.Status,'ready');
    assert.equal(JSON.parse(stored.SummaryJson).gold20,3500);
  }finally{db.close();}
});

function match(id,won=true,patch='2.0') {
  const players=Array.from({length:10},(_,i)=>({MatchId:id,PlayerId:i+1,HeroId:i+1,TeamId:i<5?100:200,
    Kills:2,Assists:3,Deaths:1,Networth:10000,HeroDamage:10000,TowerDamage:2000,Healing:null,GPM:500,XPM:600}));
  const telemetry=normalizeTelemetry({...payload(),match_id:id});
  return {id,rad:100,dire:200,winner:won?100:200,patch,date:'2026-03-05',duration:2100,players,telemetry,draft:[]};
}
const config={seasonId:1,ourTeam:'a',opponentTeam:'b',asOf:meta.asOf,firstPick:true,radiant:true,format:DEFAULT_FORMAT,
  lineups:{our:[1,2,3,4,5].map(id=>({id,role:0})),opponent:[6,7,8,9,10].map(id=>({id,role:0}))}};
test('chemistry counts matches once, styles retain metric denominators and timeline coverage excludes missing',()=>{
  const raw=[match(1),match(2,false),match(3)];raw[2].telemetry=null;
  const history={raw,patchCounts:{'2.0':{}},players:{}};
  const i=buildDraftIntelligence(history,config,{our:100,opponent:200},meta).our;
  assert.equal(i.chemistry.exact.games,3);assert.equal(i.chemistry.exact.wins,2);assert.equal(i.chemistry.pairs.length,10);
  assert.equal(i.chemistry.pairs[0].games,3);assert.equal(i.timeline.coverage.timeline,2);
  assert.equal(i.timeline.leadConversion.games,2);assert.equal(i.timeline.leadConversion.wins,1);
  assert.equal(i.players[1].stats.healMin.value,null);assert.equal(i.players[1].stats.gold10.samples,2);
  assert.equal(i.players[1].stats.kp.value,.5);assert.equal(i.players[1].items[0].buyers,2);
  assert.equal(i.players[1].stats.laneDelta.samples,0); // Insufficient same-hero/lane comparison players.
  assert.equal(buildDraftIntelligence({...history,raw:[...raw,match(4,true,'1.0')]},{...config,metaMode:'current'},{our:100,opponent:200},meta).our.teamGames,3);
});

test('shared hero pools cannot cover multiple players; a ban reports lost distinct-player coverage',()=>{
  assert.equal(supportedAssignments({1:[1],2:[1],3:[2],4:[3],5:[4]}),4);
  const data={heroes:[1,2,3,4,5].map(id=>({id})),heroProfiles:{},players:{},teams:{a:{games:0,heroes:{},pairs:{}},b:{games:0,heroes:{},pairs:{}}},matchups:{}};
  for(let i=1;i<=10;i++)data.players[i]={games:10,publicHeroes:[],heroes:[{id:i%5+1,games:10,wins:10,effectiveGames:0,effectiveWins:0,practiceGames:8}]};
  const p=poolPressure(data,config,[],'our');assert.equal(p.supported,5);
  const impact=banImpact(p,1);assert.equal(impact.after,4);assert.equal(impact.players.length,1);
  const board=DEFAULT_FORMAT.actions.slice(0,9).map((s,i)=>({heroId:i<7?20+i:s[0]==='A'?2:3,playerId:null}));
  const model=analyzeDraft(data,config,board);assert.notEqual(model.confidence,'High'); // Old raw wins cannot supply current-meta confidence.
});

test('history weights can change within a season; same-day and future telemetry cannot leak into the cutoff',()=>{
  const db=new Database(':memory:');try {
    db.exec(`CREATE TABLE MatchLeague(MatchId,LeagueId,DatePlayed);CREATE TABLE MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,Duration,Rehost);
      CREATE TABLE MatchTeamPlayer(MatchId,PlayerId,TeamId);CREATE TABLE MatchPlayer(MatchId,PlayerId,HeroId,Kills,Deaths,Assists,Networth,Lasthits,HeroDamage,GPM,XPM,Healing,TowerDamage);
      CREATE TABLE PickInfo(MatchId,Hero_Id,Team,IsPick,OrderNum);`);
    ingestDraftTelemetry(db,payload());
    for(const [id,date] of [[1,'2026-01-15'],[2,'2026-03-05'],[3,'2026-03-10'],[4,'2026-03-11'],[5,'2026-01-15'],[100,null]]) {
      db.prepare('INSERT INTO MatchLeague VALUES (?,20,?)').run(id,date);db.prepare('INSERT INTO MatchTeam VALUES (?,100,200,100,2100,0)').run(id);
      db.prepare('INSERT INTO MatchTeamPlayer VALUES (?,1,100)').run(id);db.prepare('INSERT INTO MatchPlayer VALUES (?,1,1,0,0,0,0,0,0,0,0,0,0)').run(id);
    }
    ingestDraftTelemetry(db,{...payload(),match_id:5,start_time:Date.parse('2026-03-11')/1000});
    const h=buildDraftHistory(db,20,meta.asOf,meta,'adaptive');assert.equal(h.matches,2);assert.equal(h.players[1].games,2);
    assert.equal(h.players[1].heroes[1].patches['1.0'].games,1);assert.equal(h.players[1].heroes[1].currentGames,1);
    assert.ok(h.players[1].heroes[1].effectiveGames<1);assert.ok(h.players[1].heroes[1].practiceGames>1);
    assert.equal(h.excludedUndated,1);
  }finally{db.close();}
});
