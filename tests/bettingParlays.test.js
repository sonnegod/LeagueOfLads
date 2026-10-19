import test from 'node:test';
import assert from 'node:assert/strict';
import {parlayConflict} from '../client/src/utils/bettingParlays.js';
import {engineFixture} from './helpers/bettingFixture.js';
import {runBetting} from '../betting/engine.js';

const now=new Date('2026-10-13T12:00:00.000Z');
const prop={marketId:1,selectionId:1,eventId:1,type:'player_prop',playerId:1,stat:'kills',scope:'total',gameNumber:null};

test('parlays allow distinct scheduled props while rejecting duplicate, overlapping and preseason combinations in either order',()=>{
  const check=(a,b,allowed)=>{
    assert.equal(parlayConflict([a,b])===null,allowed);
    assert.equal(parlayConflict([b,a])===null,allowed);
  };
  const other={...prop,marketId:2,selectionId:2};
  assert.equal(parlayConflict([prop]),null);
  check(prop,{...prop,selectionId:2},false); // Over plus Under of one market.
  check(prop,other,false); // Same proposition in a separately published market/line.
  check(prop,{...other,scope:'average'},false);
  check(prop,{...other,scope:'game',gameNumber:1},false);
  check({...prop,scope:'game',gameNumber:1},{...other,scope:'game',gameNumber:1},false);
  check({...prop,scope:'game',gameNumber:1},{...other,scope:'game',gameNumber:2},true);
  check(prop,{...other,playerId:2},true);
  check(prop,{...other,stat:'assists'},true);
  check(prop,{...other,eventId:2},true);
  const result={marketId:3,selectionId:3,eventId:1,type:'exact_score'};
  check(prop,result,true);
  check(result,{marketId:4,selectionId:4,eventId:1,type:'series_winner'},false);
  check(result,{marketId:4,selectionId:4,eventId:2,type:'series_winner'},true);
  const preseason={...other,eventId:null,type:'season_player'};
  assert.equal(parlayConflict([preseason]),null);
  check(preseason,prop,false);
  check(preseason,{marketId:4,selectionId:4,eventId:null,type:'champion'},false);
});

test('ticket acceptance allows same-fixture parlays, checks stored market identities, and keeps rejected tickets atomic',()=>{
  const f=engineFixture();
  try {
    const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-17T01:00:00Z'},null,now);
    runBetting({...f,now,simulations:50});
    const market=(player,stat,scope,game=null)=>f.betting.prepare(`SELECT MarketId FROM BettingMarkets WHERE EventId=? AND PlayerId=? AND StatKey=? AND Scope=? AND GameNumber IS ?`).get(event.EventId,player,stat,scope,game).MarketId;
    const total=market(1,'kills','total'),average=market(1,'kills','average'),game1=market(1,'kills','game',1),game2=market(1,'kills','game',2),assist=market(2,'assists','total');
    const result=f.betting.prepare("SELECT MarketId FROM BettingMarkets WHERE EventId=? AND MarketType='exact_score'").get(event.EventId).MarketId;
    const winner=f.betting.prepare("SELECT MarketId FROM BettingMarkets WHERE EventId=? AND MarketType='series_winner'").get(event.EventId).MarketId;
    const leg=(id,index=0)=>{
      const rows=f.betting.prepare('SELECT s.SelectionId,m.QuoteVersion FROM BettingSelections s JOIN BettingMarkets m ON m.MarketId=s.MarketId WHERE m.MarketId=? ORDER BY s.SelectionId').all(id);
      return {selectionId:rows[index].SelectionId,quoteVersion:rows[index].QuoteVersion,type:'untrusted',playerId:999,eventId:999};
    };
    let sequence=0;
    const accept=legs=>f.book.accept('99',{seasonId:1,stake:100,requestKey:`parlay_policy_${++sequence}`,legs});
    const ticket=accept([leg(game1),leg(game2),leg(assist),leg(result)]);
    assert.equal(f.book.wallet(1,'99').balance,9900);
    assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingTicketLegs WHERE TicketId=?').get(ticket.ticketId).n,4);
    const reject=(ids,code='PARLAY_CONFLICT')=>{
      const balance=f.book.wallet(1,'99').balance,count=f.betting.prepare('SELECT COUNT(*) n FROM BettingTickets').get().n;
      assert.throws(()=>accept(ids),{code});
      assert.equal(f.book.wallet(1,'99').balance,balance);assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingTickets').get().n,count);
    };
    reject([leg(total),leg(total,1)]);
    reject([leg(total),leg(total)]);
    reject([leg(total),leg(average)]);
    reject([leg(total),leg(game1)]);
    reject([leg(result),leg(winner)]);
    const forecast=f.betting.prepare('SELECT ForecastId FROM BettingForecasts LIMIT 1').get().ForecastId;
    const preseason=f.book.publish({seasonId:1,stage:'regular',type:'season_player',playerId:1,stat:'kills',scope:'total',line:100,title:'Season kills'},
      [{key:'over',label:'Over',probability:.5},{key:'under',label:'Under',probability:.5}],forecast,'2026-10-17T01:00:00Z');
    accept([leg(preseason)]);assert.equal(f.book.wallet(1,'99').balance,9800);
    reject([leg(preseason),leg(game1)],'PRESEASON_SINGLE');
    reject([leg(assist),leg(preseason)],'PRESEASON_SINGLE');
  }finally{f.close();}
});
