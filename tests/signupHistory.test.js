import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import express from 'express';
import {signupHistory,signupSeasons} from '../config/signupHistory.js';
import {createAdminSignupRouter} from '../routes/adminSignupRoutes.js';

function fixture() {
  const db=new Database(':memory:');
  db.exec(readFileSync(new URL('../scripts/db/ladsData.schema.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO LeagueSeasons(SeasonId,LeagueName,Status,CreatedAt,UpdatedAt) VALUES
      (1,'Previous season','ended','2026-09-01','2026-10-01'),(2,'Current season','active','2026-10-01','2026-10-01'),
      (3,'Older league without signup data','ended','2026-01-01','2026-01-01');
    INSERT INTO PlayerInfo(PlayerId,PlayerName) VALUES(11,'Alpha'),(12,12345),(13,'Past captain'),(99,'Replacement player');
    INSERT INTO SeasonTeams(TeamSubmissionId,SeasonId,TeamName,IsManual,ManualAverageMMR,SubmittedAt,UpdatedAt) VALUES
      (1,1,'Past team',0,NULL,'2026-09-01','2026-09-01'),(2,1,'Manual team',1,7000,'2026-09-02','2026-09-02'),
      (3,2,'Current team',0,NULL,'2026-10-01','2026-10-01');
    INSERT INTO SeasonTeamPlayers VALUES(1,12,1,6600,'https://www.dotabuff.com/players/12','image/png',X'010203'),
      (1,11,0,6500,'https://www.dotabuff.com/players/11','image/png',X'010203'),
      (3,13,0,7100,'https://www.dotabuff.com/players/13','image/png',X'010203');
    INSERT INTO SignupMMRs VALUES(1,1,11,6200),(1,1,12,6400);
    INSERT INTO AdjustedPlayers(PlayerId,AdjustedMMR,CreatedAt,UpdatedAt) VALUES(11,9000,'2026-11-01','2026-11-01');
    INSERT INTO TeamRosterPlayers VALUES(1,99,0,'2026-11-01');`);
  return db;
}

test('signup history reads original players and frozen MMRs, with submitted MMR fallback and manual averages',()=>{
  const db=fixture();try {
    db.pragma('query_only = ON');
    const seasons=signupSeasons(db);
    assert.deepEqual(seasons.map(s=>s.SeasonId),[2,3,1]);
    assert.equal(seasons.find(s=>s.SeasonId===1).TeamCount,2);
    assert.equal(seasons.find(s=>s.SeasonId===1).PlayerCount,2);
    const history=signupHistory(db,1);
    assert.equal(history.season.Status,'ended');
    const team=history.teams.find(t=>t.TeamSubmissionId===1);
    assert.deepEqual(team.players,[{PlayerId:11,Slot:0,PlayerName:'Alpha',MMR:6200},
      {PlayerId:12,Slot:1,PlayerName:'12345',MMR:6400}]);
    assert.equal(team.AverageMMR,6300);
    assert.ok(!team.players.some(p=>p.PlayerId===99),'Roster replacements must not change submitted players');
    assert.deepEqual(history.teams.find(t=>t.IsManual).players,[]);
    assert.equal(history.teams.find(t=>t.IsManual).AverageMMR,7000);
    assert.equal(signupHistory(db,2).teams[0].players[0].MMR,7100);
    assert.deepEqual(signupHistory(db,3).teams,[]);
    assert.equal(signupHistory(db,999),null);
    const json=JSON.stringify(history);
    for(const key of ['ScreenshotData','ScreenshotMime','HasScreenshot','DotaProfileUrl','AdjustedMMR'])assert.ok(!json.includes(key),key);
  }finally{db.close();}
});

test('signup history endpoints are admin-only, uncached, validate seasons and expose no write actions',async()=>{
  const db=fixture(),app=express();let role='anonymous';
  // Match the parent /admin gate used in routes.js.
  app.use('/admin',(req,res,next)=>role==='anonymous'?res.status(401).end():role!=='admin'?res.status(403).end():next());
  app.use('/admin/signups',createAdminSignupRouter({league:db}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/admin/signups/1')).status,401);
    role='player';assert.equal((await fetch(base+'/admin/signups/1')).status,403);
    role='admin';db.pragma('query_only = ON');
    const list=await fetch(base+'/admin/signups');assert.equal(list.status,200);
    assert.equal((await list.json()).defaultSeasonId,2);
    const response=await fetch(base+'/admin/signups/1');
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
    const history=await response.json();assert.equal(history.teams.length,2);
    for(const id of ['0','-1','abc','1.2','9007199254740992'])assert.equal((await fetch(base+'/admin/signups/'+id)).status,400);
    assert.equal((await fetch(base+'/admin/signups/999')).status,404);
    for(const method of ['POST','PUT','PATCH','DELETE']) {
      const rejected=await fetch(base+'/admin/signups/1',{method});
      assert.equal(rejected.status,405);assert.equal(rejected.headers.get('allow'),'GET, HEAD');
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM SeasonTeamPlayers').get().n,3);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
});
