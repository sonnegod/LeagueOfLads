import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {InhouseStore} from '../inhouses/store.js';
import {createInhouseRoutes} from '../routes/inhouseRoutes.js';
import {inhouseFixture,inhousePreviewAdmin} from './helpers/inhouseFixture.js';
import {inhouseBotFixture} from './helpers/inhouseBotFixture.js';

test('solo testing is explicit, reserves only the requesting queued admin, and snapshots All Pick without changing normal settings',()=>{
  const f=inhouseFixture({gameMode:2,draftMode:'captain',queueMode:'preference'});
  try {
    assert.throws(()=>f.store.startAdminTest(1,{playerCount:1}),{status:409});
    f.join(1);const settings=f.store.settings();
    assert.throws(()=>f.store.startAdminTest(2,{playerCount:1}),{status:403});
    assert.throws(()=>f.store.startAdminTest(1,{playerCount:3}),{status:400});
    const {gameId}=f.store.startAdminTest(1,{playerCount:1});
    let game=f.store.game(gameId);
    assert.equal(game.playerCount,1);assert.equal(game.rated,false);assert.equal(game.gameMode,1);
    assert.equal(game.queueMode,'fifo');assert.equal(game.draftMode,'automatic');
    assert.deepEqual(game.players.map(p=>p.playerId),[1]);assert.deepEqual(f.store.settings(),settings);
    f.store.ready(gameId,1);game=f.store.game(gameId);
    assert.equal(game.lobbyChoices.captainId,1);assert.equal(game.captainB,null);
    assert.deepEqual(game.lobbyChoices.options,['radiant','dire']);
    assert.throws(()=>f.store.startAdminTest(1,{playerCount:1}),{status:409});
    assert.throws(()=>f.store.leave(1),{status:409});
    f.join(2);f.join(3);assert.throws(()=>f.store.startAdminTest(2,{playerCount:1}),{status:409});
  }finally{f.close();}
});

for(const side of ['radiant','dire'])for(const winner of ['radiant','dire'])test(`real worker path with fake Steam: solo on ${side}, ${winner} wins, result releases player and leaves rating unchanged`,()=>{
  const f=inhouseBotFixture({gameMode:2,manualLobbyChoices:true});
  try {
    f.join(1);const {gameId}=f.store.startAdminTest(1,{playerCount:1});
    f.store.ready(gameId,1);f.store.chooseLobby(gameId,1,{turn:0,choice:side});
    f.step();f.step();assert.ok(f.store.game(gameId).lobbyJoinStartedAt);
    assert.ok(f.commands.some(c=>c.name==='invite'&&c.playerId===1));
    f.fill(1);f.step();assert.equal(f.commands.at(-1).name,'launch');f.step();
    assert.equal(f.store.game(gameId).status,'playing');
    assert.throws(()=>f.join(1),{status:409});
    const session=f.sessions.get(1);
    Object.assign(session.lobby,{state:3,matchOutcome:winner==='radiant'?2:3,matchDuration:30});f.advance(30000);f.step();
    const game=f.store.game(gameId),player=game.players[0];
    assert.equal(game.status,'completed');assert.equal(game.winner,side===winner?'A':'B');assert.equal(game.rated,false);
    assert.equal(player.ratingBefore,1000);assert.equal(player.ratingAfter,1000);assert.equal(player.ratingDelta,0);
    assert.equal(f.store.queueSummary().count,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n,0);
    assert.deepEqual(f.db.prepare('SELECT Rating,Games,Wins,Losses FROM InhousePlayers WHERE PlayerId=1').get(),{Rating:1000,Games:0,Wins:0,Losses:0});
    f.store.applyMatch(gameId,f.store.botMatchResult(game.matchId));f.store.reconcileRatings();
    assert.equal(f.store.profile(1,'One').games,0);
    f.step();f.step();assert.equal(f.store.botStatus()[0].gameId,null);
    f.join(1);assert.equal(f.store.queueSummary().count,1,'Manual requeue is available after completion');
    assert.equal(f.store.snapshot().games.length,1,'Normal queue selection still requires ten');
  }finally{f.cleanup();}
});

