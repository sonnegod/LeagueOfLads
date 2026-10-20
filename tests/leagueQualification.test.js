import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {classifyStandings,normalizeLeagueRules,normalizeQualificationPlan,qualificationPools} from '../config/leagueRules.js';
import {ensureQualificationSchema,saveQualificationRules,refreshQualificationSetup} from '../config/qualificationStore.js';
import {createLeagueRulesRouter} from '../routes/leagueRulesRoutes.js';
import {preseasonFixture} from './helpers/bettingFixture.js';
import {readSeasonBettingInputs} from '../analytics/bettingInputs.js';
import {seededRandom,simulateSeason} from '../betting/models.js';
import {runBetting} from '../betting/engine.js';
const now=new Date('2026-10-13T12:00:00.000Z');
const balancedPlan=bestOf=>({version:1,groups:Array.from({length:3},(_,index)=>({group:index+1,
  rows:['upper','upper','tie:upper','lower','lower','lower','lower','lower','eliminated']})),
  tiebreakers:[{id:'upper',name:'Upper bracket tiebreaker',bestOf,upper:2,lower:1,eliminated:0}]});
const multiPlan=()=>({version:1,groups:[4,5,6].map((size,index)=>({group:index+1,
  rows:['upper','tie:upper','lower','tie:lower',...Array(size-4).fill('eliminated')]})),tiebreakers:[
  {id:'upper',name:'Upper tiebreaker',bestOf:3,upper:2,lower:1,eliminated:0},
  {id:'lower',name:'Lower tiebreaker',bestOf:1,upper:0,lower:1,eliminated:2}]});
const standings=(count,start)=>Array.from({length:count},(_,index)=>({TeamId:start+index,TeamName:`Team ${start+index}`}));
function source() {
  const db=new Database(':memory:');db.exec(`CREATE TABLE LeagueInfo(LeagueId INTEGER PRIMARY KEY,Active INTEGER);
    CREATE TABLE LeagueRules(LeagueId INTEGER PRIMARY KEY,UpperBracketTeams INTEGER,LowerBracketTeams INTEGER,EliminatedTeams INTEGER,
      HasTiebreaker INTEGER,TiebreakerPosition INTEGER);
    INSERT INTO LeagueInfo VALUES(100,1),(200,0);INSERT INTO LeagueRules VALUES(100,2,5,2,1,3),(200,2,5,2,1,3);`);
  ensureQualificationSchema(db);return db;
}

test('group-specific rows feed multiple named cross-group pools with explicit destinations',()=>{
  const plan=normalizeQualificationPlan(multiPlan(),[4,5,6]),rules=normalizeLeagueRules({QualificationPlan:plan});
  const teams=plan.groups.flatMap((group,index)=>classifyStandings(standings(group.rows.length,100+index*10),rules,index+1));
  const pools=qualificationPools(teams,rules);
  assert.equal(pools.length,2);assert.equal(pools[0].teams.length,3);assert.equal(pools[1].teams.length,3);
  assert.deepEqual(pools[0].teams.map(team=>team.Rank),[2,2,2]);
  assert.deepEqual(pools[1].teams.map(team=>team.Rank),[4,4,4]);
  assert.equal(pools[0].upper,2);assert.equal(pools[0].lower,1);assert.equal(pools[1].lower,1);assert.equal(pools[1].eliminated,2);
  assert.ok(teams.filter(team=>team.Qualification==='tiebreaker').every(team=>team.TiebreakerName));
  assert.ok(classifyStandings(standings(7,1),rules,1).every(team=>team.Qualification===null));
});

test('invalid coverage, row destinations, duplicate pools, missing entrants, unsupported formats and incomplete outcomes fail validation',()=>{
  for(const mutate of [plan=>{plan.groups[0].rows[0]='unknown';},plan=>{plan.groups[1].group=1;},
    plan=>{plan.tiebreakers[0].upper=1;},plan=>{plan.tiebreakers[0].bestOf=2;},
    plan=>{plan.tiebreakers.push({...plan.tiebreakers[0]});},plan=>{plan.tiebreakers[0].lower=-1;},
    plan=>{plan.groups[0].rows[2]='tie:missing';},plan=>{plan.groups[1]=null;},
    plan=>{plan.groups[1].rows[2]='lower';plan.groups[2].rows[2]='lower';}]) {
    const plan=balancedPlan(1);mutate(plan);assert.throws(()=>normalizeQualificationPlan(plan));
  }
  assert.throws(()=>normalizeQualificationPlan(balancedPlan(1),[9,9,10]),/group sizes/);
  assert.throws(()=>normalizeQualificationPlan('{broken'),/Invalid qualification/);
});

