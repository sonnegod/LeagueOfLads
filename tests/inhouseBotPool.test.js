import test from 'node:test';
import assert from 'node:assert/strict';
import {inhouseBotFixture as fixture} from './helpers/inhouseBotFixture.js';
import {steamIdForPlayer} from '../inhouses/botProtocol.js';

test('production lobby chat announces the join window, greets by name and corrects wrong teams without repeating every tick',()=>{
  const f=fixture();
  try {
    f.join(1);f.store.profile(1,'Brae');const {gameId}=f.store.startAdminTest(1,{playerCount:1});f.ready(gameId);
    f.step();f.step();
    assert.ok(f.messages.some(m=>m.text.includes('15 minutes')));
    f.fill(1);const session=f.sessions.get(1);session.lobby.allMembers[1].team=4;
    f.step();assert.ok(f.messages.some(m=>m.text.includes('Brae: join Radiant (any slot).')));
    const count=f.messages.length;f.step();f.step();assert.equal(f.messages.length,count);
    session.lobby.allMembers[1].team=1;f.step();assert.equal(f.commands.at(-1).name,'unseat');
    f.step();assert.ok(f.messages.some(m=>m.text.includes('Brae: wrong team. Join Radiant')));
    session.lobby.allMembers=session.lobby.allMembers.slice(0,1);session.lobby.memberIndices=[0];f.step();
    f.fill(1);session.lobby.allMembers[1].team=4;f.step();
    assert.equal(f.messages.filter(m=>m.text.includes('Brae: join Radiant')).length,2,'Rejoining gets a fresh instruction');
    session.lobby.allMembers[1].team=0;session.lobby.allMembers[1].slot=5;f.step();
    assert.equal(f.commands.at(-1).name,'launch','Any slot on the assigned team still starts');
  }finally{f.cleanup();}
});

for(const broken of [false,true])test(`queued lobby messages ${broken?'cannot block launch when chat fails':'survive chat-channel join delay'}`,()=>{
  const f=fixture();
  try {
    f.join(1);const {gameId}=f.store.startAdminTest(1,{playerCount:1});f.ready(gameId);
    const session=f.sessions.get(1),send=session.sayLobby;let chatReady=false;
    session.sayLobby=text=>{if(broken)throw Error('Chat unavailable');return chatReady?send(text):false;};
    f.step();f.step();f.fill(1);f.step();
    assert.equal(f.commands.some(c=>c.name==='launch'),false);
    if(!broken){chatReady=true;f.step();assert.ok(f.messages.some(m=>m.text.includes('join Radiant')));}
    else for(let i=0;i<10;i++)f.step();
    assert.equal(f.commands.some(c=>c.name==='launch'),true);
  }finally{f.cleanup();}
});

test('simultaneous arrivals with long names are batched into bounded messages, and old lobby messages never carry into a reused bot',()=>{
  const f=fixture();
  try {
    const id=f.ten();f.ready(id);
    for(let player=1;player<=10;player++)f.store.profile(player,`Captain${player} `+'x'.repeat(100));
    f.step();f.step();f.fill(1);
    for(let tick=0;tick<6;tick++)f.step();
    assert.equal(f.commands.some(c=>c.name==='launch'),true);
    assert.ok(f.messages.every(m=>m.text.length<=500));
    assert.equal(f.messages.reduce((n,m)=>n+(m.text.match(/: join (Radiant|Dire)/g)||[]).length,0),10);
    f.store.cancel(id,'Finish long-name test',99);f.step();f.step();f.step();
    const before=f.messages.length;
    f.join(11);f.store.profile(11,'New Player');const next=f.store.startAdminTest(11,{playerCount:1}).gameId;f.ready(next);
    f.step();f.step();f.fill(1);f.step();
    assert.ok(f.messages.slice(before).some(m=>m.text.includes('New Player: join Radiant')));
    assert.ok(f.messages.slice(before).every(m=>!m.text.includes('Captain')));
  }finally{f.cleanup();}
});

