import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {InhouseStore} from '../inhouses/store.js';
import {createInhouseRoutes} from '../routes/inhouseRoutes.js';
import {inhouseFixture} from './helpers/inhouseFixture.js';

const setMode=(store,availability)=>store.setAvailability({availability,version:store.settings().version},99);

test('availability defaults to admin testing; closing clears only waiting entries and existing games can still complete',()=>{
  const f=inhouseFixture();
  try {
    assert.equal(f.store.settings().availability,'admin_testing');
    const id=f.ten();f.ready(id);f.join(11);
    setMode(f.store,'closed');
    assert.equal(f.store.queue().length,0);assert.equal(f.store.game(id).status,'awaiting_game');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n,10);
    assert.throws(()=>f.join(12),{status:409});assert.throws(()=>f.store.startAdminTest(99),{status:409});
    f.store.tick();assert.equal(f.store.snapshot().games.length,1);
    f.store.applyMatch(id,f.match(id));assert.equal(f.store.game(id).status,'completed');
    assert.equal(f.store.settings().availability,'closed');assert.equal(f.store.queueSummary().count,0);
    assert.throws(()=>f.join(1),{status:409});
    setMode(f.store,'admin_testing');f.join(1);assert.equal(f.store.queueSummary().count,1);
    assert.equal(f.store.auditLog().find(a=>a.action==='availability'&&a.details.to==='closed').details.waitingReleased,1);
    assert.ok(f.store.botStatus().filter(b=>!b.gameId).every(b=>b.status==='idle'),'Mode changes do not log bots off');
  }finally{f.close();}
});

test('closing public access cannot requeue an old failed public ready check into private admin testing',()=>{
  const f=inhouseFixture();
  try {
    setMode(f.store,'open');const id=f.ten();f.store.ready(id,1);f.join(11);
    setMode(f.store,'admin_testing');assert.equal(f.store.queueSummary().count,0);
    f.advance(60001);f.store.tick();
    assert.equal(f.store.game(id).status,'cancelled');assert.equal(f.store.queueSummary().count,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n,0);
  }finally{f.close();}
});

test('availability can be saved before ticket setup and rejects stale or invalid updates',()=>{
  const db=new Database(':memory:');
  try {
    const store=new InhouseStore(db),initial=store.settings();assert.equal(initial.leagueId,null);
    setMode(store,'closed');assert.equal(store.settings().availability,'closed');
    assert.throws(()=>store.setAvailability({version:initial.version,availability:'open'},99),{status:409});
    assert.throws(()=>setMode(store,'invalid'),{status:400});
    setMode(store,'open');assert.throws(()=>store.join(1,{roles:[1],offRole:true},'One'),/configure/);
  }finally{db.close();}
});