test('additive schema migration and active-league saves preserve legacy seasons and legacy classification',()=>{
  const db=source();try {
    const historical=db.prepare('SELECT * FROM LeagueRules WHERE LeagueId=200').get();ensureQualificationSchema(db);
    const saved=saveQualificationRules(db,100,{QualificationPlan:balancedPlan(1)},[9,9,9]);
    assert.equal(JSON.parse(saved.QualificationJson).tiebreakers[0].upper,2);
    assert.equal(saved.HasTiebreaker,1);assert.equal(saved.TiebreakerPosition,3);
    assert.deepEqual(db.prepare('SELECT * FROM LeagueRules WHERE LeagueId=200').get(),historical);
    assert.deepEqual(classifyStandings(standings(10,1),historical).map(team=>team.Qualification),
      ['upper','upper','tiebreaker','lower','lower','lower','lower','lower','eliminated','eliminated']);
    assert.throws(()=>saveQualificationRules(db,100,{QualificationPlan:balancedPlan(1)},[9,9,10]),/group sizes/);
    assert.equal(JSON.parse(db.prepare('SELECT QualificationJson FROM LeagueRules WHERE LeagueId=100').get().QualificationJson).groups[2].rows.length,9);
  }finally{db.close();}
});

test('rules API remains admin-only, rejects stale edits and active-league changes, and rolls back failed setup updates',async()=>{
  const db=source();let server,changed=0,fail=false;
  try {
    const getRules=id=>db.prepare('SELECT * FROM LeagueRules WHERE LeagueId=?').get(id);
    const app=express();app.use(express.json());app.use((req,res,next)=>req.headers['x-admin']==='1'?next():res.sendStatus(403));
    app.use(createLeagueRulesRouter({db,getActiveLeague:()=>db.prepare('SELECT LeagueId FROM LeagueInfo WHERE Active=1').get(),getRules,
      saveRules:(id,input)=>saveQualificationRules(db,id,input,[9,9,9]),changed:()=>{if(fail)throw Error('Setup failed');changed++;return true;}}));
    server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
    const base=`http://127.0.0.1:${server.address().port}/leagueRules`,headers={'Content-Type':'application/json','x-admin':'1'};
    assert.equal((await fetch(base)).status,403);
    const before=await(await fetch(base,{headers})).json();
    const body={leagueId:100,revision:before.revision,QualificationPlan:balancedPlan(1)};
    let response=await fetch(base,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.bettingSetupUpdated,true);assert.equal(changed,1);
    assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify(body)})).status,409);
    assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify({...body,leagueId:200,revision:saved.revision})})).status,409);
    fail=true;const update={...body,revision:saved.revision,QualificationPlan:balancedPlan(3)};
    assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify(update)})).status,500);
    assert.equal(JSON.parse(getRules(100).QualificationJson).tiebreakers[0].bestOf,1);assert.equal(changed,1);
  }finally{if(server)await new Promise(done=>server.close(done));db.close();}
});

test('three third-place entrants route two to upper and one to lower, enabling 8-upper/16-lower champion odds in BO1 and BO3',()=>{
  const f=preseasonFixture([9,9,9]);try {
    const inputs=readSeasonBettingInputs(f.analytics,2,now);
    for(const bestOf of [1,3]) {
      inputs.season.RulesJson=JSON.stringify({QualificationPlan:balancedPlan(bestOf)});
      const simulation=simulateSeason(inputs,f.schedules.setup(2),seededRandom(123),100);
      assert.ok(simulation.champion);assert.ok(simulation.placement);
      const totals={upper:0,lower:0,eliminated:0};
      for(const placements of Object.values(simulation.placement)) {
        assert.ok(Math.abs(placements.upper+placements.lower+placements.eliminated-1)<1e-10);
        for(const key of Object.keys(totals))totals[key]+=placements[key];
      }
      assert.ok(Math.abs(totals.upper-8)<1e-10);assert.ok(Math.abs(totals.lower-16)<1e-10);assert.ok(Math.abs(totals.eliminated-3)<1e-10);
      assert.ok(Math.abs(Object.values(simulation.champion).reduce((sum,p)=>sum+p,0)-1)<1e-10);
      const wins=Object.values(simulation.regularWins).reduce((sum,counts)=>sum+counts.reduce((total,n,w)=>total+n*w,0)/100,0);
      assert.ok(Math.abs(wins-216)<1e-10); // Tiebreaker games never count as regular-season wins.
    }
  }finally{f.close();}
});