test('the bot starts the join timer only after lobby confirmation/configuration and preserves it across restarts',()=>{
  const f=fixture();
  try {
    const id=f.ten();f.ready(id);
    assert.equal(f.store.game(id).deadline,null);
    f.advance(20*60000);f.store.tick();
    assert.equal(f.store.game(id).status,'awaiting_game');
    f.step();assert.equal(f.store.game(id).lobbyJoinStartedAt,null,'Sending create is not confirmation');
    const session=f.sessions.get(1);session.lobby.allowCheats=true;
    f.step();assert.equal(f.commands.at(-1).name,'details');
    assert.equal(f.store.game(id).deadline,null,'Configuration repair does not use the player join window');
    let announcement=null;
    const stop=f.store.subscribe(()=>{const game=f.store.snapshot().games.find(g=>g.id===id);if(game.lobbyJoinStartedAt)announcement=game;});
    f.step();stop();
    const opened=f.store.game(id);
    assert.equal(opened.lobbyJoinStartedAt,f.clock());
    assert.equal(opened.deadline,opened.lobbyJoinStartedAt+15*60000);
    assert.equal(announcement.deadline,opened.deadline,'The site receives the timer through the normal live snapshot');
    f.advance(5*60000);f.restart();f.step();
    assert.equal(f.store.game(id).deadline,opened.deadline,'Restart never renews the join window');
    assert.equal(f.store.auditLog().filter(a=>a.action==='lobby-opened').length,1);
    f.setNow(opened.deadline+1);f.store.tick();
    assert.equal(f.store.game(id).status,'awaiting_game');
    f.pool.tick();assert.equal(f.store.game(id).status,'cancelled');
    assert.match(f.store.game(id).cancelReason,/join timer expired/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n,0);
    f.step();f.step();assert.equal(f.store.botStatus()[0].gameId,null);
  }finally{f.cleanup();}
});

test('a bot owns expiry after its opened lobby disappears, without trying to recreate an expired lobby',()=>{
  const f=fixture();
  try {
    const id=f.ten();f.ready(id);f.step();f.step();
    const opened=f.store.game(id);assert.ok(opened.lobbyJoinStartedAt);
    f.sessions.get(1).lobby=null;f.setNow(opened.deadline+1);
    const creates=f.commands.filter(c=>c.name==='create'||c.name==='join').length;
    f.pool.tick();assert.equal(f.store.game(id).status,'cancelled');
    assert.equal(f.commands.filter(c=>c.name==='create'||c.name==='join').length,creates);
  }finally{f.cleanup();}
});

test('a newly created lobby unseats its bot before inviting, then accepts any slot on each assigned team', () => {
  const f = fixture({botStartsRadiant:true});
  try {
    const id = f.ten(); f.ready(id); f.step();
    const session = f.sessions.get(1);
    assert.equal(session.lobby.allMembers[0].slot, 1);
    f.step();
    assert.equal(f.commands.at(-1).name, 'unseat');
    assert.equal(f.commands.at(-1).data.accountId, 1001);
    assert.equal(session.lobby.allMembers[0].team, 4);
    f.step(); assert.equal(f.commands.at(-1).name, 'invite');
    const players = f.store.members(id);
    session.lobby.allMembers = [{id:session.steamId,team:4,slot:0}, ...['A','B'].flatMap(side =>
      players.filter(p=>p.side===side).sort((a,b)=>(a.position||9)-(b.position||9)||(a.pickNumber||0)-(b.pickNumber||0)||a.playerId-b.playerId)
        .map((p,index)=>({id:steamIdForPlayer(p.playerId),team:side==='A'?0:1,slot:5-index})))];
    session.lobby.memberIndices = session.lobby.allMembers.map((_,i)=>i);
    f.step(); assert.equal(f.commands.at(-1).name, 'launch');
  } finally {f.cleanup();}
});

test('five bots reserve five games atomically; a sixth group waits and receives a bot only after cleanup', () => {
  const f = fixture();
  try {
    for (let id = 1; id <= 60; id++) f.join(id);
    assert.equal(f.store.snapshot().games.length, 5);
    assert.equal(f.store.queue().length, 10);
    assert.deepEqual(f.store.botStatus().map(b => b.gameId), [1,2,3,4,5]);
    assert.deepEqual(f.store.snapshot().games.map(g => g.botId).sort(), [1,2,3,4,5]);
    f.ready(1); f.step();
    const before = f.store.rawGame(1);
    assert.ok(before.LobbyPassword); assert.equal(f.sessions.get(1).lobby.leagueid, 777);
    assert.equal(f.sessions.get(1).lobby.allowCheats, false);
    assert.equal(f.sessions.get(1).lobby.fillWithBots, false);
    assert.equal(f.store.game(1).lobbyPassword, undefined);
    assert.equal(f.store.lobbyDetails(1, 1).password, before.LobbyPassword);
    assert.throws(() => f.store.lobbyDetails(1, 51), {status: 403});
    f.store.cancel(1, 'Cancelled before launch', 99);
    assert.equal(f.store.queue().length, 10, 'Cancellation does not reuse a bot before it leaves its old lobby');
    f.step(); assert.equal(f.sessions.get(1).lobby, null);
    f.step(); f.step(); f.store.tick();
    assert.equal(f.store.queue().length, 0);
    assert.equal(f.store.game(6).botId, 1);
    assert.equal(f.store.botStatus()[0].gameId, 6);
  } finally {f.cleanup();}
});

