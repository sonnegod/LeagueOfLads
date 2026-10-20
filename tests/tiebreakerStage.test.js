import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {ensureQualificationSchema,saveQualificationRules} from '../config/qualificationStore.js';
import {createQualificationSnapshot,startQualificationStage,readQualificationStage,qualificationPreview,
  finalizeQualificationStage,qualificationStageResponse} from '../config/tiebreakerStage.js';
import {createQualificationStageRouter} from '../routes/qualificationStageRoutes.js';
import {generatePlayoffBracket} from '../client/src/utils/playoffBracket.js';

function fixture() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE LeagueRules(LeagueId INTEGER PRIMARY KEY,UpperBracketTeams INTEGER,LowerBracketTeams INTEGER,
    EliminatedTeams INTEGER,HasTiebreaker INTEGER,TiebreakerPosition INTEGER);
    CREATE TABLE LeagueStageBoundaries(LeagueId INTEGER PRIMARY KEY,GroupEndMatchId INTEGER,TieBreakerEndMatchId INTEGER);
    CREATE TABLE PlayoffSeeding(UID INTEGER PRIMARY KEY,LeagueId INTEGER,TeamId INTEGER,Seed INTEGER,Bracket TEXT);
    CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER);
    CREATE TABLE MatchLeague(LeagueId INTEGER,MatchId INTEGER);
    INSERT INTO LeagueStageBoundaries VALUES(200,50,60);INSERT INTO PlayoffSeeding VALUES(1,200,999,1,'upper');`);
  ensureQualificationSchema(db);
  const groups=[4,5,6].map((size,index)=>({GroupId:index+1,GroupName:`Group ${index+1}`,
    teams:Array.from({length:size},(_,rank)=>({TeamId:100*(index+1)+rank+1,TeamName:`Team ${index+1}-${rank+1}`}))}));
  const plan={version:1,groups:groups.map((group,index)=>({group:index+1,rows:['upper','tie:upper','lower','tie:lower',...Array(group.teams.length-4).fill('eliminated')]})),
    tiebreakers:[{id:'upper',name:'Upper pool',bestOf:1,upper:2,lower:1,eliminated:0},
      {id:'lower',name:'Lower pool',bestOf:3,upper:0,lower:1,eliminated:2}]};
  saveQualificationRules(db,100,{QualificationPlan:plan},[4,5,6]);
  const rules=()=>db.prepare('SELECT * FROM LeagueRules WHERE LeagueId=100').get();
  const snapshot=createQualificationSnapshot(groups,rules());
  let nextMatchId=1000;
  function games({cycle=false}={}) {
    const matches=[];
    for(const pool of snapshot.pools) {
      const ids=pool.teams.map(team=>team.TeamId);
      for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++) {
        const winner=cycle&&pool.id==='upper'&&a===0&&b===2?ids[b]:ids[a];
        for(let game=0;game<(pool.bestOf+1)/2;game++)matches.push({MatchId:++nextMatchId,
          TeamA:game%2?ids[b]:ids[a],TeamB:game%2?ids[a]:ids[b],WinnerId:winner});
      }
    }
    return matches;
  }
  const insert=matches=>{
    for(const match of matches){db.prepare('INSERT INTO MatchTeam VALUES(?,?,?,?)').run(match.MatchId,match.TeamA,match.TeamB,match.WinnerId);
      db.prepare('INSERT INTO MatchLeague VALUES(100,?)').run(match.MatchId);}
  };
  return {db,groups,plan,rules,snapshot,games,insert};
}

test('multiple tiebreaker pools freeze unequal group entrants and require real unique Team IDs',()=>{
  const f=fixture();try {
    startQualificationStage(f.db,100,f.snapshot);
    f.groups[0].teams.reverse();f.plan.tiebreakers[0].upper=0;
    const saved=readQualificationStage(f.db,100);
    assert.deepEqual(saved.snapshot.pools.map(pool=>pool.teams.map(team=>team.TeamId)),[[102,202,302],[104,204,304]]);
    assert.equal(saved.snapshot.pools[0].upper,2);assert.equal(saved.results,null);
    assert.throws(()=>saveQualificationRules(f.db,100,{QualificationPlan:f.plan}),/locked/);
    assert.throws(()=>startQualificationStage(f.db,100,f.snapshot),/already been saved/);
    const duplicate=structuredClone(f.groups);duplicate[0].teams[0].TeamId=duplicate[1].teams[0].TeamId;
    assert.throws(()=>createQualificationSnapshot(duplicate,f.rules()),/unique Team ID/);
  }finally{f.db.close();}
});

test('BO1 and BO3 pools rank independently by series results, even with sides swapped and unrelated games',()=>{
  const f=fixture();try {
    const games=f.games();games.push({MatchId:99999,TeamA:102,TeamB:104,WinnerId:104});
    const preview=qualificationPreview(f.snapshot,games);
    assert.equal(preview.ready,true);
    assert.deepEqual(preview.pools.map(pool=>pool.teams.map(team=>[team.TeamId,team.SeriesWins,team.Qualification])),[
      [[102,2,'upper'],[202,1,'upper'],[302,0,'lower']],[[104,2,'lower'],[204,1,'eliminated'],[304,0,'eliminated']]]);
    assert.equal(preview.pools[1].headToHead[0].WinsA,2);
    assert.equal(preview.pools[1].teams[0].Neustadtl,1);
    assert.equal(preview.pools[1].completedPairs,3);
  }finally{f.db.close();}
});

test('missing, unfinished, invalid-winner and excess games prevent finalization instead of fabricating qualifiers',()=>{
  const f=fixture();try {
    for(const mutate of [games=>games.pop(),games=>{games[0].WinnerId=null;},games=>{games[0].WinnerId=999;},
      games=>games.push({...games[0],MatchId:99999})]) {
      const games=f.games();mutate(games);const preview=qualificationPreview(f.snapshot,games);
      assert.equal(preview.ready,false);assert.ok(preview.pools.some(pool=>pool.problems.length));
      assert.throws(()=>f.db.transaction(()=>finalizeQualificationStage(f.db,100,f.snapshot,games,{revision:preview.revision}))(),/incomplete|too many/);
      assert.equal(readQualificationStage(f.db,100),null);
    }
  }finally{f.db.close();}
});

test('cyclic results need an explicit cutoff order, which can only reorder equally ranked entrants',()=>{
  const f=fixture();try {
    const games=f.games({cycle:true}),preview=qualificationPreview(f.snapshot,games);
    assert.equal(preview.ready,false);assert.equal(preview.pools[0].needsOrder,true);
    assert.throws(()=>f.db.transaction(()=>finalizeQualificationStage(f.db,100,f.snapshot,games,{revision:preview.revision}))(),/confirm the order/);
    const orders={upper:[302,102,202]};
    const result=f.db.transaction(()=>finalizeQualificationStage(f.db,100,f.snapshot,games,{revision:preview.revision,orders}))();
    assert.deepEqual(result.pools[0].teams.map(team=>[team.TeamId,team.Qualification]),[[302,'upper'],[102,'upper'],[202,'lower']]);
    assert.deepEqual(readQualificationStage(f.db,100).results.pools[0].teams.map(team=>team.TeamId),orders.upper);
    const straight=f.games();
    for(const order of [[102,102,302],[102,202],[102,202,999],[302,202,102]])
      assert.throws(()=>qualificationPreview(f.snapshot,straight,{upper:order}),/every entrant|only teams tied/);
    assert.throws(()=>qualificationPreview(f.snapshot,straight,{unknown:[]}),/Unknown tiebreaker/);
  }finally{f.db.close();}
});

test('final results and seeds persist together, include direct qualifiers, exclude eliminated teams and preserve history',()=>{
  const f=fixture();let restored;try {
    const games=f.games(),preview=qualificationPreview(f.snapshot,games);
    startQualificationStage(f.db,100,f.snapshot);
    f.db.transaction(()=>finalizeQualificationStage(f.db,100,f.snapshot,games,{revision:preview.revision}))();
    const seeds=f.db.prepare('SELECT TeamId,Bracket FROM PlayoffSeeding WHERE LeagueId=100 ORDER BY Bracket,Seed').all();
    assert.equal(seeds.length,10);assert.equal(seeds.filter(team=>team.Bracket==='upper').length,5);
    assert.equal(seeds.filter(team=>team.Bracket==='lower').length,5);
    assert.equal(seeds.find(team=>team.TeamId===302).Bracket,'lower');
    assert.equal(seeds.find(team=>team.TeamId===104).Bracket,'lower');
    assert.ok(!seeds.some(team=>[204,304].includes(team.TeamId)));
    assert.equal(f.db.prepare('SELECT TeamId FROM PlayoffSeeding WHERE LeagueId=200').get().TeamId,999);
    restored=new Database(f.db.serialize());
    const response=qualificationStageResponse(readQualificationStage(restored,100),[]);
    assert.equal(response.finalized,true);assert.equal(response.upperBracketTeams.length,5);assert.equal(response.lowerBracketTeams.length,5);
    assert.equal(response.eliminatedTeams.length,5);assert.equal(response.tiebreakerPools[1].headToHead[0].WinsA,2);
    assert.throws(()=>finalizeQualificationStage(f.db,100,f.snapshot,games,{revision:preview.revision}),/already been finalized/);
  }finally{restored?.close();f.db.close();}
});

test('stale results and transaction failures leave both qualifications and seeds unchanged',()=>{
  const f=fixture();try {
    const games=f.games(),preview=qualificationPreview(f.snapshot,games);
    startQualificationStage(f.db,100,f.snapshot);
    assert.throws(()=>finalizeQualificationStage(f.db,100,f.snapshot,games,{revision:'stale'}),/changed/);
    assert.throws(()=>f.db.transaction(()=>{
      finalizeQualificationStage(f.db,100,f.snapshot,games,{revision:preview.revision});throw Error('Audit failed');
    })(),/Audit failed/);
    assert.equal(readQualificationStage(f.db,100).results,null);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM PlayoffSeeding WHERE LeagueId=100').get().n,0);
  }finally{f.db.close();}
});

test('the current 9/9/10 group example saves 8 upper, 16 lower and 4 eliminated and builds matching bracket pools',()=>{
  const f=fixture();try {
    const groups=[9,9,10].map((size,index)=>({GroupId:index+1,GroupName:`Group ${index+1}`,
      teams:Array.from({length:size},(_,rank)=>({TeamId:100*(index+1)+rank+1,TeamName:`Team ${index+1}-${rank+1}`}))}));
    const plan={version:1,groups:groups.map((group,index)=>({group:index+1,
      rows:['upper','upper','tie:upper','lower','lower','lower','lower','lower',...Array(group.teams.length-8).fill('eliminated')]})),
      tiebreakers:[{id:'upper',name:'Upper pool',bestOf:3,upper:2,lower:1,eliminated:0}]};
    const snapshot=createQualificationSnapshot(groups,{QualificationPlan:plan});
    const games=[];let id=5000;
    for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)for(let game=0;game<2;game++)
      games.push({MatchId:++id,TeamA:snapshot.pools[0].teams[a].TeamId,TeamB:snapshot.pools[0].teams[b].TeamId,WinnerId:snapshot.pools[0].teams[a].TeamId});
    const preview=qualificationPreview(snapshot,games);
    const result=f.db.transaction(()=>finalizeQualificationStage(f.db,100,snapshot,games,{revision:preview.revision}))();
    assert.equal(result.teams.length,28);
    assert.deepEqual(['upper','lower','eliminated'].map(key=>result.teams.filter(team=>team.Qualification===key).length),[8,16,4]);
    const seeds=f.db.prepare('SELECT * FROM PlayoffSeeding WHERE LeagueId=100').all();
    const bracket=generatePlayoffBracket(seeds);
    assert.equal(bracket.upperBracket[0].matches.length,4);assert.equal(bracket.lowerBracket[0].matches.length,8);
    assert.equal(seeds.find(team=>team.TeamId===303).Bracket,'lower');
    assert.ok(!seeds.some(team=>team.TeamId===310));
  }finally{f.db.close();}
});

test('admin stage lifecycle freezes pools, blocks early brackets, reviews results and closes into stored playoff seeds atomically',async()=>{
  const f=fixture();let server,auditFails=false;
  try {
    f.insert([{MatchId:1000,TeamA:101,TeamB:102,WinnerId:101}]);
    const app=express();app.use(express.json());app.use((req,res,next)=>req.headers['x-admin']==='1'?next():res.sendStatus(403));
    app.use(createQualificationStageRouter({db:f.db,getActiveLeague:()=>({LeagueId:100}),getRules:f.rules,getGroups:()=>f.groups,
      getLastMatch:()=>f.db.prepare('SELECT MAX(MatchId) MatchId FROM MatchLeague WHERE LeagueId=100').get(),
      audit:()=>{if(auditFails)throw Error('Audit failed');}}));
    app.get('/playoffBracket',(_req,res)=>res.json({teams:f.db.prepare('SELECT * FROM PlayoffSeeding WHERE LeagueId=100').all()}));
    server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
    const base=`http://127.0.0.1:${server.address().port}`,headers={'x-admin':'1','Content-Type':'application/json'};
    const post=(path,body={})=>fetch(`${base}/${path}`,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await fetch(`${base}/tiebreakerResults`)).status,403);
    assert.equal((await fetch(`${base}/playoffBracket`,{headers})).status,409);
    assert.equal((await post('activatePlayoffs')).status,409);
    assert.equal((await post('activateTiebreakers',{leagueId:200})).status,409);
    auditFails=true;assert.equal((await post('activateTiebreakers')).status,500);
    assert.equal(readQualificationStage(f.db,100),null);
    assert.equal(f.db.prepare('SELECT * FROM LeagueStageBoundaries WHERE LeagueId=100').get(),undefined);
    auditFails=false;assert.equal((await post('activateTiebreakers')).status,200);
    f.groups[0].teams.reverse(); // Live group changes cannot change the saved pool entrants.
    assert.equal((await post('activateTiebreakers')).status,409);
    let review=await(await fetch(`${base}/tiebreakerResults`,{headers})).json();assert.equal(review.ready,false);
    assert.equal((await post('activatePlayoffs',{qualificationRevision:review.revision})).status,409);
    f.insert(f.games());
    assert.equal((await post('activatePlayoffs',{qualificationRevision:review.revision})).status,409);
    review=await(await fetch(`${base}/tiebreakerResults`,{headers})).json();assert.equal(review.ready,true);
    auditFails=true;assert.equal((await post('activatePlayoffs',{qualificationRevision:review.revision})).status,500);
    assert.equal(readQualificationStage(f.db,100).results,null);
    assert.equal(f.db.prepare('SELECT TieBreakerEndMatchId FROM LeagueStageBoundaries WHERE LeagueId=100').get().TieBreakerEndMatchId,null);
    auditFails=false;assert.equal((await post('activatePlayoffs',{qualificationRevision:review.revision})).status,200);
    const bracket=await(await fetch(`${base}/playoffBracket`,{headers})).json();assert.equal(bracket.teams.length,10);
    assert.equal(bracket.teams.find(team=>team.TeamId===302).Bracket,'lower');
    assert.equal((await post('activatePlayoffs',{qualificationRevision:review.revision})).status,409);
  }finally{if(server)await new Promise(done=>server.close(done));f.db.close();}
});

test('legacy seasons keep their existing stage endpoints without creating qualification snapshots',async()=>{
  const f=fixture();let server;try {
    const app=express();app.use(express.json());app.use(createQualificationStageRouter({db:f.db,
      getActiveLeague:()=>({LeagueId:100}),getRules:()=>({UpperBracketTeams:2,LowerBracketTeams:5,HasTiebreaker:1,TiebreakerPosition:3}),
      getGroups:()=>f.groups,getLastMatch:()=>({MatchId:1000})}));
    app.post('/activateTiebreakers',(_req,res)=>res.json({legacy:true}));
    app.post('/activatePlayoffs',(_req,res)=>res.json({legacy:true}));
    server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await(await fetch(`${base}/activateTiebreakers`,{method:'POST'})).json(),{legacy:true});
    assert.deepEqual(await(await fetch(`${base}/activatePlayoffs`,{method:'POST'})).json(),{legacy:true});
    assert.equal((await(await fetch(`${base}/tiebreakerResults`)).json()).enabled,false);
    assert.equal(readQualificationStage(f.db,100),null);
  }finally{if(server)await new Promise(done=>server.close(done));f.db.close();}
});
