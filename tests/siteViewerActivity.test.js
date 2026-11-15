import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {SiteAnalyticsStore} from '../config/siteAnalyticsStore.js';
import {analyticsPlayerDirectory} from '../config/siteAnalytics.js';
import {createSiteManagementRouter} from '../routes/siteManagementRoutes.js';

const steam=id=>(76561197960265728n+BigInt(id)).toString();
const visit={name:'page_view',page:'home',source:'Direct'};
function directoryFixture() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE Logins(SteamID INTEGER PRIMARY KEY,Username TEXT);
    CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);
    INSERT INTO Logins VALUES(1,'Steam Alpha'),(2,'Steam Beta'),(3,'Steam numeric'),(4294967295,'Invalid');
    INSERT INTO PlayerInfo VALUES(1,'League Alpha'),(3,12345),(4,'Player who has not signed in');`);
  return db;
}

test('named viewing activity resolves existing hashes, combines browsers and respects New York days and hourly activity',()=>{
  const league=directoryFixture();let now=new Date('2026-11-12T15:00:00Z');
  const store=new SiteAnalyticsStore(':memory:',{now:()=>now});
  try {
    const directory=analyticsPlayerDirectory(league);
    assert.deepEqual(directory,[{playerId:'1',name:'League Alpha'},{playerId:'2',name:'Steam Beta'},{playerId:'3',name:'12345'}]);
    store.record('a'.repeat(64),[visit]);
    store.record('b'.repeat(64),[visit,visit],steam(2));
    now=new Date('2026-11-13T15:00:00Z');
    store.record('a'.repeat(64),[visit],steam(1));
    store.record('b'.repeat(64),[{name:'series_expanded'}],steam(2));
    now=new Date('2026-11-13T18:00:00Z');
    store.record('c'.repeat(64),[visit],steam(1));
    store.record('d'.repeat(64),[visit],steam(3));
    store.record('e'.repeat(64),[visit]);
    const week=store.report(7,true,directory),today=store.report(1,true,directory);
    assert.equal(week.summary.visitors,4,'Anonymous viewers remain included in the totals');
    assert.deepEqual(week.viewers.map(row=>[row.name,row.activeDays,row.pageViews,row.lastSeen]),[
      ['League Alpha',2,3,'2026-11-13'],['Steam Beta',1,2,'2026-11-12'],['12345',1,1,'2026-11-13'],
    ]);
    assert.deepEqual(week.viewers[0].activity,[0,0,0,0,0,1,2]);
    assert.equal(today.viewers.length,2,'Feature-only activity does not count as a page-view visit');
    const alpha=today.viewers.find(row=>row.playerId==='1');
    assert.equal(alpha.activity.length,24);assert.equal(alpha.activity[10],1);assert.equal(alpha.activity[13],1);
    assert.equal(alpha.activity.reduce((a,b)=>a+b,0),2);
    assert.deepEqual(store.report(7).viewers,[],'A report without the private directory exposes no names');
    assert.ok(!JSON.stringify(week).includes(steam(1)),'The response does not expose Steam IDs or hash keys');
    assert.ok(store.db.prepare('SELECT Visitor FROM SiteVisitors').all().every(row=>!JSON.stringify(week).includes(row.Visitor)));
    now=new Date('2027-02-15T18:00:00Z');
    assert.deepEqual(store.report(30,true,directory).viewers,[],'The directory cannot resurrect expired viewing records');
  }finally{store.close();league.close();}
});

test('named viewing reports remain restricted to site managers and never run for unauthorized requests',async()=>{
  const store=new SiteAnalyticsStore(':memory:');let reports=0;
  store.record('a'.repeat(64),[visit],steam(1));
  const app=express();
  app.use((req,res,next)=>{
    const role=req.get('x-test-role');req.isAuthenticated=()=>!!role;
    req.user=role?{id:steam(role==='manager'?49219700:1),isSiteManager:role!=='manager'}:null;
    req.admin=role==='admin'?{AdminPlayerId:1,HeadAdmin:1}:null;next();
  });
  app.use('/api/site-management',createSiteManagementRouter({report:days=>{reports++;return store.report(days,true,[{playerId:'1',name:'Private viewer'}]);}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/site-management/analytics`;
  try {
    assert.equal((await fetch(url)).status,401);
    for(const role of ['player','admin'])assert.equal((await fetch(url,{headers:{'x-test-role':role}})).status,403);
    assert.equal(reports,0);
    const response=await fetch(url,{headers:{'x-test-role':'manager'}});
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
    const report=await response.json();assert.equal(report.viewers[0].name,'Private viewer');assert.equal(reports,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}
});
