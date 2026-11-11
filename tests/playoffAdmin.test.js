import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {playoffFixture as fixture} from './helpers/playoffFixture.js';
import {readPlayoffBracket} from '../config/playoffBracketAdmin.js';
import {createPlayoffRouter} from '../routes/playoffRoutes.js';
import {ScheduleStore} from '../betting/scheduleStore.js';
import {playoffMatches,playoffLabels,playoffSlotLabel,playoffResult} from '../shared/playoffBracket.js';

test('seed suggestions fill both qualified pools once and paths have unique readable labels',()=>{
  const f=fixture();try {
    const saved=f.save(f.bracket),matches=playoffMatches(saved.playoffBracket),labels=playoffLabels(saved.playoffBracket);
    assert.equal(new Set(labels.values()).size,matches.length);
    assert.equal(playoffSlotLabel(saved.playoffBracket,'ub-r2-m1',1),'Winner of UB1');
    assert.equal(playoffSlotLabel(saved.playoffBracket,'lb-r2-m1',2),'Loser of UB1');
    assert.deepEqual(saved.playoffBracket.upperBracket[0].matches.map(m=>[m.team1Id,m.team2Id]),[[1,4],[2,3]]);
    assert.equal(saved.playoffBracket.grandFinals[0].bestOf,5);
    assert.ok(saved.result.every(team=>['Moon','Sun'].includes(team.GroupName)));
  }finally{f.close();}
});

test('the current eight-upper, eight-lower format publishes all sixteen entrants and preserves its paths',()=>{
  const f=fixture(8);try {
    const saved=f.save(f.bracket),bracket=saved.playoffBracket;
    assert.equal(saved.result.length,16);assert.equal(playoffMatches(bracket).length,22);
    assert.deepEqual(bracket.lowerBracket.map(round=>round.matches.length),[4,4,2,2,1,1]);
    assert.equal(bracket.upperBracket[0].matches[0].loserTo,'lb-r2-m1');
  }finally{f.close();}
});

test('a 1–0 BO3 score stays in progress; a clinch advances winner and loser, and BO5 needs three wins',()=>{
  const f=fixture();try {
    f.save(f.bracket);
    const next=readPlayoffBracket(f.db,100).playoffBracket;next.upperBracket[0].matches[0].team1Score=1;
    let saved=f.save(next).playoffBracket;
    assert.equal(saved.upperBracket[1].matches[0].team1Id,null);
    assert.equal(saved.lowerBracket[1].matches[0].team2Id,null);
    saved.upperBracket[0].matches[0].team1Score=2;saved=f.save(saved).playoffBracket;
    assert.equal(saved.upperBracket[1].matches[0].team1Id,1);assert.equal(saved.lowerBracket[1].matches[0].team2Id,4);
    assert.equal(saved.upperBracket[1].matches[0].team1Seed,1);
    assert.equal(playoffResult({bracket:'grand',bestOf:5,team1Id:1,team2Id:2,team1Score:2,team2Score:0}).complete,false);
    assert.equal(playoffResult({bracket:'grand',bestOf:5,team1Id:1,team2Id:2,team1Score:3,team2Score:1}).complete,true);
  }finally{f.close();}
});

test('duplicate entrants, wrong pools, malformed scores and changed match paths cannot be published',()=>{
  const f=fixture();try {
    for(const corrupt of [b=>b.upperBracket[0].matches[0].team2Id=1,b=>b.upperBracket[0].matches[0].team1Id=5,
      b=>b.upperBracket[0].matches[0].team1Score=3,b=>b.upperBracket[0].matches[0].team1Score='bad',b=>b.upperBracket[0].matches[0].winnerTo='gf-m1']) {
      const bad=structuredClone(f.bracket);corrupt(bad);assert.throws(()=>f.save(bad));
      assert.equal(readPlayoffBracket(f.db,100).playoffBracket,null);
    }
  }finally{f.close();}
});

test('stale saves retain newer results and downstream played matches block earlier winner changes',()=>{
  const f=fixture();try {
    const first=f.save(f.bracket),copy=structuredClone(first.playoffBracket);
    copy.upperBracket[0].matches.forEach(m=>{m.team1Score=2;});let current=f.save(copy);
    assert.throws(()=>f.save(first.playoffBracket,first.revision),/changed while you were editing/);
    current.playoffBracket.upperBracket[1].matches[0].team1Score=2;current=f.save(current.playoffBracket);
    const before=readPlayoffBracket(f.db,100).revision;
    current.playoffBracket.upperBracket[0].matches[0].team1Score=0;current.playoffBracket.upperBracket[0].matches[0].team2Score=2;
    assert.throws(()=>f.save(current.playoffBracket),/already has a result/);
    assert.equal(readPlayoffBracket(f.db,100).revision,before);
  }finally{f.close();}
});

