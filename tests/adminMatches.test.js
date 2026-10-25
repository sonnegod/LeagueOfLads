import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {engineFixture} from './helpers/bettingFixture.js';
import {createAdminMatchRouter} from '../routes/adminMatchRoutes.js';
import {getAuditActor,runWithAuditActor} from '../config/adminAuditContext.js';

async function fixture(run,{includeLocalTests=false}={}) {
  const f=engineFixture(),audits=[];let changes=0;
  f.schedules.audit=(type,message)=>audits.push({type,message,actor:getAuditActor()});
  f.schedules.changed=()=>changes++;
  const app=express();app.use(express.json());
  // Isolated league-admin authentication; never imports or opens live databases.
  app.use('/api/admin/matches',(req,res,next)=>{
    const user=req.get('x-test-user');if(!user)return res.sendStatus(401);
    if(user!=='admin')return res.sendStatus(403);
    req.user={id:(76561197960265728n+42n).toString()};
    return runWithAuditActor({AdminPlayerId:42,AdminPlayerName:'Test Admin'},next);
  },createAdminMatchRouter({league:f.league,schedules:f.schedules,includeLocalTests}));
  const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  const request=(path,user='admin',method='GET',body)=>fetch(`http://127.0.0.1:${server.address().port}/api/admin/matches${path}`,{
    method,headers:{...(user?{'x-test-user':user}:{}),'Content-Type':'application/json',Connection:'close'},
    ...(body?{body:JSON.stringify(body)}:{})});
  try{await run({...f,request,audits,changes:()=>changes});}
  finally{server.closeAllConnections();await new Promise(done=>server.close(done));f.close();}
}
const eventBody={team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-26T00:00:00.000Z'};

test('league match administration restricts reads and writes without exposing betting controls',async()=>{
  await fixture(async f=>{
    const actions=[['/status','GET'],['/seasons/1/events','POST'],['/seasons/1/aliases','PUT'],['/messages/100/resolve','POST']];
    for(const [path,method] of actions) {
      assert.equal((await f.request(path,null,method,method==='GET'?null:{})).status,401);
      assert.equal((await f.request(path,'player',method,method==='GET'?null:{})).status,403);
    }
    assert.equal(f.changes(),0);
    for(const [path,method] of [['/refresh','POST'],['/seasons/1/setup','POST'],['/seasons/1/completion','PUT'],
      ['/seasons/1/matches/classify','POST'],['/legacy/settle','POST']])assert.equal((await f.request(path,'admin',method,{})).status,404);
    const response=await f.request('/status');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);
    const data=await response.json();assert.equal(data.season.seasonId,1);assert.equal(data.teams.length,2);
    assert.deepEqual(Object.keys(data).sort(),['aliases','events','localTesting','messages','season','seasons','teams']);
    for(const query of ['?seasonId=bad','?seasonId=0','?seasonId=1&seasonId=2'])assert.equal((await f.request('/status'+query)).status,400);
    assert.equal((await f.request('/status?seasonId=999')).status,404);
  });
});

test('fixtures preserve revisions, local-time conversion, audit attribution and automatic betting refresh notifications',async()=>{
  await fixture(async f=>{
    const created=await f.request('/seasons/1/events','admin','POST',eventBody);assert.equal(created.status,201);
    const event=(await created.json()).event;assert.equal(f.changes(),1);assert.equal(event.Revision,1);
    const edit={...eventBody,eventId:event.EventId,revision:event.Revision,localTime:'2026-10-25 9:00 PM EST'};
    const updated=await f.request('/seasons/1/events','admin','POST',edit);assert.equal(updated.status,201);
    const saved=(await updated.json()).event;assert.equal(saved.EventId,event.EventId);assert.equal(saved.Revision,2);
    assert.equal(saved.ScheduledStartUtc,'2026-10-26T01:00:00.000Z');assert.equal(f.changes(),2);
    assert.equal((await f.request('/seasons/1/events','admin','POST',edit)).status,409);assert.equal(f.changes(),2);
    assert.equal((await f.request('/seasons/1/events','admin','POST',{...eventBody,team2Key:11})).status,400);
    assert.equal((await f.request('/seasons/1/events','admin','POST',{...eventBody,localTime:'not a date'})).status,400);
    assert.equal(f.audits[0].actor.AdminPlayerId,42);assert.equal(f.audits[0].actor.AdminPlayerName,'Test Admin');
    f.league.exec("UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=1");
    assert.equal((await f.request('/seasons/1/events','admin','POST',eventBody)).status,409);
    assert.equal((await f.request('/seasons/1/events','admin','POST',{...eventBody,eventId:saved.EventId,revision:saved.Revision})).status,201);
  });
});