test('solo games require their exact player and ticket, and corrections/replay cannot affect rated results',()=>{
  const f=inhouseFixture();
  try {
    f.join(1);const {gameId}=f.store.startAdminTest(1,{playerCount:1});f.ready(gameId);
    const match=f.match(gameId,{duration:30});
    for(const change of [{players:[]},{players:[...match.players,{playerId:2,side:'dire'}]},{players:[{playerId:99,side:'radiant'}]},{leagueId:888}])
      assert.throws(()=>f.store.applyMatch(gameId,{...match,...change}),{status:409});
    f.store.applyMatch(gameId,match);f.advance(120000);
    const rated=f.ten();f.ready(rated);f.store.applyMatch(rated,f.match(rated,{matchId:9002}));
    const standings=f.db.prepare('SELECT PlayerId,Rating,Games,Wins,Losses FROM InhousePlayers ORDER BY PlayerId').all();
    f.store.applyMatch(gameId,{...match,winner:'dire'},{correction:true,reason:'Correct the solo outcome',actorId:99});
    assert.deepEqual(f.db.prepare('SELECT PlayerId,Rating,Games,Wins,Losses FROM InhousePlayers ORDER BY PlayerId').all(),standings);
    assert.ok(standings.every(p=>p.Games===1&&Number.isFinite(p.Rating)));
  }finally{f.close();}
});

test('solo test API is admin-only, requires the admin own queue entry and rejects repeated starts',async()=>{
  const f=inhouseFixture();let server,routes;
  try {
    f.join(99);routes=createInhouseRoutes({store:f.store,requireAdmin:inhousePreviewAdmin});
    const app=express();app.use(express.json());app.use((req,res,next)=>{
      const id=req.get('x-test-user');req.isAuthenticated=()=>Boolean(id);if(id)req.user={id:String(76561197960265728n+BigInt(id))};next();
    });app.use('/api/admin/inhouses',inhousePreviewAdmin,routes.adminRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}/api/admin/inhouses/test`;
    const post=(user,role)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(user?{'x-test-user':user}:{}),...(role?{'x-test-preview-role':role}:{})},body:JSON.stringify({playerCount:1})});
    assert.equal((await post()).status,401);assert.equal((await post('99','user')).status,403);
    assert.equal((await post('98')).status,403);assert.equal(f.store.queueSummary().count,1);
    const response=await post('99');assert.equal(response.status,200);
    assert.equal(f.store.game((await response.json()).gameId).playerCount,1);
    assert.equal((await post('99')).status,409);assert.equal(f.store.snapshot().games.length,1);
  }finally{routes?.stream.close();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});

test('upgrading the old player-count constraint preserves game records, chat, bot assignments, indexes and foreign keys',()=>{
  const source=inhouseFixture();const db=new Database(':memory:');
  try {
    const id=source.ten();source.ready(id);source.store.hostingUpdate(id,{LobbyId:'12345678901234567'});source.store.startLobbyTimer(id,'12345678901234567');
    source.store.postChat(id,1,{text:'Keep existing lobby chat',clientId:'migration_chat_1'});
    source.store.requestBotLookup(id,9001,'Keep existing pending verification',99);
    const tables=source.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name LIKE 'Inhouse%'").all();
    db.pragma('foreign_keys = OFF');
    for(const table of tables)db.exec(table.name==='InhouseGames'?table.sql.replace('PlayerCount IN (1,2,10)','PlayerCount IN (2,10)'):table.sql);
    for(const table of tables){
      const rows=source.db.prepare(`SELECT * FROM ${table.name}`).all();if(!rows.length)continue;
      const columns=Object.keys(rows[0]);const insert=db.prepare(`INSERT INTO ${table.name} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
      for(const row of rows)insert.run(...columns.map(key=>row[key]));
    }
    for(const index of source.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name LIKE 'Inhouse%' AND sql IS NOT NULL").all())db.exec(index.sql);
    db.pragma('foreign_keys = ON');assert.deepEqual(db.pragma('foreign_key_check'),[]);
    const before=db.prepare('SELECT * FROM InhouseGames').all(),originalQueue=db.prepare('SELECT * FROM InhouseQueue').all();
    const store=new InhouseStore(db,{clock:source.clock});
    assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.deepEqual(db.pragma('foreign_key_check'),[]);
    assert.deepEqual(db.prepare('SELECT * FROM InhouseGames').all(),before);assert.deepEqual(db.prepare('SELECT * FROM InhouseQueue').all(),originalQueue);
    assert.equal(store.readChat(id,1).messages[0].text,'Keep existing lobby chat');
    assert.equal(store.botStatus()[0].gameId,id);assert.equal(store.game(id).verification.status,'pending');
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_InhouseGames_Status'").get());
    assert.equal(new InhouseStore(db,{clock:source.clock}).game(id).players.length,10);
    store.cancel(id,'Finish migrated test',99);store.join(99,{roles:[1],offRole:true},'Admin');
    assert.equal(store.game(store.startAdminTest(99,{playerCount:1}).gameId).playerCount,1);
  }finally{db.close();source.close();}
});
