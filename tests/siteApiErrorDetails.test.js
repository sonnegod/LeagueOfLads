import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {SiteAnalyticsStore} from '../config/siteAnalyticsStore.js';
import {createSiteApiHealth} from '../config/siteAnalytics.js';
import {apiErrorContext} from '../config/apiErrorDetails.js';

test('new exact status/route aggregates reconcile with legacy totals without inventing historical codes',()=>{
  const store=new SiteAnalyticsStore(':memory:',{now:()=>new Date('2026-11-20T18:00:00Z')});
  try {
    store.db.exec(`INSERT INTO SiteApiDays VALUES('2026-11-20',400,100,2600),('2026-11-20',413,100,4),('2026-11-20',500,100,3),('2026-11-20',200,100,23000)`);
    for(let n=0;n<3;n++)store.recordApi(401,15,{method:'GET',route:'/api/auth/user'});
    store.recordApi(404,20,{method:'GET',route:'/api/matches/:matchId'});
    store.recordApi(429,30,{method:'POST',route:'/api/signup/:seasonId/teams'});
    store.recordApi(413,100,{method:'POST',route:'/api/[middleware]'});
    store.recordApi(503,50,{method:'GET',route:'/api/liveMatches'});
    store.recordApi(400,10,{method:'POST',route:'/api/signup/:seasonId/drafts'});
    const report=store.report(1),details=report.health.errorBreakdown;
    assert.equal(report.health.requests,25615);
    assert.equal(details.statuses.find(row=>row.status===401).count,3);
    assert.equal(details.statuses.find(row=>row.status===400).count,1,'Only the new actual 400 is called a bad request');
    assert.equal(details.statuses.find(row=>row.status===413).count,5,'The old exact 413 status remains known');
    assert.equal(details.statuses.find(row=>row.status===503).count,1);
    assert.equal(details.statuses.find(row=>row.family==='4xx').count,2600);
    assert.equal(details.statuses.find(row=>row.family==='5xx').count,3,'Earlier 5xx are not relabeled as exact 500 errors');
    assert.equal(details.legacyRequests,2607);
    assert.equal(details.statuses.reduce((total,row)=>total+row.count,0),2615);
    assert.equal(report.health.apiErrorPercent,Math.round(2615/25615*1000)/10);
    assert.deepEqual(details.routes[0],{status:401,method:'GET',route:'/api/auth/user',count:3,label:'Sign-in required'});
    assert.equal(details.startedAt,'2026-11-20T18:00:00.000Z');
    assert.equal(store.pendingApi.size,0);assert.equal(store.pendingApiErrors.size,0);
    assert.equal(store.db.prepare("SELECT Count FROM SiteApiDays WHERE Day='2026-11-20' AND Status=400 AND Bucket=100").get().Count,2600,'Legacy rows are preserved');
  }finally{store.close();}
});