test('the pool invites missing players, rejects outsiders and wrong sides, and launches only the verified roster', () => {
  const f = fixture();
  try {
    const id = f.ten(); f.ready(id); f.step(); f.step();
    assert.ok(f.commands.some(c => c.name === 'invite'));
    assert.equal(f.commands.some(c => c.name === 'launch'), false);
    f.fill(1);
    const session = f.sessions.get(1);
    const player = session.lobby.allMembers[1]; player.team = player.team === 0 ? 1 : 0;
    f.step(); assert.equal(f.commands.at(-1).name, 'unseat');
    assert.equal(f.commands.some(c => c.name === 'launch'), false);
    f.fill(1); session.lobby.allMembers.push({id: steamIdForPlayer(999), team: 3});
    session.lobby.memberIndices = session.lobby.allMembers.map((_, i) => i);
    f.step(); assert.equal(f.commands.at(-1).name, 'kick');
    f.fill(1); session.lobby.allMembers[1].slot = 5; session.lobby.allMembers[5].slot = 1; f.step();
    assert.equal(f.commands.at(-1).name, 'launch');
    assert.equal(JSON.parse(f.store.rawGame(id).LaunchRosterJson).length, 10);
    f.step(); assert.equal(f.store.game(id).status, 'playing'); assert.equal(f.store.game(id).matchId, 90001);
  } finally {f.cleanup();}
});

test('admin corrections are verified through a bot GC session and reconcile ratings without requeueing players', async () => {
  const f=fixture();
  try {
    const id=f.ten();f.ready(id);f.step();f.fill(1);f.step();f.step();
    const match=f.match(id,{matchId:99001,winner:'dire',duration:600});
    let queries=0;
    f.sessions.get(1).details=async matchId=>{queries++;assert.equal(matchId,99001);return match;};
    f.store.requestBotLookup(id,99001,'Correct the linked match',99);
    f.pool.tick();await new Promise(resolve=>setImmediate(resolve));f.step();
    assert.equal(queries,1);
    assert.equal(f.store.game(id).status,'completed');assert.equal(f.store.game(id).winner,'B');
    assert.equal(f.store.game(id).verification.status,'completed');
    assert.equal(f.store.queueSummary().count,0);
    assert.ok(f.store.snapshot().leaderboard.every(p=>p.games===1));
    f.step();assert.ok(f.store.snapshot().leaderboard.every(p=>p.games===1));
  } finally {f.cleanup();}
});

test('pending and mismatched GC correction responses cannot award a result', async () => {
  const f=fixture();
  try {
    const id=f.ten();f.ready(id);
    let match=f.match(id,{matchId:99002,winner:null});
    for(const session of f.sessions.values())session.details=async()=>match;
    f.store.requestBotLookup(id,99002,'Check a result',99);
    f.pool.tick();await new Promise(resolve=>setImmediate(resolve));f.step();
    assert.equal(f.store.game(id).verification.status,'pending');
    assert.equal(f.store.game(id).winner,null);
    match={...match,winner:'radiant',players:[]};
    f.advance(16000);f.pool.tick();await new Promise(resolve=>setImmediate(resolve));f.step();
    assert.equal(f.store.game(id).verification.status,'failed');
    assert.equal(f.store.game(id).winner,null);
    assert.ok(f.store.snapshot().leaderboard.every(p=>p.games===0));
  } finally {f.cleanup();}
});

test('a bot launch near the join deadline permits normal server allocation before the game begins', () => {
  const f=fixture();
  try {
    const id=f.ten();f.ready(id);f.step();f.fill(1);f.advance(14*60000);f.step();
    f.advance(2*60000);
    f.sessions.get(1).lobby.gameStartTime=Math.floor(f.clock()/1000);
    f.step();assert.equal(f.store.game(id).status,'playing');
    assert.equal(f.store.game(id).matchId,90001);
  } finally {f.cleanup();}
});

