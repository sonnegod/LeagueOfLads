import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {inhouseFixture,inhousePreviewAdmin} from './helpers/inhouseFixture.js';
import {InhouseStore} from '../inhouses/store.js';
import {createInhouseWorker} from '../inhouses/worker.js';
import {inhouseBotFixture} from './helpers/inhouseBotFixture.js';
import {ratingChanges} from '../inhouses/model.js';
import {createInhouseRoutes} from '../routes/inhouseRoutes.js';

test('an explicit two-player test reserves exactly two people and snapshots its own format without changing queue rules',()=>{
  const f=inhouseFixture({queueMode:'preference',draftMode:'captain'});
  try {
    const settings=f.store.settings();
    assert.throws(()=>f.store.startAdminTest(99),{status:409});
    f.join(1,{roles:[1],offRole:false});assert.throws(()=>f.store.startAdminTest(99),{status:409});
    f.join(2,{roles:[1],offRole:false});assert.equal(f.store.snapshot().games.length,0);
    const {gameId}=f.store.startAdminTest(99);
    assert.deepEqual(f.store.settings(),settings);assert.equal(f.store.queue().length,0);
    const game=f.store.game(gameId);
    assert.equal(game.status,'ready');assert.equal(game.playerCount,2);assert.equal(game.draftMode,'automatic');assert.equal(game.queueMode,'fifo');
    assert.throws(()=>f.store.startAdminTest(98),{status:409});
    f.store.ready(gameId,1);assert.equal(f.store.game(gameId).status,'ready');
    f.store.ready(gameId,2);assert.equal(f.store.game(gameId).status,'awaiting_game');
    assert.deepEqual(f.store.game(gameId).players.map(p=>p.side).sort(),['A','B']);
    assert.throws(()=>f.store.leave(1),{status:409});
    assert.equal(f.store.auditLog().find(a=>a.action==='test-started').actorId,99);
    f.join(3);f.join(4);f.join(5);assert.throws(()=>f.store.startAdminTest(99),{status:409});
    f.ten(10);assert.equal(f.store.game(2).playerCount,10,'Automatic selection still requires ten');
    assert.equal(f.store.game(2).draftMode,'captain');
  }finally{f.close();}
});

test('the assigned bot launches a two-admin lobby, records a short result once and releases both players for manual requeue',async()=>{
  const f=inhouseBotFixture();let worker;
  try {
    f.store.saveSettings({...f.store.settings(),leagueId:18083});
    f.join(1);f.join(2);const {gameId}=f.store.startAdminTest(99);f.ready(gameId);
    worker=createInhouseWorker(f.store,{...f.pool,start(){}},{clock:f.clock});
    await worker.step();f.fill(1);f.advance(1000);await worker.step();
    f.advance(1000);await worker.step();
    assert.equal(f.store.game(gameId).status,'playing');assert.equal(f.store.game(gameId).matchId,90001);
    assert.equal(f.store.profile(1,'One').games,0);
    Object.assign(f.sessions.get(1).lobby,{state:3,matchOutcome:2,matchDuration:120});
    f.advance(120000);await worker.step();
    const game=f.store.game(gameId);assert.equal(game.status,'completed');assert.equal(game.winner,'A');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n,0);
    assert.ok(f.store.snapshot().leaderboard.every(p=>p.games===1));
    f.advance(1000);await worker.step();f.advance(1000);await worker.step();
    assert.ok(f.store.snapshot().leaderboard.every(p=>p.games===1));
    assert.equal(f.store.queueSummary().count,0,'Completed players are released, not automatically requeued');
  }finally{worker?.close();f.cleanup();}
});

test('each saved format enforces its own identities and sides; normal games keep their five-minute remake guard',()=>{
  const f=inhouseFixture();
  try {
    f.join(1);f.join(2);const {gameId}=f.store.startAdminTest(99);f.ready(gameId);
    const two=f.match(gameId);
    assert.throws(()=>f.store.applyMatch(gameId,{...two,players:two.players.slice(0,1)}),{status:409});
    assert.throws(()=>f.store.applyMatch(gameId,{...two,players:[two.players[0],two.players[0]]}),{status:409});
    assert.throws(()=>f.store.applyMatch(gameId,{...two,players:two.players.map(p=>({...p,side:'radiant'}))}),{status:409});
    assert.throws(()=>f.store.applyMatch(gameId,{...two,leagueId:999}),{status:409});
    f.ten(10);f.ready(2);const ten=f.match(2,{matchId:9002,duration:120});
    assert.throws(()=>f.store.applyMatch(2,{...ten,players:ten.players.slice(0,2)}),{status:409});
    assert.equal(f.store.applyMatch(2,ten).completed,false);
    assert.equal(f.store.game(2).status,'playing');

  }finally{f.close();}
});

test('1v1 Elo uses each actual team average and the new column migrates old games as ten-player lobbies',()=>{
  const changes=ratingChanges([{playerId:1,side:'A',rating:1400,games:0},{playerId:2,side:'B',rating:1000,games:0}],'A');
  assert.ok(Math.abs(changes[0].delta-48/11)<1e-8);assert.ok(Math.abs(changes[1].delta+48/11)<1e-8);
  const f=inhouseFixture();
  try {
    f.ten();f.db.exec('ALTER TABLE InhouseGames DROP COLUMN PlayerCount');
    const reopened=new InhouseStore(f.db,{clock:f.clock});
    assert.equal(reopened.game(1).playerCount,10);
    assert.equal(reopened.settings().playerCount,undefined,'No global test-size setting is introduced');
    assert.equal(new InhouseStore(f.db,{clock:f.clock}).game(1).players.length,10);
  }finally{f.close();}
});

test('the test-start button API requires an admin and stale or repeated clicks cannot create another game',async()=>{
  const f=inhouseFixture(),routes=createInhouseRoutes({store:f.store,api:{},requireAdmin:inhousePreviewAdmin});let server;
  try {
    f.join(1);f.join(2);const app=express();app.use(express.json());
    app.use((req,res,next)=>{const id=req.get('x-test-user');req.isAuthenticated=()=>Boolean(id);if(id)req.user={id:String(76561197960265728n+BigInt(id))};next();});
    app.use('/api/admin/inhouses',inhousePreviewAdmin,routes.adminRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}/api/admin/inhouses/test`;
    const post=(user,role)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(user?{'x-test-user':user}:{}),...(role?{'x-test-preview-role':role}:{})},body:'{}'});
    assert.equal((await post()).status,401);assert.equal((await post('99','user')).status,403);
    assert.equal(f.store.queue().length,2);
    const result=await post('99');assert.equal(result.status,200);assert.equal((await result.json()).gameId,1);
    assert.equal((await post('98')).status,409);assert.equal(f.store.snapshot().games.length,1);
  }finally{routes.stream.close();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});
