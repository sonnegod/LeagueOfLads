import test from 'node:test';
import assert from 'node:assert/strict';
import {inhouseBotFixture as fixture} from './helpers/inhouseBotFixture.js';
import {isBotOnlyLobby, steamIdForPlayer} from '../inhouses/botProtocol.js';

function launch(f, count=10) {
  let id;
  if (count===10) id=f.ten();
  else {
    for(let player=1;player<=count;player++)f.join(player);
    id=f.store.startAdminTest(1,{playerCount:count}).gameId;
  }
  f.ready(id);f.step();f.fill(1);
  for(let tick=0;tick<15&&f.store.game(id).status!=='playing';tick++)f.step();
  assert.equal(f.store.game(id).status,'playing');
  return id;
}
const empty=f=>{const lobby=f.sessions.get(1).lobby;lobby.memberIndices=[lobby.allMembers.findIndex(p=>p.id===f.sessions.get(1).steamId)];};
const abandons=f=>f.commands.filter(c=>c.name==='abandon');

for(const count of [1,2,10])test(`${count}-player game: only-bot membership releases the session after a grace period, without ratings or destroying the lobby`,()=>{
  const f=fixture();try {
    const id=launch(f,count);empty(f);f.step();
    f.advance(59000);f.pool.tick();assert.equal(abandons(f).length,0);
    f.advance(1000);f.pool.tick();
    assert.equal(abandons(f).length,1);
    assert.equal(f.commands.some(c=>c.name==='destroy'),false);
    assert.equal(f.store.game(id).status,'playing','Keep reservations until Steam confirms departure');
    assert.ok(f.store.game(id).lobbyCleanupRequestedAt);
    assert.equal(f.store.botStatus()[0].gameId,id);
    f.step();assert.equal(f.store.game(id).status,'cancelled');
    assert.match(f.store.game(id).cancelReason,/All players left/);
    f.step();f.step();
    assert.equal(f.store.botStatus()[0].gameId,null);
    assert.equal(f.store.botStatus()[0].status,'idle');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n,0);
    assert.ok(f.store.snapshot().leaderboard.every(p=>p.games===0&&p.rating===1000));
    assert.equal(f.store.auditLog().filter(a=>a.action==='empty-lobby-cleanup-requested').length,1);
  }finally{f.cleanup();}
});

for(const count of [2,10])test(`${count}-player game: even one other current lobby member keeps the bot assigned`,()=>{
  const f=fixture();try {
    const id=launch(f,count),lobby=f.sessions.get(1).lobby;
    lobby.memberIndices=[0,1];lobby.allMembers[1].leaverStatus=3;
    f.step();f.advance(120000);f.pool.tick();
    assert.equal(abandons(f).length,0);assert.equal(f.store.game(id).status,'playing');
    assert.equal(f.store.botStatus()[0].gameId,id);
    // The policy is literally bot-only, so an outsider/spectator counts too.
    lobby.allMembers.push({id:steamIdForPlayer(999),team:3});lobby.memberIndices=[0,lobby.allMembers.length-1];
    f.step();f.advance(120000);f.pool.tick();assert.equal(abandons(f).length,0);
  }finally{f.cleanup();}
});

test('returning to the lobby resets the entire empty grace period',()=>{
  const f=fixture();try {
    launch(f,2);empty(f);f.step();f.advance(30000);f.fill(1);f.step();
    empty(f);f.step();f.advance(59000);f.pool.tick();assert.equal(abandons(f).length,0);
    f.advance(1000);f.pool.tick();assert.equal(abandons(f).length,1);
  }finally{f.cleanup();}
});

test('unknown membership, bot disconnection and missing lobby data do not imply an abandoned game',()=>{
  const f=fixture();try {
    const id=launch(f),session=f.sessions.get(1),lobby=session.lobby;
    for(const indices of [[],[0,999]]) {
      lobby.memberIndices=indices;f.step();f.advance(120000);f.pool.tick();
      assert.equal(abandons(f).length,0);
    }
    empty(f);f.step();f.advance(30000);session.ready=false;session.hasLobbyState=false;f.pool.tick();
    f.advance(120000);session.ready=true;f.pool.tick();assert.equal(abandons(f).length,0);
    session.hasLobbyState=true;f.step();assert.equal(abandons(f).length,0,'Reconnect starts a new grace period');
    session.lobby=null;f.step();f.advance(120000);f.pool.tick();
    assert.equal(f.store.game(id).status,'playing');assert.equal(abandons(f).length,0);
    assert.equal(f.store.botStatus()[0].gameId,id);
  }finally{f.cleanup();}
});

test('failed departure is retried at a bounded rate and a restarted worker resumes the persisted cleanup',()=>{
  const f=fixture();try {
    const id=launch(f,1);empty(f);
    const session=f.sessions.get(1),command=session.command;
    session.command=function(name,data){if(name==='abandon'){f.commands.push({id:1,name,data});return;}command.call(this,name,data);};
    f.step();f.advance(60000);f.pool.tick();
    const requested=f.store.game(id).lobbyCleanupRequestedAt;
    assert.equal(abandons(f).length,1);f.advance(14000);f.pool.tick();assert.equal(abandons(f).length,1);
    f.advance(1000);f.pool.tick();assert.equal(abandons(f).length,2);
    assert.equal(f.store.botStatus()[0].gameId,id);assert.equal(f.store.game(id).status,'playing');
    f.restart();f.step();assert.equal(abandons(f).length,3);
    assert.equal(f.store.game(id).lobbyCleanupRequestedAt,requested);
    f.step();f.step();f.step();assert.equal(f.store.botStatus()[0].status,'idle');
    assert.equal(f.store.auditLog().filter(a=>a.action==='empty-lobby-cleanup-requested').length,1);
  }finally{f.cleanup();}
});

