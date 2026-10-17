import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeWarehouse, ingestWarehouseMatch, readGameplaySnapshot } from '../config/warehouseIngestion.js';
import { captureWarehouseBaseline, compareWarehouseBaseline, validateWarehouse } from '../config/warehouseValidation.js';
import { runWarehouseBackfill, planWarehouseBackfill } from '../config/warehouseBackfill.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../scripts/db/ladsData.schema.sql', import.meta.url), 'utf8'));
  db.pragma('foreign_keys=ON');
  db.exec(`INSERT INTO LeagueInfo VALUES(17,'Season 17',0),(18,'Season 18',0);
    INSERT INTO TeamInfo(TeamId,TeamName) VALUES(100,'Corrected Radiant'),(200,'Corrected Dire');
    INSERT INTO MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,SeriesId,Duration) VALUES(1,100,200,200,55,600),(2,100,200,100,56,600);
    INSERT INTO MatchLeague VALUES(1,17,'2024-01-01'),(2,18,'2024-01-02');
    INSERT INTO SeriesInfo(SeriesId,Team1,Team2,LeagueId,Stage,DateCreated) VALUES(55,100,200,17,'g','2024-01-01');
    INSERT INTO SeriesMatch(SeriesId,MatchId) VALUES(55,1);
    INSERT INTO PickInfo VALUES(1,1,1,0,0),(1,1,1,0,0);
    INSERT INTO PlayerInfo(PlayerId,PlayerName) VALUES(1,'Existing name');`);
  for (let id=1;id<=10;id++) db.prepare('INSERT INTO HeroInfo VALUES(?,?)').run(id, `Hero ${id}`);
  for (let id=1;id<=3;id++) db.prepare(`INSERT INTO MatchPlayer(MatchId,PlayerId,HeroId,Kills,Deaths,Assists,Lasthits,GPM,XPM)
    VALUES(1,?,?,99,0,0,0,0,0)`).run(id,id);
  // Simulate the old editor assigning every membership to the same team, plus duplicates.
  for (let id=1;id<=10;id++) db.prepare('INSERT INTO MatchTeamPlayer(MatchId,PlayerId,TeamId) VALUES(1,?,200),(1,?,200)').run(id,id);
  initializeWarehouse(db);
  return db;
}
function payload(id=1) {
  return { match_id:id, duration:1200, start_time:1735689600, radiant_win:true, version:22,
    radiant_team_id:900, dire_team_id:901, radiant_score:30, dire_score:20,
    radiant_gold_adv:[0,100],radiant_xp_adv:[0,200],objectives:[],teamfights:[],
    picks_bans:[{is_pick:true,hero_id:1,order:0,team:0},{is_pick:false,hero_id:2,order:1,team:1}],
    players:Array.from({length:10},(_,i)=>({account_id:i+1,hero_id:i+1,player_slot:i<5?i:128+i-5,
      personaname:`Source name ${i+1}`,kills:3,deaths:2,assists:4,net_worth:10000,last_hits:100,
      gold_per_min:500,xp_per_min:600,hero_damage:20000,hero_healing:0,tower_damage:1000,
      times:[0],gold_t:[0],xp_t:[0],lh_t:[0],purchase_log:[],obs_placed:0})) };
}