test('multiple pools with unequal groups conserve every final placement and keep uncertain legacy formats held',()=>{
  const f=preseasonFixture([4,5,6]);try {
    const inputs=readSeasonBettingInputs(f.analytics,2,now);inputs.season.RulesJson=JSON.stringify({QualificationPlan:multiPlan()});
    const simulation=simulateSeason(inputs,f.schedules.setup(2),seededRandom(42),100);
    for(const key of ['upper','lower','eliminated'])assert.ok(Math.abs(Object.values(simulation.placement).reduce((sum,p)=>sum+p[key],0)-5)<1e-10);
    assert.equal(simulation.champion,null); // 5/5 playoffs do not match the existing bracket.
    inputs.season.RulesJson=JSON.stringify({UpperBracketTeams:1,LowerBracketTeams:1,EliminatedTeams:1,HasTiebreaker:true,TiebreakerPosition:2});
    const legacy=simulateSeason(inputs,f.schedules.setup(2),seededRandom(42),100);
    assert.equal(legacy.placement,null);assert.equal(legacy.champion,null);
  }finally{f.close();}
});

test('finalized betting publishes actual placement and champion markets from the active qualification plan',()=>{
  const f=preseasonFixture([9,9,9]);try {
    f.league.exec('CREATE TABLE LeagueRules(LeagueId INTEGER PRIMARY KEY,UpperBracketTeams INTEGER,LowerBracketTeams INTEGER,EliminatedTeams INTEGER,HasTiebreaker INTEGER,TiebreakerPosition INTEGER)');
    ensureQualificationSchema(f.league);const saved=saveQualificationRules(f.league,200,{QualificationPlan:balancedPlan(3)},[9,9,9]);
    f.analytics.prepare('UPDATE SeasonFacts SET RulesJson=? WHERE SeasonId=2').run(JSON.stringify(saved));
    f.schedules.finalizeSetup(2,'group_round_robin','1',now);
    const result=runBetting({...f,now,seasonId:2,simulations:100});
    assert.equal(result.issues.includes('champion_format_not_supported'),false);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE MarketType='champion' AND Status='open'").get().n,1);
    assert.ok(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE MarketType='placement' AND Status='open'").get().n>20);
    const snapshot=JSON.parse(f.betting.prepare('SELECT InputJson FROM BettingInputSnapshots ORDER BY SnapshotId DESC LIMIT 1').get().InputJson);
    assert.equal(JSON.parse(snapshot.setup.SetupJson).rules.QualificationJson,saved.QualificationJson);
  }finally{f.close();}
});

test('saving active preseason rules refreshes a finalized setup, while started play and historical seasons keep their snapshots',()=>{
  const f=preseasonFixture([9,9,9]);try {
    f.league.exec("UPDATE LeagueSeasons SET Status='active' WHERE SeasonId=2;CREATE TABLE LeagueRules(LeagueId INTEGER PRIMARY KEY,UpperBracketTeams INTEGER,LowerBracketTeams INTEGER,EliminatedTeams INTEGER,HasTiebreaker INTEGER,TiebreakerPosition INTEGER)");
    ensureQualificationSchema(f.league);const before=f.schedules.setup(2),oldRules=f.league.prepare('SELECT * FROM SeasonLeagueRules').all();
    saveQualificationRules(f.league,200,{QualificationPlan:balancedPlan(1)},[9,9,9]);
    assert.equal(refreshQualificationSetup(f.league,f.schedules,200,now),true);
    const refreshed=f.schedules.setup(2);assert.equal(refreshed.Revision,before.Revision+1);
    assert.equal(JSON.parse(JSON.parse(refreshed.SetupJson).rules.QualificationJson).tiebreakers[0].bestOf,1);
    f.league.exec("UPDATE ScheduledEvents SET Status='started' WHERE SeasonId=2");
    saveQualificationRules(f.league,200,{QualificationPlan:balancedPlan(3)},[9,9,9]);
    assert.equal(refreshQualificationSetup(f.league,f.schedules,200,now),false);
    assert.deepEqual(f.schedules.setup(2),refreshed);
    assert.deepEqual(f.league.prepare('SELECT * FROM SeasonLeagueRules').all(),oldRules);
    assert.equal(refreshQualificationSetup(f.league,f.schedules,999,now),false);
  }finally{f.close();}
});