test('concurrent lobby outcomes settle the right rosters immediately without HTTP results and never rate twice', async () => {
  const f = fixture();
  try {
    for (let id = 1; id <= 50; id++) f.join(id);
    for (let id = 1; id <= 5; id++) f.ready(id);
    f.step(); for (let id = 1; id <= 5; id++) f.fill(id);
    f.step(); f.step();
    assert.ok(f.store.snapshot().games.every(g => g.status === 'playing'));
    f.advance(600000);
    for (let id = 1; id <= 5; id++) {
      const lobby = f.sessions.get(id).lobby;
      Object.assign(lobby, {matchOutcome: id % 2 ? 2 : 3, matchDuration: 600, state: 3});
      // Players leaving the postgame lobby must not erase the verified roster.
      lobby.allMembers = lobby.allMembers.slice(0,1); lobby.memberIndices = [0];
    }
    f.pool.tick();
    for (let id = 1; id <= 5; id++) {
      const g = f.store.game(id);
      assert.equal(g.status, 'completed'); assert.equal(g.winner, id % 2 ? 'A' : 'B');
      assert.equal(f.store.botMatchResult(g.matchId).winner, id % 2 ? 'radiant' : 'dire');
      assert.equal(f.db.prepare('SELECT MIN(Games) n FROM InhousePlayers').get().n, 1);
    }
    f.step(); f.step(); f.step(); await new Promise(resolve => setImmediate(resolve)); f.step();
    assert.equal(f.db.prepare('SELECT MAX(Games) n FROM InhousePlayers').get().n, 1);
    assert.equal(f.store.queue().length, 0);
    assert.ok(f.store.botStatus().every(bot => !bot.gameId));
  } finally {f.cleanup();}
});

test('restart resumes the saved account and lobby; offline accounts cannot start another game or guess a result', () => {
  const f = fixture();
  try {
    const id = f.ten(); f.ready(id); f.step(); f.fill(1); f.step(); f.step();
    const original = f.store.rawGame(id), creates = f.commands.filter(c => c.name === 'create').length;
    f.restart(); f.step();
    assert.equal(f.store.rawGame(id).LobbyId, original.LobbyId);
    assert.equal(f.commands.filter(c => c.name === 'create').length, creates);
    f.sessions.get(1).ready = false; f.sessions.get(1).status = 'offline';
    f.advance(7200000); f.pool.tick();
    assert.equal(f.store.game(id).status, 'playing');
    assert.equal(f.store.botStatus()[0].gameId, id);
    assert.equal(f.store.botStatus()[0].status, 'offline');
    assert.throws(() => f.join(1), /already/);
  } finally {f.cleanup();}
});

test('unscored outcomes cancel without rating; a foreign ticket cannot resolve the assigned inhouse', () => {
  const f = fixture();
  try {
    const id = f.ten(); f.ready(id); f.step(); f.fill(1); f.step(); f.step();
    const lobby = f.sessions.get(1).lobby;
    Object.assign(lobby, {leagueid: 999, state: 3, matchOutcome: 2, matchDuration: 600});
    f.step(); assert.equal(f.store.game(id).status, 'playing');
    Object.assign(lobby, {leagueid: 777, matchOutcome: 66});
    f.step(); assert.equal(f.store.game(id).status, 'cancelled');
    assert.equal(f.db.prepare('SELECT MAX(Games) n FROM InhousePlayers').get().n, 0);
  } finally {f.cleanup();}
});

test('launch allocation is not cancelled by the join deadline, and a failed launch returning to the waiting lobby is released', () => {
  const f = fixture();
  try {
    const id = f.ten(); f.ready(id); f.step(); f.fill(1); f.step();
    const lobby = f.sessions.get(1).lobby;
    // Steam has accepted launch but is still allocating its game server.
    Object.assign(lobby,{state:1,matchId:'0'});
    f.advance(16 * 60000); f.store.tick(); f.pool.tick();
    assert.equal(f.store.game(id).status,'awaiting_game');
    Object.assign(lobby,{state:0,matchId:'0'});
    f.step(); assert.equal(f.store.game(id).status,'cancelled');
    assert.equal(f.store.queue().length,0);
  } finally {f.cleanup();}
});

test('ticket configuration retries target the actual new lobby, and offline bots leave queued users unreserved', () => {
  const f = fixture();
  try {
    const id = f.ten(); f.ready(id); f.step();
    const lobby = f.sessions.get(1).lobby;
    lobby.leagueid=0; f.step();
    assert.equal(f.store.game(id).lobbyId,lobby.lobbyId,'The actual lobby remains visible even before its ticket is accepted');
    assert.match(f.store.game(id).hostingError,/ticket 777.*league-admin/);
    assert.equal(f.commands.at(-1).name,'details');
    assert.equal(f.commands.at(-1).data.lobbyId,lobby.lobbyId);
    assert.equal(f.commands.at(-1).data.leagueid,777);
    f.store.cancel(id,'End test',99); f.step(); f.step();
    for(const session of f.sessions.values()){session.ready=false;session.status='offline';}
    f.step();
    for(let player=11;player<=20;player++)f.join(player);
    assert.equal(f.store.queue().length,10);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseGames').get().n,1);
  } finally {f.cleanup();}
});