test('restart after Steam cleared the lobby finalizes pending cleanup without recreating the old game',()=>{
  const f=fixture();try {
    const id=launch(f,1);empty(f);f.step();f.advance(60000);f.pool.tick();
    assert.equal(f.sessions.get(1).lobby,null);
    const creates=f.commands.filter(c=>['create','join'].includes(c.name)).length;
    f.restart();f.step();f.step();f.step();
    assert.equal(f.store.game(id).status,'cancelled');assert.equal(f.store.botStatus()[0].status,'idle');
    assert.equal(f.commands.filter(c=>['create','join'].includes(c.name)).length,creates);
  }finally{f.cleanup();}
});

test('confirmed results beat empty-lobby cleanup and retain their normal ratings',()=>{
  const f=fixture();try {
    const id=launch(f);empty(f);f.step();f.advance(60000);
    Object.assign(f.sessions.get(1).lobby,{state:3,gameState:6,matchOutcome:2,matchDuration:600});
    f.pool.tick();
    assert.equal(f.store.game(id).status,'completed');assert.equal(abandons(f).length,0);
    assert.ok(f.store.snapshot().leaderboard.every(p=>p.games===1));
    f.step();f.step();f.step();assert.equal(f.store.botStatus()[0].status,'idle');
    assert.equal(f.store.game(id).status,'completed');
  }finally{f.cleanup();}
});

test('empty postgame with no winner can free its bot without inventing a result',()=>{
  const f=fixture();try {
    const id=launch(f,2);empty(f);Object.assign(f.sessions.get(1).lobby,{state:3,gameState:6});
    f.step();f.advance(60000);f.pool.tick();assert.equal(abandons(f).length,1);
    f.step();f.step();f.step();
    assert.equal(f.store.game(id).status,'cancelled');assert.equal(f.store.game(id).winner,null);
    assert.equal(f.store.botStatus()[0].status,'idle');
  }finally{f.cleanup();}
});

test('an unassigned bot alone in an orphaned lobby also recovers to idle',()=>{
  const f=fixture();try {
    const session=f.sessions.get(1);
    session.lobby={lobbyId:'orphan',allMembers:[{id:session.steamId}],memberIndices:[0],state:2};
    f.step();assert.equal(f.store.botStatus()[0].status,'blocked');
    f.advance(60000);f.pool.tick();assert.equal(abandons(f).length,1);
    f.step();assert.equal(f.store.botStatus()[0].status,'idle');
    assert.equal(f.store.snapshot().games.length,0);
  }finally{f.cleanup();}
});

test('a new lobby with outstanding invitations keeps its normal join window',()=>{
  const f=fixture();try {
    f.join(1);const id=f.store.startAdminTest(1,{playerCount:1}).gameId;f.ready(id);f.step();f.step();
    assert.ok(f.store.game(id).lobbyJoinStartedAt);
    f.advance(120000);f.pool.tick();
    assert.equal(abandons(f).length,0);assert.equal(f.store.game(id).status,'awaiting_game');
    assert.equal(f.store.game(id).lobbyCleanupRequestedAt,null);
  }finally{f.cleanup();}
});

test('pending cleanup cannot act on an unrelated lobby or release its old reservation',()=>{
  const f=fixture();try {
    const id=launch(f,1);empty(f);f.step();f.advance(60000);f.pool.tick();
    const session=f.sessions.get(1);
    session.lobby={lobbyId:'different',leagueid:777,allMembers:[{id:session.steamId}],memberIndices:[0],state:2};
    f.step();f.advance(120000);f.pool.tick();
    assert.equal(abandons(f).length,1);assert.equal(f.store.game(id).status,'playing');
    assert.equal(f.store.botStatus()[0].gameId,id);
  }finally{f.cleanup();}
});

test('a cached outcome without a winner cannot hold a bot after its current lobby has cleared',()=>{
  const f=fixture();try {
    const id=launch(f,2);empty(f);const session=f.sessions.get(1);
    Object.assign(session.lobby,{state:3,gameState:6,matchOutcome:5});
    const cached=session.lobby;session.result=()=>cached;
    f.step();f.advance(60000);f.pool.tick();assert.equal(abandons(f).length,1);
    assert.equal(session.lobby,null);
    f.step();f.step();f.step();
    assert.equal(f.store.game(id).status,'cancelled');assert.equal(f.store.game(id).winner,null);
    assert.equal(f.store.botStatus()[0].status,'idle');
  }finally{f.cleanup();}
});

test('the bot-only check uses current membership, ignores historical players and rejects incomplete indices',()=>{
  const bot=steamIdForPlayer(1001),lobby={allMembers:[{id:bot},{id:steamIdForPlayer(1)}],memberIndices:[0]};
  assert.equal(isBotOnlyLobby(lobby,bot),true);
  for(const indices of [undefined,[],[0,1],[0,999],[-1],['0'],[99]])assert.equal(isBotOnlyLobby({...lobby,memberIndices:indices},bot),false);
});