test('a richer source refreshes the whole core record atomically, using corrected teams and preserving league/series metadata',()=>{
  const db=fixture();
  try {
    const baseline=captureWarehouseBaseline(db),result=ingestWarehouseMatch(db,payload(),{repairIncomplete:true});
    assert.equal(result.repair.beforePlayers,3);assert.equal(result.status,'ready');
    assert.deepEqual(db.prepare('SELECT TeamRad,TeamDire,WinnerId,Duration,SeriesId FROM MatchTeam WHERE MatchId=1').get(),
      {TeamRad:100,TeamDire:200,WinnerId:100,Duration:1200,SeriesId:55});
    const rows=db.prepare('SELECT * FROM MatchPlayer WHERE MatchId=1 ORDER BY PlayerId').all();
    assert.equal(rows.length,10);assert.equal(rows[0].Kills,3);assert.equal(rows[0].Winner,1);assert.equal(rows[9].Winner,0);
    assert.deepEqual(db.prepare('SELECT TeamId,COUNT(*) n FROM MatchTeamPlayer WHERE MatchId=1 GROUP BY TeamId ORDER BY TeamId').all(),
      [{TeamId:100,n:5},{TeamId:200,n:5}]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM PickInfo WHERE MatchId=1').get().n,2);
    assert.equal(db.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=1').get().PlayerName,'Existing name');
    assert.equal(db.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=10').get().PlayerName,'Source name 10');
    assert.equal(db.prepare('SELECT DatePlayed FROM MatchLeague WHERE MatchId=1').get().DatePlayed,'2024-01-01');
    assert.equal(db.prepare('SELECT SeriesId FROM SeriesMatch WHERE MatchId=1').get().SeriesId,55);
    assert.equal(compareWarehouseBaseline(db,baseline).unchanged,false);
    assert.equal(compareWarehouseBaseline(db,baseline,{repairs:[result.repair]}).unchanged,true);
    assert.equal(validateWarehouse(db,{deep:true}).valid,true);assert.deepEqual(db.pragma('foreign_key_check'),[]);
    assert.equal(ingestWarehouseMatch(db,payload(),{repairIncomplete:true}).repair,undefined,'equal completeness is not a repair');
  } finally {db.close();}
});

test('repair validation still detects unrelated writes, edits to repaired rows, and deletion of newly inserted rows',()=>{
  for (const sql of ['UPDATE MatchTeam SET Duration=999 WHERE MatchId=2',
    'UPDATE MatchTeam SET TeamRad=999 WHERE MatchId=1', 'DELETE FROM MatchPlayer WHERE MatchId=1 AND PlayerId=10',
    "UPDATE PlayerInfo SET PlayerName='Changed elsewhere' WHERE PlayerId=10"]){
    const db=fixture();
    try {
      const baseline=captureWarehouseBaseline(db),result=ingestWarehouseMatch(db,payload(),{repairIncomplete:true});
      assert.equal(compareWarehouseBaseline(db,baseline,{repairs:[result.repair]}).unchanged,true);
      db.exec(sql);
      assert.equal(compareWarehouseBaseline(db,baseline,{repairs:[result.repair]}).unchanged,false,sql);
    } finally {db.close();}
  }
});

test('malformed responses never repair core records, and a failure after core writes rolls the whole repair back',()=>{
  for(const kind of ['partialStats','duplicateSlot','duplicateHero','missingPlayer','writeFailure']){
    const db=fixture();
    try {
      const baseline=captureWarehouseBaseline(db),data=payload();
      if(kind==='partialStats')delete data.players[0].kills;
      if(kind==='duplicateSlot')data.players[1].player_slot=0;
      if(kind==='duplicateHero')data.players[1].hero_id=1;
      if(kind==='missingPlayer')data.players.pop();
      if(kind==='writeFailure')db.exec(`CREATE TRIGGER fail_repair BEFORE INSERT ON MatchSourceResponses BEGIN SELECT RAISE(ABORT,'test failure'); END;`);
      assert.throws(()=>ingestWarehouseMatch(db,data,{repairIncomplete:true}));
      assert.equal(compareWarehouseBaseline(db,baseline).unchanged,true,kind);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchPlayer WHERE MatchId=1').get().n,3);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM PlayerInfo').get().n,1);
    }finally{db.close();}
  }
});

test('repairs retain richer optional stats and parsed sections while refreshing newly available core fields',()=>{
  const db=fixture();
  try{
    ingestWarehouseMatch(db,payload(),{repairIncomplete:true});
    const data=payload();
    db.exec('UPDATE MatchPlayer SET Networth=NULL WHERE MatchId=1 AND PlayerId=1');
    delete data.version;delete data.radiant_gold_adv;delete data.radiant_xp_adv;
    delete data.picks_bans;delete data.objectives;delete data.teamfights;
    for(const p of data.players){delete p.times;delete p.gold_t;delete p.xp_t;delete p.lh_t;delete p.purchase_log;}
    delete data.players[1].hero_damage;
    // Another new core field offsets the omitted source field, preserving the strict richer comparison.
    db.exec('UPDATE MatchPlayer SET Healing=NULL WHERE MatchId=1 AND PlayerId=3');
    const baseline=captureWarehouseBaseline(db);
    const result=ingestWarehouseMatch(db,data,{repairIncomplete:true});
    assert.ok(result.repair);assert.equal(result.status,'ready');
    assert.equal(db.prepare('SELECT HeroDamage FROM MatchPlayer WHERE PlayerId=2').get().HeroDamage,20000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM PickInfo').get().n,2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchPlayerTimeline').get().n,10);
    assert.equal(readGameplaySnapshot(db,1).players[0].gold_t.length,1);
    assert.equal(compareWarehouseBaseline(db,baseline,{repairs:[result.repair]}).unchanged,true);
    assert.equal(validateWarehouse(db,{deep:true}).valid,true);
  }finally{db.close();}
});