test('HTTP monitoring stores route templates and exact errors, not query strings, IDs, headers or error bodies',async()=>{
  const store=new SiteAnalyticsStore(':memory:',{now:()=>new Date('2026-11-20T18:00:00Z')});
  const app=express();
  app.use(createSiteApiHealth({enabled:()=>true,record:(status,duration,context)=>store.recordApi(status,duration,context)}));
  app.use(express.json({limit:'128b'}));
  const api=express.Router();
  api.get('/auth/user',(req,res)=>res.status(401).json({error:'Not logged in'}));
  api.get('/matches/:matchId',(req,res)=>res.status(404).json({error:'Private error context for '+req.params.matchId}));
  api.get('/limited',(req,res)=>res.sendStatus(429));
  api.get('/broken',(req,res)=>res.sendStatus(503));
  api.use('/admin',(req,res)=>res.sendStatus(403));
  app.use('/api',api);
  app.use((error,req,res,next)=>res.status(error.status||500).json({error:'Sensitive body parser error'}));
  app.use((req,res)=>res.sendStatus(404));
  const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(base+'/api/auth/user?token=private-query-token',{headers:{Cookie:'session=private-cookie',Authorization:'Bearer private-credential'}});
    for(const id of ['9058891793','9067573923'])await fetch(base+'/api/matches/'+id);
    await fetch(base+'/api/limited');await fetch(base+'/api/broken');await fetch(base+'/api/admin/private-player-name');
    await fetch(base+'/api/signup/3/drafts/private-draft-id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({screenshot:'secret'.repeat(100)})});
    await fetch(base+'/api/signup/3/teams',{method:'POST',headers:{'Content-Type':'application/json'},body:'{invalid-private-json'});
    for(let i=0;i<12;i++)await fetch(base+`/api/unknown-private-path-${i}?key=hidden`);
    const errorsBefore=store.report(1).health.requests;
    await fetch(base+'/not-api');await fetch(base+'/api/site-management/analytics');await fetch(base+'/api/site-analytics/config');
    const report=store.report(1),details=report.health.errorBreakdown;
    assert.equal(report.health.requests,errorsBefore,'Excluded routes stay out of health monitoring');
    assert.ok(details.routes.some(row=>row.route==='/api/auth/user'&&row.status===401));
    assert.ok(details.routes.some(row=>row.route==='/api/matches/:matchId'&&row.status===404&&row.count===2));
    assert.ok(details.routes.some(row=>row.route==='/api/admin/[middleware]'&&row.status===403));
    assert.ok(details.routes.some(row=>row.route==='/api/[unmatched]'&&row.count===12),'Unknown paths share one bounded aggregate');
    assert.ok(details.statuses.some(row=>row.status===400));assert.ok(details.statuses.some(row=>row.status===413));
    const serialized=JSON.stringify(store.db.prepare('SELECT * FROM SiteApiErrorDays').all());
    for(const privateValue of ['private','9058891793','9067573923','screenshot','hidden','Sensitive','?','Cookie','Bearer'])assert.ok(!serialized.includes(privateValue),privateValue+' must not be retained');
    assert.ok(store.db.prepare('SELECT COUNT(*) n FROM SiteApiErrorDays').get().n<10,'Variable IDs and arbitrary missing paths cannot grow route cardinality');
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));store.close();}
});

test('dynamic mounts and unsupported route shapes are normalized without copying requested URLs',()=>{
  assert.deepEqual(apiErrorContext({method:'GET',baseUrl:'/api/admin/seasons/123/schedule',route:{path:'/matchups/:matchupId'}}),
    {method:'GET',route:'/api/admin/seasons/:id/schedule/matchups/:matchupId'});
  assert.deepEqual(apiErrorContext({method:'GET',baseUrl:'/api',route:{path:/secret/},originalUrl:'/api/secret-account'}),
    {method:'GET',route:'/api/[pattern]'});
  assert.deepEqual(apiErrorContext({method:'PRIVATE-METHOD',baseUrl:'/api',res:{statusCode:404},originalUrl:'/api/private'}),
    {method:'OTHER',route:'/api/[unmatched]'});
});

test('API totals and error details flush atomically and share 90-day retention',()=>{
  let time=new Date('2026-06-01T12:00:00Z');
  const store=new SiteAnalyticsStore(':memory:',{now:()=>time});
  try {
    store.recordApi(401,10,{method:'GET',route:'/api/auth/user'});
    store.db.exec("CREATE TRIGGER reject_detail BEFORE INSERT ON SiteApiErrorDays BEGIN SELECT RAISE(ABORT,'test failure'); END;");
    assert.throws(()=>store.flush(),/test failure/);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM SiteApiDays').get().n,0);
    assert.equal(store.pendingApi.size,1);assert.equal(store.pendingApiErrors.size,1);
    store.db.exec('DROP TRIGGER reject_detail');store.flush();
    assert.equal(store.report(1).health.errorBreakdown.statuses[0].count,1);
    time=new Date('2026-11-20T12:00:00Z');
    store.recordApi(404,10,{method:'GET',route:'/api/matches/:matchId'});store.flush();
    assert.deepEqual(store.db.prepare('SELECT DISTINCT Day FROM SiteApiErrorDays').all(),[{Day:'2026-11-20'}]);
    assert.equal(store.report(1).health.requests,1);
    store.recordApi(400,10,{method:'GET',route:'/api/path?private=query'});
    assert.ok(store.report(1).health.errorBreakdown.routes.some(row=>row.route==='/api/[unknown]'));
  }finally{store.close();}
});