test('recorded live series show actual progress and reject manual score edits',()=>{
  const f=fixture();try {
    const current=f.save(f.bracket),match=current.playoffBracket.upperBracket[0].matches[0];
    f.db.prepare("INSERT INTO SeriesInfo(SeriesId,Team1,Team2,LeagueId,Stage,DateCreated) VALUES(50,?,?,100,'p','2026-11-10')").run(match.team1Id,match.team2Id);
    f.db.prepare("INSERT INTO SeriesLifecycle(SeriesId,BestOf,FormatSource,BracketMatchId,Status,Team1Wins,Team2Wins,UpdatedAt) VALUES(50,3,'playoffs',?,'in_progress',1,0,'2026-11-10')").run(match.id);
    const view=readPlayoffBracket(f.db,100);assert.equal(view.matchDetails[match.id].seriesId,50);assert.equal(view.matchDetails[match.id].team1Score,1);
    assert.equal(view.matchDetails[match.id].seriesStatus,'in_progress');
    view.playoffBracket.upperBracket[0].matches[0].team1Score=2;
    assert.throws(()=>f.save(view.playoffBracket),/recorded series/);
  }finally{f.close();}
});

test('fixture kickoff and format match linked team IDs, and official names refresh without changing bracket history',()=>{
  const f=fixture();try {
    f.save(f.bracket);const schedules=new ScheduleStore(f.db);
    f.db.exec(`INSERT INTO LeagueSeasons(SeasonId,LeagueName,Status,ExternalLeagueId,CreatedAt,UpdatedAt) VALUES(1,'Active','active',100,'2026-11-01','2026-11-01');
      INSERT INTO SeasonTeams(TeamSubmissionId,SeasonId,TeamName,ExternalTeamId,SubmittedAt,UpdatedAt) VALUES(11,1,'Different signup name',1,'2026-11-01','2026-11-01'),(12,1,'Opponent',4,'2026-11-01','2026-11-01');`);
    const fixture=schedules.save(1,{team1Key:11,team2Key:12,stage:'playoff',bestOf:3,scheduledStartUtc:'2026-11-11T01:00:00Z'});
    const before=readPlayoffBracket(f.db,100).revision;
    f.db.prepare('UPDATE TeamInfo SET TeamName=? WHERE TeamId=1').run('Official team name');
    const view=readPlayoffBracket(f.db,100),detail=view.matchDetails['ub-r1-m1'];
    assert.equal(detail.kickoff,fixture.ScheduledStartUtc);assert.equal(detail.bestOf,3);
    assert.equal(view.playoffBracket.upperBracket[0].matches[0].team1Name,'Official team name');
    assert.equal(view.revision,before,'Reading aliases must not rewrite recorded bracket JSON');
  }finally{f.close();}
});

test('playoff endpoints retain admin authentication and public responses expose only bracket data',async()=>{
  const f=fixture(),app=express();let server;
  try {
    app.use(express.json());app.use('/admin',(req,res,next)=>req.get('x-admin')==='yes'?next():res.sendStatus(403));
    app.use(createPlayoffRouter({db:f.db,activeLeague:()=>100}));
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(url+'/admin/playoffBracket')).status,403);
    assert.equal((await fetch(url+'/admin/saveBracket',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    const initial=await(await fetch(url+'/admin/playoffBracket',{headers:{'x-admin':'yes'}})).json();
    const saved=await fetch(url+'/admin/saveBracket',{method:'POST',headers:{'Content-Type':'application/json','x-admin':'yes'},body:JSON.stringify({bracketData:f.bracket,revision:initial.revision})});
    assert.equal(saved.status,200);
    const publicData=await(await fetch(url+'/getCurrentBracket?leagueId=100')).json();
    assert.deepEqual(Object.keys(publicData).sort(),['matchDetails','playoffBracket']);
    assert.equal((await fetch(url+'/getCurrentBracket?leagueId=invalid')).status,400);
  }finally{server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});