test('winner repair rebuilds standings and Neustadtl using the corrected teams',()=>{
  const db=fixture();
  try{
    db.exec(`INSERT INTO GroupNames(LeagueId,GroupId,GroupName) VALUES(17,1,'A');
      INSERT INTO LeagueGroups(LeagueId,TeamId,GroupId) VALUES(17,100,1),(17,200,1);
      INSERT INTO LeagueStandings(LeagueId,TeamId,Wins,Losses) VALUES(17,100,0,1),(17,200,1,0);
      INSERT INTO Neustadtl(LeagueId,TeamId,Score) VALUES(17,100,0),(17,200,0);`);
    const before=captureWarehouseBaseline(db),result=ingestWarehouseMatch(db,payload(),{repairIncomplete:true});
    assert.deepEqual(db.prepare('SELECT TeamId,Wins,Losses FROM LeagueStandings ORDER BY TeamId').all(),
      [{TeamId:100,Wins:1,Losses:0},{TeamId:200,Wins:0,Losses:1}]);
    assert.equal(compareWarehouseBaseline(db,before,{repairs:[result.repair]}).unchanged,true);
  }finally{db.close();}
});

test('batch repair retries fresh participant conflicts, respects request accounting, validates repairs and continues across seasons',async()=>{
  const db=fixture();
  try{
    assert.throws(()=>ingestWarehouseMatch(db,payload()),/conflicts/);
    const settings={leagueIds:[17,18],dailyRequestBudget:10,dailyReserve:300,seasonRetryAllowance:1,
      requestDelayMs:2000,minuteCooldownMs:120000,minuteReserve:5,maxMinuteRetries:2};
    assert.equal(planWarehouseBackfill(db,settings).seasons[0].eligibleMatches,0);
    assert.equal(planWarehouseBackfill(db,settings,{repairIncomplete:true}).seasons[0].eligibleMatches,1);
    let clock=Date.now();
    const state={day:new Date(clock).toISOString().slice(0,10),requests:0,remainingDay:null,waitUntil:0};
    const before=captureWarehouseBaseline(db),calls=[];
    const result=await runWarehouseBackfill(db,settings,{state,repairIncomplete:true,now:()=>clock,
      sleep:async ms=>{clock+=ms;},fetcher:async url=>{
        const id=Number(url.split('/').at(-1));calls.push(id);return Response.json(payload(id));
      }});
    assert.deepEqual(calls,[1,2]);assert.equal(state.requests,2);
    assert.equal(result.repairs.length,2);assert.equal(result.totals.failed,0);
    assert.equal(result.stopReason,'all selected seasons processed');
    assert.ok(result.reports.every(r=>r.reconciliation.unchanged&&r.validation.valid));
    assert.equal(compareWarehouseBaseline(db,before,{repairs:result.repairs}).unchanged,true);
    assert.equal(planWarehouseBackfill(db,settings,{repairIncomplete:true}).plannedMatchRequests,0);
  }finally{db.close();}
});