test('review resolution stays within the post season and readable role names remain available',async()=>{
  await fixture(async f=>{
    f.schedules.ingest({messageId:'100',channelId:'99',authoredAt:'2026-10-23T12:00:00.000Z',
      content:'**<@&111111111111111111>** vs **<@&222222222222222222>** Sunday 8pm EST',
      roleNames:{'111111111111111111':"Sock's Warriors",'222222222222222222':'Initiative'}},1);
    const data=await(await f.request('/status')).json();assert.equal(data.messages.length,1);
    assert.equal(data.messages[0].DisplayContent,"**@Sock's Warriors** vs **@Initiative** Sunday 8pm EST");
    f.league.exec("INSERT INTO LeagueSeasons VALUES(2,200,'Next season','signup_closed',NULL);INSERT INTO SeasonTeams VALUES(21,2,2011111,'C',2,0),(22,2,2022222,'D',2,0)");
    const other=f.schedules.save(2,{...eventBody,team1Key:21,team2Key:22});
    assert.equal((await f.request('/messages/100/resolve','admin','POST',{eventId:other.EventId})).status,400);
    assert.equal((await f.request('/messages/100/resolve','admin','POST',{eventId:999})).status,400);
    const event=f.schedules.save(1,eventBody);
    assert.equal((await f.request('/messages/999/resolve','admin','POST',{eventId:event.EventId})).status,404);
    assert.equal((await f.request('/messages/100/resolve','admin','POST',{eventId:event.EventId})).status,200);
    assert.deepEqual((await(await f.request('/status?seasonId=1')).json()).messages,[]);
    const resolved=f.league.prepare("SELECT ParseStatus,EventId FROM ScheduleMessages WHERE MessageId='100'").get();
    assert.deepEqual(resolved,{ParseStatus:'resolved',EventId:event.EventId});
    assert.equal((await f.request('/seasons/1/aliases','admin','PUT',{roleId:'111111111111111111',teamKey:21})).status,400);
    assert.equal((await f.request('/seasons/1/aliases','admin','PUT',{roleId:'not an id',teamKey:11})).status,400);
    assert.equal((await f.request('/seasons/1/aliases','admin','PUT',{roleId:'111111111111111111',teamKey:11})).status,200);
    assert.deepEqual((await(await f.request('/status?seasonId=1')).json()).aliases,[{RoleId:'111111111111111111',TeamSubmissionId:11}]);
    assert.equal(f.audits.at(-1).actor.AdminPlayerId,42);
  });
});

test('deleted scheduling posts disappear from review and stale pages cannot resolve them',async()=>{
  await fixture(async f=>{
    const post={messageId:'100',channelId:'99',authoredAt:'2026-10-23T12:00:00.000Z',content:'1011111 vs 9999999 Sunday 8pm EST'};
    f.schedules.ingest(post,1);
    assert.equal((await(await f.request('/status')).json()).messages.length,1);
    f.schedules.ingest({...post,content:'',deleted:true},1);
    const deleted=f.league.prepare("SELECT * FROM ScheduleMessages WHERE MessageId='100'").get();
    assert.equal(deleted.ParseStatus,'deleted');assert.equal(deleted.EventId,null);
    assert.deepEqual((await(await f.request('/status')).json()).messages,[]);
    const event=f.schedules.save(1,eventBody),changes=f.changes(),audits=f.audits.length;
    const response=await f.request('/messages/100/resolve','admin','POST',{eventId:event.EventId});
    assert.equal(response.status,409);assert.match((await response.json()).error,/deleted/);
    assert.deepEqual(f.league.prepare("SELECT * FROM ScheduleMessages WHERE MessageId='100'").get(),deleted);
    assert.equal(f.changes(),changes);assert.equal(f.audits.length,audits);
    // The API also filters legacy deleted rows before a worker's startup repair.
    f.league.exec("UPDATE ScheduleMessages SET ParseStatus='needs_review' WHERE MessageId='100'");
    assert.deepEqual((await(await f.request('/status')).json()).messages,[]);
    assert.equal((await f.request('/messages/100/resolve','admin','POST',{eventId:event.EventId})).status,409);
  });
});

test('test fixtures remain excluded unless development inclusion is explicitly enabled',async()=>{
  for(const includeLocalTests of [false,true])await fixture(async f=>{
    f.schedules.save(1,{...eventBody,sourceMessageId:'local-test:match-tab'});
    const data=await(await f.request('/status')).json();
    assert.equal(data.events.length,includeLocalTests?1:0);assert.equal(data.localTesting,includeLocalTests);
  },{includeLocalTests});
});
