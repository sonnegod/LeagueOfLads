import test from 'node:test';
import assert from 'node:assert/strict';
import {inhouseFixture} from './helpers/inhouseFixture.js';
import {inhouseBotFixture} from './helpers/inhouseBotFixture.js';

for(const coin of [0,1])for(const first of ['radiant','dire','first_pick','second_pick'])for(const remaining of [0,1]) {
  test(`captain choices: coin ${coin}, ${first}, remaining option ${remaining}`,()=>{
    const f=inhouseFixture({gameMode:2,manualLobbyChoices:true,random:()=>coin});
    try {
      const id=f.ten(),initial=f.ready(id), captain=coin===0?initial.captainA:initial.captainB;
      const firstSide=coin===0?'A':'B',other=coin===0?'B':'A';
      assert.equal(initial.lobbyChoices.captainId,captain);assert.equal(initial.deadline,null);
      assert.throws(()=>f.store.chooseLobby(id,999,{turn:0,choice:first}),{status:403});
      f.store.chooseLobby(id,captain,{turn:0,choice:first});
      const next=f.store.game(id).lobbyChoices;
      assert.notEqual(next.captainId,captain);assert.equal(next.turn,1);
      assert.equal(next.kind,['radiant','dire'].includes(first)?'pick':'side');
      assert.throws(()=>f.store.chooseLobby(id,captain,{turn:0,choice:first}),{status:409});
      assert.throws(()=>f.store.chooseLobby(id,next.captainId,{turn:1,choice:first}),{status:400});
      const second=next.options[remaining];
      f.store.chooseLobby(id,next.captainId,{turn:1,choice:second});
      const done=f.store.game(id);
      const expectedRadiant=first==='radiant'?firstSide:first==='dire'?other:second==='radiant'?other:firstSide;
      const expectedPick=first==='first_pick'?firstSide:first==='second_pick'?other:second==='first_pick'?other:firstSide;
      assert.equal(done.lobbyChoices.radiantSide,expectedRadiant);assert.equal(done.lobbyChoices.firstPickSide,expectedPick);
      assert.equal(done.lobbyChoices.pending,false);assert.equal(done.deadline,null);
      assert.equal(done.lobbyJoinStartedAt,null);
      assert.throws(()=>f.store.chooseLobby(id,next.captainId,{turn:1,choice:second}),{status:409});
      assert.equal(f.store.auditLog().filter(a=>a.action==='lobby-choice').length,2);
    }finally{f.close();}
  });
}

test('captain choice deadlines auto-select only the remaining category, and All Pick has only a side choice',()=>{
  for(const mode of [1,2]){
    const f=inhouseFixture({gameMode:mode,manualLobbyChoices:true,random:n=>n-1});
    try {
      const id=f.ten(),game=f.ready(id);
      assert.equal(game.lobbyChoices.firstCaptainId,game.captainB);
      if(mode===1)assert.deepEqual(game.lobbyChoices.options,['radiant','dire']);
      f.advance(60001);f.store.tick();
      const next=f.store.game(id);
      if(mode===2){
        assert.equal(next.lobbyChoices.turn,1);assert.equal(next.lobbyChoices.kind,'side');
        assert.equal(next.lobbyChoices.firstPickSide,'A');
        assert.throws(()=>f.store.chooseLobby(id,game.captainA,{turn:1,choice:'first_pick'}),{status:400});
        f.advance(60001);f.store.tick();
      }
      const done=f.store.game(id);
      assert.equal(done.lobbyChoices.pending,false);
      assert.equal(done.deadline,null,'The bot starts the join timer when its lobby is ready');
      assert.equal(done.lobbyChoices.firstPickSide,mode===2?'A':null);
      assert.ok(f.store.auditLog().filter(a=>a.action==='lobby-choice').every(a=>a.details.automatic));
    }finally{f.close();}
  }
});

for(const pick of ['first_pick','second_pick'])test(`bot applies captain choices (${pick}), respects team B on Radiant and publishes rating changes on completion`,()=>{
  const f=inhouseBotFixture({gameMode:2,manualLobbyChoices:true,random:()=>1});
  try {
    const id=f.ten(),game=f.ready(id);
    f.step();assert.equal(f.commands.some(c=>c.name==='create'),false);
    f.store.chooseLobby(id,game.captainB,{turn:0,choice:'radiant'});
    f.step();assert.equal(f.commands.some(c=>c.name==='create'),false);
    f.store.chooseLobby(id,game.captainA,{turn:1,choice:pick});
    f.step();
    const session=f.sessions.get(1),expected=pick==='first_pick'?2:1;
    assert.equal(session.lobby.cmPick,expected);assert.equal(session.lobby.selectionPriorityRules,0);
    f.fill(1);session.lobby.cmPick=expected===1?2:1;
    f.step();assert.equal(f.commands.at(-1).name,'details','Bot corrects the pick order before launch');
    f.step();assert.equal(f.commands.at(-1).name,'launch');f.step();
    assert.equal(f.store.game(id).radiantSide,'B');assert.equal(f.store.game(id).status,'playing');
    const mismatched=f.match(id,{matchId:90001,winner:null});
    assert.throws(()=>f.store.validateMatch(f.store.rawGame(id),mismatched),/captain choices/);
    let published=null;
    const stop=f.store.subscribe(()=>{if(f.store.game(id).status==='completed')published=f.store.snapshot();});
    Object.assign(session.lobby,{state:3,matchOutcome:2,matchDuration:600});f.advance(600000);f.step();stop();
    const completed=published.games.find(g=>g.id===id);
    assert.equal(completed.winner,'B');assert.equal(published.queue.length,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue WHERE InhouseId=?').get(id).n,0);
    for(const player of completed.players){
      assert.equal(player.ratingBefore,1000);
      assert.equal(player.ratingAfter,player.side==='B'?1024:976);
      assert.equal(player.ratingDelta,player.side==='B'?24:-24);
    }
    f.step();f.step();assert.equal(f.store.botStatus()[0].gameId,null);
  }finally{f.cleanup();}
});