test('closing blocks player endpoints and ends existing streams after their active game finishes; management stays accessible', {timeout:15000},async()=>{
  const f=inhouseFixture();let server,routes;
  const abort=new AbortController();
  try {
    const admin=(req,res,next)=>req.user?.isAdmin?next():res.sendStatus(req.user?403:401);
    routes=createInhouseRoutes({store:f.store,requireAdmin:admin});
    const app=express();app.use(express.json());app.use((req,res,next)=>{
      const id=req.get('x-test-user');req.isAuthenticated=()=>Boolean(id);
      if(id)req.user={id:String(76561197960265728n+BigInt(id)),isAdmin:id==='99'};
      next();
    });app.use('/api/inhouses',routes.publicRoutes);app.use('/api/admin/inhouses',admin,routes.adminRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}/api`;
    const request=(path,id,method='GET',body)=>fetch(base+path,{method,signal:abort.signal,headers:{'Content-Type':'application/json',...(id?{'x-test-user':String(id)}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const change=async(mode,id=99)=>request('/admin/inhouses/availability',id,'PUT',{availability:mode,version:f.store.settings().version});
    assert.equal((await request('/inhouses/availability')).status,200);
    assert.equal((await request('/inhouses/state')).status,401);assert.equal((await request('/inhouses/state',1)).status,403);
    assert.equal((await change('open',1)).status,403);assert.equal(f.store.settings().availability,'admin_testing');
    assert.equal((await change('open')).status,200);
    assert.equal((await request('/inhouses/state')).status,200);
    assert.equal((await request('/inhouses/queue',null,'POST',{roles:[1],offRole:true})).status,401);
    assert.equal((await request('/inhouses/queue',1,'POST',{roles:[1],offRole:true})).status,200);
    for(let id=2;id<=10;id++)f.join(id);f.ready(1);f.join(40);
    async function subscribe(id,path='/inhouses/stream',event='state') {
      const response=await request(path,id);assert.equal(response.status,200);
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      return async predicate=>{for(;;){const end=buffer.indexOf('\n\n');if(end<0){const chunk=await reader.read();if(chunk.done)throw Error('Stream closed');buffer+=decoder.decode(chunk.value,{stream:true});continue;}
        const part=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(!part.split('\n').includes(`event: ${event}`))continue;
        const data=JSON.parse(part.split('\n').find(line=>line.startsWith('data: ')).slice(6));if(!predicate||predicate(data))return data;
      }};
    }
    const playerStream=await subscribe(1),observerStream=await subscribe(80),activity=await subscribe(1,'/inhouses/activity/stream','queue');
    assert.equal((await playerStream()).queue.length,1);await observerStream();await activity();
    assert.equal((await change('admin_testing')).status,200);
    f.ten(11);f.ready(2);
    const narrowed=await playerStream(data=>data.settings.availability==='admin_testing'&&data.revision>=f.store.revision());
    assert.deepEqual(narrowed.games.map(g=>g.id),[1]);assert.equal(narrowed.queue.length,0);assert.equal(narrowed.bots.length,0);
    assert.equal((await observerStream(data=>data.settings.availability==='admin_testing')).games.length,0);
    const privateActivity=await activity(data=>data.availability==='admin_testing');
    assert.deepEqual(privateActivity.games.map(g=>g.id),[1]);assert.equal(privateActivity.count,0);
    assert.equal((await request('/inhouses/games/2',1)).status,403);
    assert.deepEqual((await (await request('/inhouses/games',1)).json()).games.map(g=>g.id),[1]);
    assert.equal((await request('/inhouses/queue',1,'POST',{roles:[1],offRole:true})).status,403);
    assert.equal((await request('/inhouses/state',80)).status,403);
    const full=await(await request('/inhouses/state',99)).json();assert.equal(full.games.length,2);
    assert.equal((await change('closed')).status,200);
    assert.equal((await request('/inhouses/queue',99,'POST',{roles:[1],offRole:true})).status,403);
    assert.equal((await request('/admin/inhouses/test',99,'POST',{playerCount:1})).status,409);
    const management=await subscribe(99,'/admin/inhouses/stream');
    assert.equal((await management()).games.length,2);
    f.store.applyMatch(1,f.match(1));
    const result=await playerStream(data=>data.games[0]?.status==='completed');
    assert.equal(result.games[0].players[0].ratingDelta!=null,true);
    await assert.rejects(()=>playerStream(),/Stream closed/);
    f.store.cancel(2,'Finish closed-mode access test',99);
    assert.equal((await management(data=>data.games.every(game=>['completed','cancelled'].includes(game.status)))).games.length,2);
    for(const id of [null,1,40,99])for(const path of ['/state','/queue','/stream','/activity','/activity/stream','/games','/games/1','/me','/games/1/lobby','/games/1/chat']) {
      assert.equal((await request('/inhouses'+path,id)).status,403,`Closed blocks ${path} for ${id||'anonymous'}`);
    }
    assert.equal((await request('/admin/inhouses/status',99)).status,200);
    assert.equal((await request('/admin/inhouses/status',1)).status,403);
    const status=await(await request('/inhouses/availability',1)).json();
    assert.equal(status.hasHistory,true);assert.equal(status.canAccess,false);assert.equal(status.activeGameId,null);assert.equal(status.availability,'closed');
    assert.equal((await(await request('/inhouses/availability',99)).json()).canAccess,false);
    assert.equal(f.store.queueSummary().count,0);
    await change('open');
    assert.equal((await request('/inhouses/games/1',1)).status,200);
  }finally{abort.abort();routes?.stream.close();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});