test('multiple repairs in one group reconcile their cumulative player and standings changes',()=>{
  const db=fixture();
  try{
    db.exec(`UPDATE MatchLeague SET LeagueId=17 WHERE MatchId=2;
      INSERT INTO GroupNames(LeagueId,GroupId,GroupName) VALUES(17,1,'A');
      INSERT INTO LeagueGroups(LeagueId,TeamId,GroupId) VALUES(17,100,1),(17,200,1);`);
    const before=captureWarehouseBaseline(db);
    const first=ingestWarehouseMatch(db,payload(),{repairIncomplete:true});
    const secondData=payload(2);secondData.radiant_win=false;
    const second=ingestWarehouseMatch(db,secondData,{repairIncomplete:true});
    const repairs=[first.repair,second.repair];
    assert.equal(compareWarehouseBaseline(db,before,{repairs}).unchanged,true);
    assert.deepEqual(db.prepare('SELECT TeamId,Wins,Losses FROM LeagueStandings ORDER BY TeamId').all(),
      [{TeamId:100,Wins:1,Losses:1},{TeamId:200,Wins:1,Losses:1}]);
    db.exec('UPDATE LeagueStandings SET Wins=5 WHERE TeamId=100');
    assert.equal(compareWarehouseBaseline(db,before,{repairs}).unchanged,false);
  }finally{db.close();}
});

test('repair CLI previews without requests and persists exact repairs while preserving default-mode behavior',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'lads-repair-cli-')),dbFolder=join(folder,'db');
  mkdirSync(dbFolder);
  const dbPath=join(dbFolder,'LadsData.db');
  const db=fixture();
  try{
    await db.backup(dbPath);db.close();
    const batch=join(folder,'batch.json'),mock=join(folder,'mock.mjs'),requestLog=join(folder,'requests.log');
    writeFileSync(batch,JSON.stringify({leagueIds:[17]}));
    writeFileSync(mock,`import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{
      appendFileSync(${JSON.stringify(requestLog)},'fetch\\n');return Response.json(${JSON.stringify(payload())});};`);
    const cli=fileURLToPath(new URL('../scripts/league/backfillWarehouse.js',import.meta.url));
    const run=flags=>spawnSync(process.execPath,['--import',pathToFileURL(mock).href,cli,dbPath,batch,...flags],
      {encoding:'utf8',timeout:10000});
    const preview=run(['--repair-incomplete']);assert.equal(preview.status,0,preview.stderr);
    assert.equal(existsSync(requestLog),false);assert.equal(existsSync(dbPath+'.warehouse-backfill.json'),false);
    const applied=run(['--apply','--no-backup','--repair-incomplete']);
    assert.equal(applied.status,0,applied.stdout+applied.stderr);
    const reportPath=applied.stdout.split('\n').find(line=>line.startsWith('Reports: ')).slice(9).trim();
    const summary=JSON.parse(readFileSync(join(reportPath,'summary.json'),'utf8'));
    assert.equal(summary.checksPassed,true);assert.equal(summary.repairs.length,1);
    assert.equal(JSON.parse(readFileSync(join(reportPath,'repairs.json'),'utf8')).length,1);
    assert.equal(JSON.parse(readFileSync(join(reportPath,'repairs.jsonl'),'utf8').trim()).matchId,1);
    assert.match(readFileSync(join(reportPath,'validation.md'),'utf8'),/Protected data unchanged outside recorded repairs: true/);
    assert.equal(readFileSync(requestLog,'utf8'),'fetch\n');
    const again=run(['--apply','--no-backup','--repair-incomplete']);assert.equal(again.status,0,again.stderr);
    assert.equal(readFileSync(requestLog,'utf8'),'fetch\n');
  }finally{
    if(db.open)db.close();
    const target=resolve(folder),temporary=resolve(tmpdir());
    if(!target.startsWith(temporary+sep)||!target.split(sep).at(-1).startsWith('lads-repair-cli-'))throw new Error('Unsafe temp cleanup path');
    rmSync(target,{recursive:true,force:true});
  }
});
