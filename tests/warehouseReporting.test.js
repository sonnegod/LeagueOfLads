import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import express from 'express';
import { initializeWarehouse, ingestWarehouseMatch } from '../config/warehouseIngestion.js';
import { WarehouseReporting, getReportingPlayers, draftPhases } from '../config/warehouseReporting.js';
import { createWarehouseReportingRouter } from '../routes/warehouseReportingRoutes.js';
import { ExpandedPerformanceReporting } from '../config/expandedPerformanceReporting.js';
import { planWarehouseDurationRepair, applyWarehouseDurationRepair } from '../config/warehouseDurationRepair.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../scripts/db/ladsData.schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO LeagueInfo VALUES(20,'Season 20',0),(21,'Season 21',0);
    INSERT INTO TeamInfo(TeamId,TeamName) VALUES(100,'Corrected Radiant'),(200,'Corrected Dire');`);
  for (let p = 1; p <= 10; p++) {
    db.prepare('INSERT INTO HeroInfo VALUES(?,?)').run(p, `Hero ${p}`);
    db.prepare('INSERT INTO PlayerInfo(PlayerId,PlayerName) VALUES(?,?)').run(p, `Player ${p}`);
  }
  for (let id = 1; id <= 3; id++) {
    db.prepare('INSERT INTO MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,SeriesId,Duration) VALUES(?,100,200,100,0,?)').run(id, id === 2 ? 480 : 1800);
    db.prepare('INSERT INTO MatchLeague VALUES(?,?,NULL)').run(id, id === 3 ? 21 : 20);
    for (let p = 1; p <= 10; p++) {
      db.prepare(`INSERT INTO MatchPlayer(MatchId,PlayerId,HeroId,Kills,Deaths,Assists,Networth,Lasthits,HeroDamage,GPM,XPM,Healing,TowerDamage)
        VALUES(?,?,?,3,2,4,1000,100,?,500,600,0,100)`).run(id, p, p, p * 100);
      // Duplicated, incorrect legacy memberships must not affect slotted games.
      db.prepare('INSERT INTO MatchTeamPlayer(MatchId,PlayerId,TeamId) VALUES(?,?,200),(?,?,200)').run(id, p, id, p);
    }
  }
  initializeWarehouse(db);
  const source = id => ({match_id:id,start_time:1760000000 + id * 86400,duration:id === 2 ? 480 : 1800,
    version:22,radiant_win:true,radiant_team_id:999,dire_team_id:998,radiant_score:30,dire_score:20,
    radiant_gold_adv:[0,100,200],radiant_xp_adv:[0,50,100],
    players:Array.from({length:10},(_,i)=>({account_id:i+1,hero_id:i+1,player_slot:i < 5 ? i : 128 + i - 5,
      kills:3,deaths:2,assists:4,net_worth:1000,last_hits:100,hero_damage:(i+1)*100,gold_per_min:500,xp_per_min:600,
      obs_placed:0,sen_placed:2,observer_kills:0,sentry_kills:1,camps_stacked:2,stuns:30,denies:0,level:20,
      times:[0,600,1200],gold_t:[0,1000,3000],xp_t:[0,1500,4000],lh_t:[0,10,30],purchase_log:[{time:0,key:'tango'}],item_0:180+i,item_1:0,
      rank_tier:99,mmr_estimate:{estimate:99999}})),
    objectives:id === 2 ? [] : [
      {time:100,type:'building_kill',player_slot:128,key:'npc_dota_badguys_tower1_mid'}, // deny
      {time:300,type:'building_kill',unit:'npc_dota_creep_goodguys_melee',key:'npc_dota_badguys_tower1_top'},
      {time:900,type:'CHAT_MESSAGE_ROSHAN_KILL',team:3}],
    teamfights:[{start:400,end:450,players:Array.from({length:10},(_,i)=>({deaths:i<5?0:1,damage:100,healing:5,buybacks:0,gold_delta:20,xp_delta:30}))}]});
  for (const id of [1,2]) ingestWarehouseMatch(db,source(id));
  // Team timelines normally have minute intervals; add explicit milestones for the test.
  db.exec(`INSERT INTO MatchTeamTimeline VALUES(1,600,2000,1000),(1,1200,-6000,-2000),(2,600,1000,1000);
    UPDATE MatchPlayer SET ObserversPlaced=NULL WHERE MatchId=1 AND PlayerId=2;`);
  return { db, reporting: new WarehouseReporting(db) };
}

test('match reporting assigns real sides despite duplicate memberships and credits creep objectives without inventing players',()=>{
  const {db,reporting}=fixture();
  try {
    const report=reporting.match(1);
    assert.equal(report.available,true);assert.equal(report.players.length,10);
    assert.deepEqual(report.players.map(p=>p.TeamSide),[0,0,0,0,0,1,1,1,1,1]);
    assert.equal(report.match.TeamRad,100);assert.equal(report.match.TeamDire,200);
    const tower=report.objectives.find(o=>o.time===300);
    assert.equal(tower.teamSide,0);assert.equal(tower.playerId,null);assert.equal(tower.denied,false);
    assert.equal(report.objectives.find(o=>o.time===100).denied,true);
    const legacy=reporting.match(3);assert.equal(legacy.available,false);assert.deepEqual(legacy.timeline,[]);
    db.exec('UPDATE MatchTeam SET Rehost=1 WHERE MatchId=3');
    assert.equal(reporting.match(3).available,false,'remakes keep their basic view without extended analysis');
    db.exec('INSERT INTO MatchTeamPlayer(MatchId,PlayerId,TeamId) VALUES(3,1,100)');
    assert.equal(getReportingPlayers(db,3).find(p=>p.PlayerId===1).TeamSide,null,'ambiguous unslotted players are not guessed');
  } finally { db.close(); }
});

test('player reports count eligible samples, preserve zero, exclude unplayed checkpoints and separate team records',()=>{
  const {db,reporting}=fixture();
  try {
    const data=reporting.performance('player',1);
    assert.deepEqual(data.coverage,{total:3,enriched:2});
    assert.deepEqual(data.summary.lh10,{value:10,samples:1});
    assert.deepEqual(data.summary.gold20,{value:3000,samples:1});
    assert.deepEqual(data.summary.wards10,{value:0,samples:2});
    assert.equal(data.summary.damageShare.samples,2);
    assert.ok(Math.abs(data.summary.damageShare.value - 100 / 1500 * 100) < 1e-8);
    assert.equal(data.byTeam[0].key,100);
    assert.equal(reporting.performance('player',1,{leagueId:21}).coverage.enriched,0);
    assert.equal(reporting.performance('player',1,{heroId:2}).coverage.total,0);
    const patch=data.patches[0].id;
    assert.equal(reporting.performance('player',1,{patchId:patch}).coverage.enriched,2);
    assert.equal(reporting.performance('player',1,{patchId:999999}).coverage.enriched,0);
  } finally {db.close();}
});

test('saved duration recovery restores player calculations without inventing unavailable parsed statistics',()=>{
  const {db,reporting}=fixture();
  try {
    db.exec('UPDATE MatchTeam SET Duration=NULL WHERE MatchId IN (1,2)');
    const before=reporting.performance('player',1,{leagueId:20});
    assert.equal(before.byHero[0].games,2);
    assert.equal(before.summary.damagePerMinute.samples,0);
    assert.equal(before.summary.lh10.samples,0);
    assert.equal(before.summary.damageShare.samples,2,'damage share does not need a duration');
    const result=applyWarehouseDurationRepair(db,planWarehouseDurationRepair(db));
    assert.equal(result.repaired.length,2);
    const after=reporting.performance('player',1,{leagueId:20});
    assert.equal(after.summary.damagePerMinute.samples,2);
    assert.equal(after.summary.wards10.value,0,'known zeros remain valid');
    assert.deepEqual(after.summary.lh10,{value:10,samples:1},'short games remain excluded from checkpoints');
    assert.equal(db.prepare('SELECT ObserversPlaced FROM MatchPlayer WHERE MatchId=1 AND PlayerId=2').get().ObserversPlaced,null);
    db.exec('DELETE FROM MatchPlayerTimeline WHERE MatchId=1 AND PlayerId=1 AND TimeSeconds=600');
    const missing=reporting.performance('player',1,{leagueId:20});
    assert.deepEqual(missing.summary.lh10,{value:null,samples:0},'missing timeline points stay unavailable');
    assert.equal(missing.summary.damagePerMinute.samples,2);
  }finally{db.close();}
});

test('team reports normalize advantage to the selected side, use actual denominators and require complete team statistics',()=>{
  const {db,reporting}=fixture();
  try {
    const radiant=reporting.performance('team',100,{leagueId:20}),dire=reporting.performance('team',200,{leagueId:20});
    assert.deepEqual(radiant.summary.gold10,{value:2000,samples:1});
    assert.deepEqual(dire.summary.gold10,{value:-2000,samples:1});
    assert.deepEqual(radiant.conversions.ahead10,{value:100,samples:1,wins:1});
    assert.deepEqual(dire.conversions.behind10,{value:0,samples:1,wins:0});
    assert.deepEqual(radiant.objectives.firstTower,{value:100,samples:1});
    assert.deepEqual(radiant.objectives.firstRoshan,{value:0,samples:1});
    assert.deepEqual(dire.objectives.roshanShare,{value:100,samples:1});
    assert.equal(radiant.summary.wards10.samples,1,'missing support field cannot become a zero team total');
    assert.equal(radiant.notable.find(n=>n.key==='comebacks').games.length,0,'a 6K deficit does not qualify');
    assert.equal(dire.notable.find(n=>n.key==='leadsLost').games.length,0,'a 6K lead does not qualify');
    db.exec('UPDATE MatchTeamTimeline SET RadiantGoldAdvantage=-10000 WHERE MatchId=1 AND TimeSeconds=1200');
    assert.equal(reporting.performance('team',100,{leagueId:20}).notable.find(n=>n.key==='comebacks').games[0].matchId,1);
    assert.equal(reporting.performance('team',200,{leagueId:20}).notable.find(n=>n.key==='leadsLost').games[0].matchId,1);
    assert.equal(radiant.distribution.length,5);assert.equal(dire.distribution.length,5);
  }finally{db.close();}
});

test('net worth shares use a complete final team total and keep missing values unavailable',()=>{
  const {db,reporting}=fixture();
  try {
    const shares=()=>reporting.performance('team',100,{leagueId:20}).distribution;
    assert.deepEqual(shares().find(p=>p.playerId===1).networthShare,{value:20,samples:2});
    db.exec('UPDATE MatchPlayer SET Networth=2000 WHERE PlayerId=1 AND MatchId IN(1,2)');
    assert.ok(Math.abs(shares().find(p=>p.playerId===1).networthShare.value-100/3)<1e-8);
    db.exec('UPDATE MatchPlayer SET Networth=NULL WHERE PlayerId=2 AND MatchId IN(1,2)');
    assert.deepEqual(shares().find(p=>p.playerId===1).networthShare,{value:null,samples:0});
    assert.deepEqual(reporting.performance('team',200,{leagueId:20}).distribution[0].networthShare,{value:20,samples:2});
  }finally{db.close();}
});

test('player percentiles compare filtered player averages, share ties and require sufficient per-metric samples',()=>{
  const {db,reporting}=fixture();
  try {
    for(const matchId of [4,5,6,7]) {
      for(const table of ['MatchTeam','MatchLeague','MatchPlayer','MatchTeamPlayer','MatchPlayerTimeline','MatchIngestionState']) {
        const columns=db.pragma(`table_info(${table})`).map(c=>c.name).filter(name=>name!=='UID');
        db.prepare(`INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.map(c=>c==='MatchId'?'?':c).join(',')} FROM ${table} WHERE MatchId=1`).run(matchId);
      }
    }
    db.exec('UPDATE MatchPlayer SET HeroId=1 WHERE PlayerId=2; UPDATE MatchPlayerTimeline SET Experience=Experience+1000 WHERE PlayerId=2');
    const data=reporting.performance('player',1,{leagueId:20,heroId:1});
    assert.deepEqual(data.percentiles.xp10,{value:25,players:2,minimumGames:5});
    assert.equal(data.summary.xp10.samples,5,'the short match cannot qualify for a farming checkpoint');
    assert.equal(data.percentiles.Denies.value,50,'equal player averages share the middle rank');
    assert.equal(reporting.performance('player',1,{leagueId:20}).percentiles.xp10.players,10,'unfiltered hero comparison includes all eligible players');
    assert.equal(reporting.performance('player',1,{leagueId:21}).percentiles.xp10.value,null,'season selection applies to target and comparison pool');
    const patch=data.patches[0].id;
    assert.equal(reporting.performance('player',1,{leagueId:20,patchId:patch,heroId:1}).percentiles.xp10.value,25);
    assert.equal(reporting.performance('player',1,{leagueId:20,patchId:99999}).percentiles.xp10.players,0);
    db.exec('UPDATE MatchPlayerTimeline SET Experience=NULL WHERE MatchId=1 AND PlayerId=1 AND TimeSeconds=600');
    const missing=reporting.performance('player',1,{leagueId:20,heroId:1});
    assert.equal(missing.percentiles.xp10.value,null,'four eligible games cannot yield a percentile');
    assert.equal(missing.percentiles.xp10.players,1);
    assert.equal(missing.percentiles.gold10.value,50,'missing XP does not erase known gold comparisons');
    db.exec('UPDATE MatchPlayer SET ObserversKilled=NULL WHERE MatchId=1 AND PlayerId=1');
    assert.equal(reporting.performance('player',1,{leagueId:20}).summary.dewards10.samples,5,'missing deward fields stay unknown');
  }finally{db.close();}
});

test('team percentiles include unrelated teams, normalize sides, share ties and favor earlier objective times',()=>{
  const {db,reporting}=fixture();
  try {
    db.exec(`INSERT INTO TeamInfo(TeamId,TeamName) VALUES(300,'Other Radiant'),(400,'Other Dire');
      UPDATE MatchPlayer SET ObserversPlaced=0 WHERE PlayerId=2 AND MatchId=1;`);
    for(const matchId of [4,5,6,7,8,9,10,11,12]) {
      for(const table of ['MatchTeam','MatchLeague','MatchPlayer','MatchTeamPlayer','MatchPlayerTimeline','MatchTeamTimeline','MatchObjectives','MatchIngestionState']) {
        const columns=db.pragma(`table_info(${table})`).map(c=>c.name).filter(name=>name!=='UID');
        db.prepare(`INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.map(c=>c==='MatchId'?'?':c).join(',')} FROM ${table} WHERE MatchId=1`).run(matchId);
      }
    }
    db.exec(`UPDATE MatchTeam SET TeamRad=300,TeamDire=400,WinnerId=300 WHERE MatchId>=8;
      UPDATE MatchTeamTimeline SET RadiantGoldAdvantage=1000 WHERE MatchId>=8 AND TimeSeconds=600;
      UPDATE MatchObjectives SET TimeSeconds=100 WHERE MatchId>=8 AND TimeSeconds=300;
      UPDATE MatchObjectives SET TimeSeconds=1200 WHERE MatchId>=8 AND TimeSeconds=900;`);
    const radiant=reporting.performance('team',100,{leagueId:20}),dire=reporting.performance('team',200,{leagueId:20});
    assert.deepEqual(radiant.percentiles.gold10,{value:87.5,teams:4,minimumGames:5,higherIsBetter:true});
    assert.equal(dire.percentiles.gold10.value,12.5,'advantage uses the selected team side');
    assert.equal(radiant.percentiles.wards10.value,50,'equal team averages share a rank');
    assert.equal(radiant.percentiles.firstTowerTime.value,25,'later first-tower time ranks below earlier time');
    assert.equal(radiant.percentiles.firstTowerTime.teams,2,'only teams with five first-tower timings qualify');
    assert.equal(radiant.percentiles.firstTowerTime.higherIsBetter,false);
    assert.equal(dire.percentiles.firstRoshanTime.value,75,'earlier first Roshan ranks higher');
    assert.equal(radiant.percentiles.ahead10.teams,2,'conditional rates use qualifying condition counts');
    assert.equal(radiant.percentiles.ahead10.value,50,'equally successful teams tie');
    assert.equal(radiant.percentiles.behind10.value,null,'a team without five behind-at-10 games cannot be ranked');
    assert.equal(reporting.performance('team',100,{leagueId:21}).percentiles.gold10.teams,0);
    const patch=radiant.patches[0].id;
    db.exec('UPDATE MatchTeam SET PatchId=NULL WHERE MatchId>=8');
    assert.equal(reporting.performance('team',100,{leagueId:20,patchId:patch}).percentiles.gold10.teams,2,'patch selection limits comparison teams');
    assert.equal(reporting.performance('team',100,{leagueId:20,patchId:patch}).percentiles.gold10.value,75);
    db.exec('UPDATE MatchTeamTimeline SET RadiantGoldAdvantage=NULL WHERE MatchId=1 AND TimeSeconds=600');
    assert.equal(reporting.performance('team',100,{leagueId:20}).percentiles.gold10.value,null,'missing values reduce eligible samples rather than becoming zero');
    assert.equal(reporting.performance('team',100,{leagueId:20}).percentiles.wards10.value,50,'one missing checkpoint does not erase other metrics');
  }finally{db.close();}
});

test('later team checkpoints use reached times, normalize sides and preserve separate gold and XP samples',()=>{
  const {db,reporting}=fixture();
  try {
    db.exec(`UPDATE MatchTeam SET Duration=3000 WHERE MatchId=1;
      INSERT INTO MatchTeamTimeline VALUES(1,1800,0,4000),(1,2400,8000,NULL),(1,3000,NULL,-5000),
        (2,1800,50000,50000),(1,3600,20000,20000);`);
    const radiant=reporting.performance('team',100,{leagueId:20}),dire=reporting.performance('team',200,{leagueId:20});
    assert.deepEqual(radiant.checkpoints.map(p=>p.minute),[10,20,30,40,50]);
    const at30=radiant.checkpoints.find(p=>p.minute===30);
    assert.deepEqual(at30.gold,{value:0,samples:1},'the short second match cannot contribute a late sample');
    assert.deepEqual(at30.xp,{value:4000,samples:1});
    assert.deepEqual(at30.ahead,{value:null,samples:0,wins:0},'tied gold is excluded from conversions');
    assert.deepEqual(at30.behind,{value:null,samples:0,wins:0});
    assert.deepEqual(radiant.checkpoints.find(p=>p.minute===40).xp,{value:null,samples:0});
    assert.deepEqual(radiant.checkpoints.find(p=>p.minute===40).ahead,{value:100,samples:1,wins:1});
    assert.deepEqual(dire.checkpoints.find(p=>p.minute===40).gold,{value:-8000,samples:1});
    assert.deepEqual(dire.checkpoints.find(p=>p.minute===40).behind,{value:0,samples:1,wins:0});
    assert.deepEqual(dire.checkpoints.find(p=>p.minute===50).gold,{value:null,samples:0});
    assert.deepEqual(dire.checkpoints.find(p=>p.minute===50).xp,{value:5000,samples:1});
    assert.equal(radiant.recent.find(g=>g.matchId===1).largestLead,8000,'samples after match end cannot manufacture a lost lead or comeback');
  }finally{db.close();}
});

test('detailed player and fight responses expose gameplay only, with missing inventories distinguished from empty slots',()=>{
  const {db,reporting}=fixture();
  try{
    const detail=reporting.playerMatch(1,1);
    assert.deepEqual(detail.inventory.items.slice(0,3),[180,0,null]);
    assert.equal(detail.purchases[0].ItemKey,'tango');assert.equal(detail.timeline.length,3);
    assert.equal(reporting.playerMatch(1,999),null);
    const fights=reporting.fights(1);assert.equal(fights.available,true);assert.equal(fights.fights.length,1);
    assert.deepEqual(fights.fights[0].totals,[{deaths:0,damage:500,gold:100,xp:150,healing:25,buybacks:0},{deaths:5,damage:500,gold:100,xp:150,healing:25,buybacks:0}]);
    for(const data of [detail,fights,reporting.performance('player',1)]){
      assert.doesNotMatch(JSON.stringify(data),/rank_tier|mmr_estimate|99999/);
    }
  }finally{db.close();}
});

test('match economy includes every player at aligned checkpoints and preserves missing values',()=>{
  const {db,reporting}=fixture();
  try {
    db.exec('UPDATE MatchPlayerTimeline SET Gold=NULL,LastHits=0 WHERE MatchId=1 AND PlayerId=2 AND TimeSeconds=600');
    const report=reporting.match(1);
    assert.equal(report.playerTimeline.length,30);
    assert.equal(new Set(report.playerTimeline.map(p=>p.PlayerId)).size,10);
    const missing=report.playerTimeline.find(p=>p.PlayerId===2 && p.TimeSeconds===600);
    assert.equal(missing.Gold,null);assert.equal(missing.LastHits,0);assert.equal(missing.Experience,1500);
    assert.deepEqual(report.playerTimeline.map(p=>p.TimeSeconds),[...report.playerTimeline.map(p=>p.TimeSeconds)].sort((a,b)=>a-b));
    assert.deepEqual(reporting.match(3).playerTimeline,[]);
    assert.doesNotMatch(JSON.stringify(report),/rank_tier|mmr_estimate|99999/);
  }finally{db.close();}
});

test('fight analysis derives separate death/resource edges, preserves ties and requires complete team totals',()=>{
  const {db,reporting}=fixture();
  try {
    db.exec(`UPDATE MatchTeamfightPlayers SET Damage=500,GoldDelta=-40,Deaths=2,
      SourceJson=json_set(SourceJson,'$.buybacks',1) WHERE MatchId=1 AND PlayerId=1`);
    const fight=reporting.fights(1).fights[0];
    assert.equal(fight.duration,50);assert.equal(fight.deathEdge,3);
    assert.equal(fight.goldEdge,-60);assert.equal(fight.xpEdge,0);
    assert.equal(fight.totals[0].buybacks,1);
    assert.deepEqual(fight.leaders.damage,[1]);
    assert.equal(fight.leaders.healing.length,10,'tied leaders are retained');
    assert.ok(Math.abs(fight.players.find(p=>p.playerId===1).damageShare-500/900*100)<1e-8);
    db.exec(`UPDATE MatchTeamfightPlayers SET Damage=NULL,GoldDelta=NULL,
      SourceJson=json_remove(SourceJson,'$.buybacks','$.healing') WHERE MatchId=1 AND PlayerId=2`);
    const partial=reporting.fights(1).fights[0];
    assert.equal(partial.goldEdge,null);assert.equal(partial.totals[0].damage,null);
    assert.equal(partial.totals[0].healing,null);assert.equal(partial.totals[0].buybacks,null);
    assert.ok(partial.players.filter(p=>p.teamSide===0).every(p=>p.damageShare===null));
    assert.equal(partial.deathEdge,3,'missing economy data cannot erase recorded deaths');
    db.exec('DELETE FROM MatchTeamfightPlayers WHERE MatchId=1 AND PlayerId=1');
    assert.equal(reporting.fights(1).fights[0].deathEdge,null,'four records cannot stand in for a complete team');
  }finally{db.close();}
});

test('fight objective context respects window bounds, the next fight, match end and denied structures',()=>{
  const {db,reporting}=fixture();
  try {
    const insert=db.prepare(`INSERT INTO MatchObjectives(MatchId,EventIndex,TimeSeconds,Type,TeamSide,Target,SourceJson) VALUES(1,?,?,?,? ,?,'{}')`);
    insert.run(10,440,'building_kill',0,'npc_dota_badguys_tower2_mid');
    insert.run(11,450,'building_kill',1,'npc_dota_badguys_tower2_top'); // denied
    insert.run(12,500,'CHAT_MESSAGE_ROSHAN_KILL',0,null);
    insert.run(13,520,'CHAT_MESSAGE_AEGIS',0,null);
    insert.run(14,541,'building_kill',0,'npc_dota_badguys_tower3_mid');
    let fight=reporting.fights(1).fights[0];
    assert.equal(fight.objectives.available,true);
    assert.deepEqual(fight.objectives.during.map(o=>o.index),[10]);
    assert.deepEqual(fight.objectives.after.map(o=>o.index),[12,13]);
    assert.equal(fight.objectives.afterSeconds,90);
    db.exec(`INSERT INTO MatchTeamfights VALUES(1,1,520,550,'{}')`);
    fight=reporting.fights(1).fights[0];
    assert.deepEqual(fight.objectives.after.map(o=>o.index),[12]);
    assert.equal(fight.objectives.afterSeconds,70);
    db.exec('UPDATE MatchTeam SET Duration=510 WHERE MatchId=1');
    assert.equal(reporting.fights(1).fights[0].objectives.afterSeconds,60);
    db.exec('UPDATE MatchTeamfights SET EndSeconds=NULL WHERE MatchId=1 AND FightIndex=0');
    const missing=reporting.fights(1).fights[0];
    assert.equal(missing.duration,null);assert.deepEqual(missing.objectives.during,[]);assert.deepEqual(missing.objectives.after,[]);
    assert.equal(missing.objectives.afterSeconds,null);
    db.exec(`UPDATE MatchIngestionState SET SectionsJson=json_set(SectionsJson,'$.objectives.available',json('false')) WHERE MatchId=1`);
    assert.equal(reporting.fights(1).fights[0].objectives.available,false,'unavailable objective data must not imply no objectives gained');
  }finally{db.close();}
});

test('all-player inventories keep each source inventory with its player and expose no private source fields',()=>{
  const {db,reporting}=fixture();
  try {
    const report=reporting.inventories(1);
    assert.equal(report.available,true);assert.equal(report.players.length,10);
    for (const player of report.players) {
      assert.equal(player.inventory.items[0],179+player.playerId);
      assert.deepEqual(player.inventory.items.slice(1,3),[0,null]);
      assert.equal(player.inventory.backpack.length,3);assert.equal(player.inventory.neutral,null);
      assert.deepEqual(player.inventory,reporting.playerMatch(1,player.playerId).inventory);
    }
    assert.doesNotMatch(JSON.stringify(report),/rank_tier|mmr_estimate|99999/);
    assert.equal(reporting.inventories(999),null);
    assert.equal(reporting.inventories(3).available,false);
    assert.ok(reporting.inventories(3).players.every(p=>p.inventory===null));
    db.exec('DELETE FROM MatchSourceResponses WHERE MatchId=1');
    assert.ok(reporting.inventories(1).players.every(p=>p.inventory===null));
  }finally{db.close();}
});

test('death events use recorded victims, put icons opposite their own side and do not expose the source archive',()=>{
  const {db,reporting}=fixture();
  try {
    db.exec("UPDATE HeroInfo SET HeroName='Wraith King' WHERE HeroId=6");
    const source=JSON.parse(gunzipSync(db.prepare('SELECT GameplayData FROM MatchSourceResponses WHERE MatchId=1').get().GameplayData));
    source.players[0].kills_log=[{time:30,key:'npc_dota_hero_skeleton_king'},
      {time:30,key:'npc_dota_hero_hero_7'},{time:-1,key:'npc_dota_hero_skeleton_king'},
      {time:1900,key:'npc_dota_hero_skeleton_king'},{time:45,key:'npc_dota_creep_badguys_melee'}];
    source.players[5].kills_log=[{time:60,key:'npc_dota_hero_hero_1'}];
    source.players[0].rank_tier=99;
    db.prepare('UPDATE MatchSourceResponses SET GameplayData=? WHERE MatchId=1').run(gzipSync(JSON.stringify(source)));
    const report=reporting.events(1);
    assert.equal(report.available,true);assert.equal(report.deaths.length,3);
    assert.deepEqual(report.deaths.map(e=>e.time),[30,30,60]);
    assert.equal(report.deaths[0].heroId,6);assert.equal(report.deaths[0].playerId,6);
    assert.equal(report.deaths[0].victimSide,1);assert.equal(report.deaths[0].teamSide,0);
    assert.equal(report.deaths[2].heroId,1);assert.equal(report.deaths[2].victimSide,0);assert.equal(report.deaths[2].teamSide,1);
    assert.equal(new Set(report.deaths.map(e=>e.index)).size,3,'simultaneous kills remain separate');
    assert.doesNotMatch(JSON.stringify(report),/rank_tier|mmr_estimate|kills_log/);
    assert.deepEqual(reporting.events(2),{available:false,deaths:[]});
    assert.deepEqual(reporting.events(3),{available:false,deaths:[]});
    assert.equal(reporting.events(999),null);
    db.exec('DELETE FROM MatchSourceResponses WHERE MatchId=1');
    assert.deepEqual(reporting.events(1),{available:false,deaths:[]});
  }finally{db.close();}
});

test('draft context uses prior season games, deduplicates records and keeps ban experience on the opposing side',()=>{
  const {db,reporting}=fixture();
  try {
    db.exec(`INSERT INTO PickInfo VALUES(1,0,1,0,1),(1,0,1,0,1),(2,0,1,0,1),(2,0,1,0,1),(2,1,1,1,0);
      INSERT INTO MatchPlayer SELECT * FROM MatchPlayer WHERE MatchId=1 AND PlayerId=1;
      INSERT INTO MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,SeriesId,Duration,StartTimeUtc)
        SELECT 0,100,200,100,0,1800,StartTimeUtc+3600 FROM MatchTeam WHERE MatchId=2;
      INSERT INTO MatchLeague VALUES(0,20,NULL);`);
    const report=reporting.draft(2,{beforeMatch:true});
    assert.equal(report.history.games,1,'current/later games, other seasons and a lower ID with a later kickoff are excluded');
    assert.equal(report.entries.length,2,'duplicate draft actions do not inflate the display');
    assert.equal(report.teams[0].players.length,5);
    const player=report.teams[0].players.find(p=>p.playerId===1);
    assert.equal(player.pickOrder,1);
    assert.deepEqual(player.familiarity,{games:1,resolvedGames:1,wins:1,bans:0,winRate:100});
    assert.equal(player.leagueHero.games,1,'duplicate player rows do not inflate hero picks');
    assert.equal(player.leagueHero.bans,1,'duplicate bans count only once per historical match');
    assert.deepEqual(report.bans[0].opponents.map(p=>p.playerId),[1]);
    assert.equal(report.bans[0].opponents[0].games,1);
    assert.equal(reporting.draft(999),null);
    assert.doesNotMatch(JSON.stringify(report),/rank_tier|mmr_estimate|99999/);
    db.exec('UPDATE MatchTeam SET WinnerId=999 WHERE MatchId=1');
    const unresolved=reporting.draft(2,{beforeMatch:true}).teams[0].players.find(p=>p.playerId===1).familiarity;
    assert.equal(unresolved.games,1);assert.equal(unresolved.resolvedGames,0);assert.equal(unresolved.winRate,null);
    db.exec('UPDATE MatchTeam SET PatchId=NULL WHERE MatchId=1');
    assert.equal(reporting.draft(2,{samePatch:true,beforeMatch:true}).history.games,0,'unknown patches cannot enter same-patch comparisons');
    assert.equal(reporting.draft(2,{beforeMatch:true}).history.games,1,'season context still includes legacy games');
    db.exec('UPDATE MatchTeam SET StartTimeUtc=NULL WHERE MatchId=1');
    assert.equal(reporting.draft(2,{beforeMatch:true}).history.usesMatchOrder,true);
    db.exec('UPDATE MatchTeam SET Rehost=1 WHERE MatchId=1');
    assert.equal(reporting.draft(2,{beforeMatch:true}).history.games,0,'superseded remakes do not contribute');
  }finally{db.close();}
});

test('draft phases follow recorded blocks across formats and reject missing or conflicting actions',()=>{
  for (const blocks of [[4,4,4,4,2,2],[7,2,3,6,4,2]]) {
    const entries=[];
    blocks.forEach((count, block)=>{for(let i=0;i<count;i++) entries.push({OrderNum:entries.length,HeroId:entries.length+1,IsPick:block%2,Team:entries.length%2});});
    const report=draftPhases([...entries,entries[0]]);
    assert.equal(report.complete,true);
    assert.equal(report.entries.length,blocks.reduce((sum,n)=>sum+n,0));
    let offset=0;
    blocks.forEach((count,block)=>{
      assert.ok(report.entries.slice(offset,offset+count).every(e=>e.phase===`${block%2?'Pick':'Ban'} phase ${Math.floor(block/2)+1}`));offset+=count;
    });
    assert.equal(draftPhases(entries.filter(e=>e.OrderNum!==2)).complete,false);
    assert.ok(draftPhases([...entries,{...entries[0],HeroId:99}]).entries.every(e=>e.phase===null));
  }
});

test('draft frequencies use complete earlier drafts and keep overall and phase denominators separate',()=>{
  const {db,reporting}=fixture();
  try {
    for(let hero=11;hero<=20;hero++)db.prepare('INSERT INTO HeroInfo VALUES(?,?)').run(hero,`Hero ${hero}`);
    const insert=db.prepare('INSERT INTO PickInfo VALUES(?,?,?,?,?)');
    let order=0;
    for(const [block,count] of [4,4,4,4,2,2].entries())for(let i=0;i<count;i++){
      for(const matchId of [1,2])insert.run(matchId,block%2,order+1,order,order%2);
      order++;
    }
    insert.run(1,0,1,0,0); // exact duplicate does not add a sample
    const report=reporting.draft(2,{beforeMatch:true});
    assert.equal(report.history.completeDrafts,1);
    assert.equal(report.history.phasesAvailable,true);
    const ban=report.entries.find(e=>e.HeroId===1),pick=report.entries.find(e=>e.HeroId===5);
    assert.equal(ban.phase,'Ban phase 1');assert.equal(pick.phase,'Pick phase 1');
    assert.deepEqual([ban.frequency.pickRate,ban.frequency.banRate,ban.frequency.contestRate,ban.frequency.phaseRate],[100,100,100,100]);
    assert.equal(report.bans[0].frequency.contestRate,100,'ban context shares the league contest rate and denominator');
    assert.equal(report.bans[0].frequency.games,1);
    assert.deepEqual([pick.frequency.pickRate,pick.frequency.banRate,pick.frequency.phaseCount,pick.frequency.phaseGames],[100,0,1,1]);
    assert.equal(reporting.draft(1,{beforeMatch:true}).entries[0].frequency.pickRate,null,'no history is unavailable rather than 0%');
    db.exec('DELETE FROM PickInfo WHERE MatchId=1 AND OrderNum=2');
    const incomplete=reporting.draft(2,{beforeMatch:true});
    assert.equal(incomplete.history.games,1);assert.equal(incomplete.history.completeDrafts,0);
    assert.equal(incomplete.entries[0].frequency.banRate,null,'partial drafts cannot dilute frequency denominators');
    assert.equal(incomplete.bans[0].frequency.picks,1,'actual played picks remain available without a complete draft');
    assert.equal(incomplete.bans[0].frequency.pickGames,1);assert.equal(incomplete.bans[0].frequency.pickRate,100);
    assert.equal(incomplete.bans[0].frequency.contestRate,null,'missing drafts cannot become zero contest outcomes');
    assert.equal(incomplete.bans[0].leagueHero.games,1,'played-game WR samples remain available independently of draft completeness');
  }finally{db.close();}
});

test('played games without drafts count toward picks while contest and phase samples remain separate',()=>{
  const {db,reporting}=fixture();
  try {
    for(let hero=11;hero<=20;hero++)db.prepare('INSERT INTO HeroInfo VALUES(?,?)').run(hero,`Hero ${hero}`);
    const insert=db.prepare('INSERT INTO PickInfo VALUES(2,?,?,?,?)');let order=0;
    for(const [block,count] of [4,4,4,4,2,2].entries())for(let i=0;i<count;i++){
      insert.run(block%2,order+1,order,order%2);order++;
    }
    const report=reporting.draft(2),hero=report.entries[0].frequency;
    assert.equal(report.history.playedGames,2);assert.equal(report.history.completeDrafts,1);
    assert.equal(hero.picks,2);assert.equal(hero.pickGames,2);assert.equal(hero.pickRate,100);
    assert.equal(hero.bans,1);assert.equal(hero.games,1);assert.equal(hero.banRate,100);
    assert.equal(hero.contestCount,1);assert.equal(hero.contestRate,100,'contest never mixes played picks with a smaller draft sample');
    assert.equal(hero.phaseGames,1);
    const withoutDraft=reporting.draft(1);
    assert.equal(withoutDraft.history.playedLineupOnly,true);
    assert.equal(withoutDraft.entries.length,10);
    assert.equal(withoutDraft.bans.length,0,'missing bans are not invented');
    assert.ok(withoutDraft.entries.every(e=>e.IsPick===1&&e.OrderNum===null&&e.phase===null));
    assert.ok(withoutDraft.entries.every(e=>e.frequency.phaseRate===null));
    db.exec('DELETE FROM MatchPlayer WHERE MatchId=1 AND PlayerId=10');
    const partial=reporting.draft(2);
    assert.equal(partial.history.playedGames,1,'unknown league lineups cannot be treated as known hero absences');
    assert.equal(partial.entries[0].frequency.picks,1);
    assert.equal(partial.entries[0].teamFrequency.pickGames,2,'a complete known team lineup remains usable independently');
  }finally{db.close();}
});

test('team draft frequencies follow team identity across sides and exclude opponent and unrelated-team actions',()=>{
  const {db,reporting}=fixture();
  try {
    for(let hero=11;hero<=20;hero++)db.prepare('INSERT INTO HeroInfo VALUES(?,?)').run(hero,`Hero ${hero}`);
    db.exec(`INSERT INTO TeamInfo(TeamId,TeamName) VALUES(300,'Other Radiant'),(400,'Other Dire');
      INSERT INTO MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,SeriesId,Duration) VALUES(0,300,400,300,0,1800);
      INSERT INTO MatchLeague VALUES(0,20,NULL);`);
    const insert=db.prepare('INSERT INTO PickInfo VALUES(?,?,?,?,?)');let order=0;
    for(const [block,count] of [4,4,4,4,2,2].entries())for(let i=0;i<count;i++){
      for(const matchId of [0,1,2])insert.run(matchId,block%2,order+1,order,order%2);order++;
    }
    let entry=reporting.draft(2,{beforeMatch:true}).entries[0];
    assert.equal(entry.frequency.games,2);assert.equal(entry.frequency.bans,2);
    assert.equal(entry.teamFrequency.teamId,100);assert.equal(entry.teamFrequency.games,1);
    assert.equal(entry.teamFrequency.bans,1);assert.equal(entry.teamFrequency.banRate,100);
    assert.equal(entry.opponentPickFrequency.teamId,200);assert.equal(entry.opponentPickFrequency.games,1);
    assert.equal(entry.opponentPickFrequency.picks,0);
    db.exec(`UPDATE MatchPlayer SET HeroId=CASE WHEN HeroId=1 THEN 6 WHEN HeroId=6 THEN 1 ELSE HeroId END WHERE MatchId=1`);
    entry=reporting.draft(2,{beforeMatch:true}).entries[0];
    assert.equal(entry.opponentPickFrequency.picks,1);assert.equal(entry.opponentPickFrequency.pickRate,100);
    assert.equal(entry.teamFrequency.bans,1,'played lineups do not overwrite recorded bans');
    db.exec(`UPDATE MatchPlayer SET HeroId=CASE WHEN HeroId=1 THEN 6 WHEN HeroId=6 THEN 1 ELSE HeroId END WHERE MatchId=1`);
    db.exec('UPDATE MatchTeam SET TeamRad=200,TeamDire=100 WHERE MatchId=1');
    entry=reporting.draft(2,{beforeMatch:true}).entries[0];
    assert.equal(entry.teamFrequency.teamId,100);assert.equal(entry.teamFrequency.games,1);
    assert.equal(entry.teamFrequency.bans,0,'a ban by the opposing team is not credited to this team');
    assert.equal(entry.teamFrequency.banRate,0);assert.equal(entry.frequency.banRate,100);
    assert.equal(entry.teamFrequency.phaseGames,1);assert.equal(entry.teamFrequency.phaseCount,0);
    assert.equal(entry.teamFrequency.phaseRate,0);
    const opposite=reporting.draft(2,{beforeMatch:true}).entries[1];
    assert.equal(opposite.teamFrequency.teamId,200);assert.equal(opposite.teamFrequency.bans,0);
    db.exec('UPDATE MatchTeam SET TeamRad=999 WHERE MatchId=2');
    entry=reporting.draft(2,{beforeMatch:true}).entries[0];
    assert.equal(entry.teamFrequency.games,0);assert.equal(entry.teamFrequency.pickRate,null);
    assert.equal(entry.teamFrequency.banRate,null);assert.equal(entry.teamFrequency.phaseRate,null);
    assert.equal(reporting.draft(2,{beforeMatch:true}).entries[1].opponentPickFrequency.pickRate,null,'opponent without history is unavailable, not 0%');
    assert.equal(reporting.draft(2,{beforeMatch:true}).entries.find(e=>e.IsPick===1).opponentPickFrequency,null);
  }finally{db.close();}
});

test('draft history defaults to full season and switches independently to before-match history',()=>{
  const {db,reporting}=fixture();
  try {
    const full=reporting.draft(1);
    assert.equal(full.history.beforeMatch,false);
    assert.equal(full.history.games,2,'full season includes current and later games, excluding other seasons');
    assert.equal(full.teams[0].players[0].familiarity.games,2);
    assert.equal(full.history.usesMatchOrder,false);
    const before=reporting.draft(1,{beforeMatch:true});
    assert.equal(before.history.beforeMatch,true);assert.equal(before.history.games,0);
    assert.equal(before.teams[0].players[0].familiarity.games,0);
    assert.equal(reporting.draft(1),full,'full-season and before-match caches remain separate');
    const patch=reporting.draft(1,{samePatch:true});
    assert.equal(patch.history.beforeMatch,false);assert.equal(patch.history.samePatch,true);
    assert.ok(patch.history.games>0);
    const views=reporting.draftViews(1);
    assert.deepEqual(views.season.full,full);
    assert.deepEqual(views.season.before,before);
    assert.deepEqual(views.patch.full,patch);
    assert.equal(views.patch.before.history.beforeMatch,true);
    assert.equal(views.patch.before.history.samePatch,true);
    assert.equal(reporting.draftViews(999),null);
    db.exec('UPDATE MatchTeam SET PatchId=NULL WHERE MatchId=1');
    assert.equal(reporting.draftViews(1).patch,null,'unknown patch does not preload a misleading patch view');
  }finally{db.close();}
});

test('expanded hero reporting preserves played picks without drafts and uses first purchases within the played match',()=>{
  const {db}=fixture(),reporting=new ExpandedPerformanceReporting(db);
  try {
    let order=0;const insert=db.prepare('INSERT INTO PickInfo VALUES(1,?,?,?,?)');
    for(let hero=11;hero<=15;hero++)insert.run(0,hero,order++,hero%2);
    for(let hero=1;hero<=10;hero++)insert.run(1,hero,order++,hero<=5?0:1);
    for(let hero=16;hero<=20;hero++)insert.run(0,hero,order++,hero%2);
    db.exec(`INSERT INTO MatchPlayerPurchases VALUES(1,1,10,600,'blink'),(1,1,11,1200,'blink'),
      (2,1,10,300,'blink'),(2,1,11,900,'blink'),(1,2,12,30,'blink'),
      (1,1,13,-60,'boots'),(1,1,14,2000,'heart'),(1,1,15,500,'recipe_blink');`);
    const hero=reporting.heroPerformance(1);
    assert.deepEqual(hero.coverage,{total:3,enriched:2});
    assert.equal(hero.draft.picks,3);assert.equal(hero.draft.playedGames,3);assert.equal(hero.draft.completeDrafts,1);
    assert.equal(hero.draft.pickRate.value,100);assert.equal(hero.draft.contestRate.value,100);
    assert.equal(hero.draft.phases[0].picks,1);
    assert.deepEqual(hero.items.find(i=>i.key==='blink').timing,{value:450,samples:2},'repeated purchases and other players do not affect the timing sample');
    assert.equal(hero.items.find(i=>i.key==='blink').games,2);
    assert.ok(!hero.items.some(i=>['boots','heart','recipe_blink'].includes(i.key)));
    assert.equal('summary' in hero,false,'role-mixed hero summary metrics are omitted');
    assert.equal('percentiles' in hero,false,'heroes are not compared to other heroes');
    assert.deepEqual(hero.players[0].gold10,{value:1000,samples:1});
    assert.equal(hero.players[0].percentiles.gold10.value,null,'insufficient games cannot yield a percentile');
    assert.equal(hero.players[0].games,2);
    assert.equal(reporting.heroPerformance(9999),null);
    assert.deepEqual(reporting.heroPerformance(1,{leagueId:21}).coverage,{total:1,enriched:0});
    assert.equal(reporting.heroPerformance(1,{patchId:9999}).record.games,0);
    assert.doesNotMatch(JSON.stringify(hero),/rank_tier|mmr_estimate|99999/);
  }finally{db.close();}
});

test('expanded league reports filter stages, separate stand-ins, require real checkpoint coverage and keep unknown stages explicit',()=>{
  const {db}=fixture(),reporting=new ExpandedPerformanceReporting(db);
  try {
    db.exec(`INSERT INTO LeagueStageBoundaries VALUES(20,1,1);
      UPDATE MatchPlayer SET PlayerSlot=CASE PlayerId WHEN 1 THEN 128 WHEN 6 THEN 0 ELSE PlayerSlot END WHERE MatchId=2;
      UPDATE MatchTeam SET Duration=2400 WHERE MatchId=1;
      INSERT INTO MatchTeamTimeline VALUES(1,1800,-11000,-1000),(1,2400,500,1000);`);
    const league=reporting.leaguePerformance(20);
    assert.deepEqual(league.coverage,{total:2,enriched:2});
    assert.equal(league.players.filter(p=>p.playerId===1).length,2,'a stand-in appearance belongs to its own team record');
    assert.deepEqual(league.players.filter(p=>p.playerId===1).map(p=>p.games),[1,1]);
    assert.equal(league.teams.find(t=>t.teamId===100).gold30.value,-11000);
    assert.equal(league.teams.find(t=>t.teamId===200).gold30.value,11000);
    assert.equal(league.notable.comebacks[0].matchId,1);
    assert.equal(league.notable.closest[0].finalLead,500);
    assert.equal(reporting.leaguePerformance(20,{stage:'regular'}).coverage.total,1);
    assert.equal(reporting.leaguePerformance(20,{stage:'playoffs'}).coverage.total,1);
    assert.equal(reporting.leaguePerformance(20,{stage:'tiebreakers'}).coverage.total,0);
    assert.equal(reporting.leaguePerformance(21).unknownStages,1);
    db.exec(`INSERT INTO SeriesInfo(SeriesId,Team1,Team2,LeagueId,Stage) VALUES(1,100,200,20,'Tiebreakers');
      INSERT INTO SeriesMatch(SeriesId,MatchId) VALUES(1,2);`);
    assert.equal(reporting.leaguePerformance(20,{stage:'tiebreakers'}).coverage.total,1,'explicit series stage takes priority');
    assert.equal(reporting.leaguePerformance(20,{stage:'playoffs'}).coverage.total,0);
    db.exec(`INSERT INTO SeriesInfo(SeriesId,Team1,Team2,LeagueId,Stage) VALUES(2,100,200,20,'Playoffs');
      INSERT INTO SeriesMatch(SeriesId,MatchId) VALUES(2,2);`);
    assert.equal(reporting.leaguePerformance(20,{stage:'unknown'}).coverage.total,1,'contradictory stages are not guessed');
    assert.equal(reporting.leaguePerformance(999),null);
    assert.equal(reporting.leaguePerformance(20,{patchId:999}).coverage.total,0);
  }finally{db.close();}
});

test('hero players compare only to players on that hero while league player/team pools and corrected data stay current',()=>{
  const {db}=fixture(),reporting=new ExpandedPerformanceReporting(db);
  try {
    for(const matchId of [4,5,6,7]) {
      for(const table of ['MatchTeam','MatchLeague','MatchPlayer','MatchTeamPlayer','MatchPlayerTimeline','MatchTeamTimeline','MatchIngestionState']) {
        const columns=db.pragma(`table_info(${table})`).map(c=>c.name).filter(name=>name!=='UID');
        db.prepare(`INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.map(c=>c==='MatchId'?'?':c).join(',')} FROM ${table} WHERE MatchId=1`).run(matchId);
      }
    }
    const hero=reporting.heroPerformance(1,{leagueId:20});
    const player=hero.players.find(p=>p.playerId===1);
    assert.equal(player.percentiles.lh10.entities,1,'other heroes do not enter the comparison pool');
    assert.equal(player.percentiles.lh10.value,null,'one qualifying player cannot be ranked');
    assert.equal(player.percentiles.lh10.entity,'players');
    assert.equal(reporting.heroPerformance(1,{leagueId:20}),hero);
    const league=reporting.leaguePerformance(20);
    assert.equal(league.players[0].percentiles.gold10.entity,'players');
    assert.equal(league.players[0].percentiles.gold10.entities,10);
    assert.equal(league.teams.find(t=>t.teamId===100).percentiles.gold10.value,75);
    db.exec('UPDATE MatchPlayerTimeline SET Gold=Gold+1000 WHERE PlayerId=1');
    const changed=reporting.heroPerformance(1,{leagueId:20});
    assert.notEqual(changed,hero);assert.ok(changed.players.find(p=>p.playerId===1).gold10.value>player.gold10.value);
    assert.equal(changed.players.find(p=>p.playerId===1).percentiles.gold10.entities,1);
  }finally{db.close();}
});

test('cached reports are refreshed after database edits and expiry',()=>{
  const {db}=fixture();let now=0;
  try{
    const reporting=new WarehouseReporting(db,{now:()=>now,ttl:100});
    const first=reporting.performance('player',1);assert.equal(reporting.performance('player',1),first);
    db.exec('UPDATE MatchPlayer SET HeroDamage=2000 WHERE MatchId=1 AND PlayerId=1');
    const updated=reporting.performance('player',1);assert.notEqual(updated,first);
    assert.ok(updated.summary.damagePerMinute.value>first.summary.damagePerMinute.value);
    now=101;assert.notEqual(reporting.performance('player',1),updated);
  }finally{db.close();}
});

test('public reporting API validates identifiers and filters and supports legacy matches without external requests',async()=>{
  const {db}=fixture(),app=express();app.use('/api',createWarehouseReportingRouter(db));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  try{
    for(const url of ['/matches/no/analysis','/matches/0/analysis/fights','/matches/1/analysis/draft?scope=bad','/matches/1/analysis/draft?period=bad','/player/1/performance?patchId=bad','/teams/1/performance?leagueId=-1',
      '/hero/1/performance?stage=bad','/leagues/20/performance?patchId=bad']){
      assert.equal((await fetch(base+url)).status,400,url);
    }
    assert.equal((await fetch(base+'/matches/999/analysis')).status,404);
    assert.equal((await fetch(base+'/hero/99999/performance')).status,404);
    assert.equal((await fetch(base+'/leagues/99999/performance')).status,404);
    assert.equal((await fetch(base+'/hero/1/performance')).status,200);
    assert.equal((await fetch(base+'/leagues/20/performance')).status,200);
    assert.equal((await fetch(base+'/matches/999/analysis/inventories')).status,404);
    assert.equal((await fetch(base+'/matches/999/analysis/events')).status,404);
    assert.equal((await fetch(base+'/matches/999/analysis/draft')).status,404);
    assert.equal((await fetch(base+'/matches/999/analysis/draft/views')).status,404);
    const views=await (await fetch(base+'/matches/1/analysis/draft/views')).json();
    assert.equal(views.season.full.history.games,2);assert.equal(views.season.before.history.games,0);
    assert.equal((await (await fetch(base+'/matches/1/analysis/draft')).json()).history.games,2);
    assert.equal((await (await fetch(base+'/matches/1/analysis/draft?period=before')).json()).history.games,0);
    assert.equal((await fetch(base+'/matches/3/analysis/draft')).status,200,'legacy matches can show draft context without enrichment');
    assert.deepEqual(await (await fetch(base+'/matches/3/analysis/events')).json(),{available:false,deaths:[]});
    const inventories=await (await fetch(base+'/matches/1/analysis/inventories')).json();
    assert.equal(inventories.players.length,10);
    assert.equal((await fetch(base+'/matches/1/analysis/players/999')).status,404);
    assert.equal((await fetch(base+'/matches/3/analysis')).status,200);
    const report=await (await fetch(base+'/player/1/performance?leagueId=20')).json();
    assert.deepEqual(report.coverage,{total:2,enriched:2});
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
});
