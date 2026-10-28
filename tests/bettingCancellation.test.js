import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {engineFixture} from './helpers/bettingFixture.js';
import {cancellationGuard} from '../betting/engine.js';
import {marketBettors} from '../betting/fixtureMarketView.js';
import {createBettingRoutes} from '../routes/bettingRoutes.js';

const now=new Date('2026-10-13T12:00:00.000Z');
function fixture(){
  const f=engineFixture();
  f.book.registerSeason({SeasonId:1,LeagueName:'Test league',Status:'active'});
  f.betting.prepare(`INSERT INTO BettingInputSnapshots(SeasonId,AnalyticsRunId,AsOfUtc,Digest,InputJson,CreatedAtUtc)
    VALUES(1,1,?,'cancel-fixture','{}',?)`).run(now.toISOString(),now.toISOString());
  f.betting.prepare(`INSERT INTO BettingForecasts(SnapshotId,ModelVersion,Seed,ValidationJson,ForecastJson,CreatedAtUtc)
    VALUES(1,'cancel-fixture',1,'{}','{}',?)`).run(now.toISOString());
  const events=[17,18].map(day=>f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,
    scheduledStartUtc:`2026-10-${day}T01:00:00.000Z`},null,now));
  const markets=events.map(event=>f.book.publish({seasonId:1,eventId:event.EventId,eventRevision:event.Revision,
    stage:'regular',bestOf:2,type:'series_winner',title:`Series ${event.EventId}`},
  [{key:'team1',label:'A',probability:.5},{key:'team2',label:'B',probability:.5}],1,event.ScheduledStartUtc));
  const leg=(marketId,index=0)=>{
    const rows=f.betting.prepare(`SELECT s.SelectionId selectionId,m.QuoteVersion quoteVersion FROM BettingSelections s
      JOIN BettingMarkets m USING(MarketId) WHERE m.MarketId=? ORDER BY s.SelectionId`).all(marketId);
    return rows[index];
  };
  let sequence=0;
  return {...f,events,markets,leg,
    place:({user='99',stake=123.45,ids=markets}={})=>f.book.accept(user,{seasonId:1,stake,requestKey:`cancel_test_${++sequence}`,legs:ids.map(id=>leg(id))}),
    guard:(market,at)=>cancellationGuard(f.league,market,at,f.book.env)};
}

test('cancelling an owned parlay returns its exact stake once and removes its price exposure and bettors',()=>{
  const f=fixture();try{
    const prices=()=>f.betting.prepare('SELECT SelectionId,OfferedMicros FROM BettingSelections ORDER BY SelectionId').all();
    const original=prices(),ticket=f.place();
    const accepted=f.betting.prepare('SELECT SelectionId,AcceptedMicros,DefinitionJson FROM BettingTicketLegs ORDER BY MarketId').all();
    assert.equal(f.book.wallet(1,'99').balance,9876.55);assert.notDeepEqual(prices(),original);
    assert.equal(marketBettors(f.betting,f.markets[0]).total,1);
    const result=f.book.cancel('99',ticket.ticketId,f.guard);
    assert.equal(result.refunded,123.45);assert.equal(result.status,'cancelled');assert.equal(result.reused,false);
    assert.equal(f.book.wallet(1,'99').balance,10000);assert.deepEqual(prices(),original);
    assert.equal(marketBettors(f.betting,f.markets[0]).total,0);
    assert.deepEqual(f.betting.prepare('SELECT Status,PayoutCents FROM BettingTickets').get(),{Status:'cancelled',PayoutCents:12345});
    assert.ok(f.betting.prepare('SELECT Result,Divisor FROM BettingTicketLegs').all().every(l=>l.Result==='void'&&l.Divisor===1));
    assert.deepEqual(f.betting.prepare('SELECT SelectionId,AcceptedMicros,DefinitionJson FROM BettingTicketLegs ORDER BY MarketId').all(),accepted);
    f.book.now=()=>new Date('2026-10-20T00:00:00Z');
    assert.equal(f.book.cancel('99',ticket.ticketId,f.guard).reused,true);
    assert.equal(f.book.wallet(1,'99').balance,10000);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingLedger WHERE Kind='cancellation_refund'").get().n,1);
  }finally{f.close();}
});

test('settlement and result corrections never revive cancelled tickets or touch their refunds',()=>{
  const f=fixture();try{
    const cancelled=f.place(),live=f.place({user:'100'});
    f.book.cancel('99',cancelled.ticketId,f.guard);
    const saved=f.betting.prepare('SELECT * FROM BettingTicketLegs WHERE TicketId=? ORDER BY MarketId').all(cancelled.ticketId);
    for(const market of f.markets){
      f.book.settle(market,{team1:{result:'won'},team2:{result:'lost'}},{revision:1});
      f.book.settle(market,{team1:{result:'pending'},team2:{result:'pending'}},{revision:2});
      f.book.settle(market,{team1:{result:'lost'},team2:{result:'won'}},{revision:3});
    }
    assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(live.ticketId).Status,'lost');
    assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(cancelled.ticketId).Status,'cancelled');
    assert.deepEqual(f.betting.prepare('SELECT * FROM BettingTicketLegs WHERE TicketId=? ORDER BY MarketId').all(cancelled.ticketId),saved);
    assert.equal(f.book.wallet(1,'99').balance,10000);
    assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingLedger WHERE TicketId=? AND Kind!=\'stake\'').get(cancelled.ticketId).n,1);
  }finally{f.close();}
});

test('cancellation validates ownership, ticket state, every leg and the exact close time',()=>{
  const f=fixture();try{
    const ticket=f.place();
    assert.throws(()=>f.book.cancel('100',ticket.ticketId,f.guard),{status:404});
    assert.throws(()=>f.book.cancel('99',999,f.guard),{status:404});
    assert.throws(()=>f.book.cancel('99',NaN,f.guard),{status:400});
    const reject=()=>assert.throws(()=>f.book.cancel('99',ticket.ticketId,f.guard),{code:'TICKET_NOT_CANCELLABLE'});
    for(const status of ['locked','settled','void']){
      f.betting.prepare('UPDATE BettingMarkets SET Status=? WHERE MarketId=?').run(status,f.markets[1]);reject();
    }
    f.betting.prepare("UPDATE BettingMarkets SET Status='open' WHERE MarketId=?").run(f.markets[1]);
    f.betting.prepare("UPDATE BettingTicketLegs SET Result='won' WHERE TicketId=? AND MarketId=?").run(ticket.ticketId,f.markets[1]);reject();
    f.betting.prepare("UPDATE BettingTicketLegs SET Result='pending' WHERE TicketId=?").run(ticket.ticketId);
    f.book.now=()=>new Date(f.events[0].ScheduledStartUtc);reject();
    assert.equal(f.book.wallet(1,'99').balance,9876.55);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingLedger WHERE Kind='cancellation_refund'").get().n,0);
  }finally{f.close();}
});

test('a settled leg corrected back to pending still prevents cancelling the remaining ticket',()=>{
  const f=fixture();try{
    const ticket=f.place();
    f.book.settle(f.markets[1],{team1:{result:'won'},team2:{result:'lost'}});
    f.book.settle(f.markets[1],{team1:{result:'pending'},team2:{result:'pending'}},{correction:true});
    assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets').get().Status,'pending');
    assert.throws(()=>f.book.cancel('99',ticket.ticketId,f.guard),{code:'TICKET_NOT_CANCELLABLE'});
  }finally{f.close();}
});

test('authoritative starts block cancellation but analytical holds and newer schedule revisions do not',()=>{
  const f=fixture();try{
    const ticket=f.place();
    f.betting.prepare("UPDATE BettingMarkets SET Status='held',HoldReason='analytics_not_available'").run();
    f.league.prepare('UPDATE ScheduledEvents SET Revision=Revision+1 WHERE EventId=?').run(f.events[0].EventId);
    const saved=f.betting.prepare('SELECT * FROM BettingTickets').get();
    assert.equal(f.book.cancellationIssue(saved,f.guard),null);
    f.league.prepare("UPDATE ScheduledEvents SET StartedAtUtc=? WHERE EventId=?").run(now.toISOString(),f.events[1].EventId);
    assert.throws(()=>f.book.cancel('99',ticket.ticketId,f.guard),{code:'TICKET_NOT_CANCELLABLE'});
    f.league.prepare('UPDATE ScheduledEvents SET StartedAtUtc=NULL WHERE EventId=?').run(f.events[1].EventId);
    f.league.exec(`CREATE TABLE LiveMatchCurrentState(LeagueId INTEGER,RadiantTeamId INTEGER,DireTeamId INTEGER);
      INSERT INTO LiveMatchCurrentState VALUES(100,1011111,1022222)`);
    assert.throws(()=>f.book.cancel('99',ticket.ticketId,f.guard),{code:'TICKET_NOT_CANCELLABLE'});
    f.league.exec('DELETE FROM LiveMatchCurrentState');
    f.book.cancel('99',ticket.ticketId,f.guard);assert.equal(f.book.wallet(1,'99').balance,10000);
  }finally{f.close();}
});

test('preseason refunds require an unstarted season even when the market has no close time',()=>{
  const f=fixture();try{
    const market=f.book.publish({seasonId:1,type:'champion',stage:'regular',title:'Champion'},
      [{key:'team1',label:'A',probability:.5},{key:'team2',label:'B',probability:.5}],1);
    const first=f.place({ids:[market]});f.book.cancel('99',first.ticketId,f.guard);
    const ticket=f.place({ids:[market]});
    f.league.exec('CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER);INSERT INTO MatchLeague VALUES(123,100)');
    assert.throws(()=>f.book.cancel('99',ticket.ticketId,f.guard),{code:'TICKET_NOT_CANCELLABLE'});
    f.league.exec('DELETE FROM MatchLeague');
    f.league.exec("UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=1");
    assert.throws(()=>f.book.cancel('99',ticket.ticketId,f.guard),{code:'TICKET_NOT_CANCELLABLE'});
  }finally{f.close();}
});

test('a failed refund rolls back ticket state, legs, wallet, ledger and quotes together',()=>{
  const f=fixture();try{
    const ticket=f.place();
    const snapshot=()=>['BettingTickets','BettingTicketLegs','BettingWallets','BettingLedger','BettingSelections','BettingQuoteHistory']
      .map(table=>f.betting.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before=snapshot();
    f.betting.exec("CREATE TRIGGER fail_refund BEFORE INSERT ON BettingLedger WHEN NEW.Kind='cancellation_refund' BEGIN SELECT RAISE(ABORT,'refund failure');END");
    assert.throws(()=>f.book.cancel('99',ticket.ticketId,f.guard),/refund failure/);
    assert.deepEqual(snapshot(),before);
  }finally{f.close();}
});

test('the API exposes eligibility, protects ownership and refunds concurrent duplicate requests once into the original wallet',async()=>{
  const f=fixture();let server;
  try{
    const ticket=f.place();
    f.book.registerSeason({SeasonId:2,LeagueName:'Other season',Status:'active'});f.book.wallet(2,'99');
    const app=express();app.use(express.json());app.use((req,res,next)=>{
      const user=req.headers['x-test-user'];req.isAuthenticated=()=>!!user;
      if(user)req.user={id:String(76561197960265728n+BigInt(user))};next();
    });
    const routes=createBettingRoutes({...f,analyticsPath:'missing.db'});
    app.use('/betting',routes.publicRoutes);app.use('/review',routes.adminRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const cancel=(user,id=ticket.ticketId)=>fetch(`${base}/betting/tickets/${id}/cancel`,{method:'POST',
      headers:{'Content-Type':'application/json',...(user?{'x-test-user':user}:{})},body:JSON.stringify({userId:'99',seasonId:2,refund:999999})});
    const list=async()=>{const response=await fetch(`${base}/betting/tickets?seasonId=1`,{headers:{'x-test-user':'99'}});return response.json();};
    assert.equal((await list()).tickets[0].canCancel,true);
    assert.equal((await cancel()).status,401);assert.equal((await cancel('100')).status,404);
    assert.equal((await cancel('99','invalid')).status,400);
    const responses=await Promise.all([cancel('99'),cancel('99')]);
    assert.ok(responses.every(response=>response.status===200));
    const values=await Promise.all(responses.map(response=>response.json()));assert.equal(values.filter(value=>!value.reused).length,1);
    assert.equal(f.book.wallet(1,'99').balance,10000);assert.equal(f.book.wallet(2,'99').balance,10000);
    const saved=(await list()).tickets[0];assert.equal(saved.canCancel,false);assert.equal(saved.status,'cancelled');assert.equal(saved.payout,123.45);
    const leaders=await(await fetch(`${base}/betting/leaderboard?seasonId=1`)).json();assert.equal(leaders.players.find(p=>p.userId==='99').net,0);
    const review=await fetch(`${base}/review/tickets?status=cancelled`);assert.equal(review.status,200);
    const reviewed=await review.json();assert.equal(reviewed.counts.cancelled,1);assert.equal(reviewed.tickets[0].status,'cancelled');
    const fresh=f.place({ids:[f.markets[0]]});
    f.book.now=()=>new Date(f.events[0].ScheduledStartUtc);
    assert.equal((await list()).tickets.find(t=>t.ticketId===fresh.ticketId).canCancel,false);
    assert.equal((await cancel('99',fresh.ticketId)).status,409);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});

test('leaderboard separates pending stakes from settled profit across parlays, refunds, cancellations, corrections and seasons',async()=>{
  const f=fixture();let server;
  try{
    f.place(); // Two legs, but only one 123.45-point stake.
    const single=f.place({stake:200,ids:[f.markets[0]]});
    f.place({user:'100',stake:12.34,ids:[f.markets[0]]});
    f.book.accept('101',{seasonId:1,stake:25.67,requestKey:'leaderboard_losing_single',legs:[f.leg(f.markets[0],1)]});
    const cancelled=f.place({user:'102',stake:7.89,ids:[f.markets[0]]});f.book.cancel('102',cancelled.ticketId,f.guard);
    f.book.wallet(1,'103'); // No activity still appears with zero exposure and net.
    f.book.registerSeason({SeasonId:2,LeagueName:'Other season',Status:'active'});
    const other=f.book.publish({seasonId:2,eventId:99,stage:'regular',type:'series_winner',title:'Other season'},
      [{key:'team1',label:'A',probability:.5},{key:'team2',label:'B',probability:.5}],1,'2026-10-18T01:00:00Z');
    f.book.accept('99',{seasonId:2,stake:44.44,requestKey:'leaderboard_other_season',legs:[f.leg(other)]});
    const app=express();app.use('/betting',createBettingRoutes({...f,analyticsPath:'missing.db'}).publicRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}/betting/leaderboard`;
    const read=async(season=1)=>{const response=await fetch(`${url}?seasonId=${season}`);assert.equal(response.status,200);return (await response.json()).players;};
    const amounts=player=>({wagered:player.wagered,net:player.net,balance:player.balance});
    let players=await read();
    assert.deepEqual(amounts(players.find(p=>p.userId==='99')),{wagered:323.45,net:0,balance:9676.55});
    assert.deepEqual(amounts(players.find(p=>p.userId==='100')),{wagered:12.34,net:0,balance:9987.66});
    for(const id of ['102','103'])assert.deepEqual(amounts(players.find(p=>p.userId===id)),{wagered:0,net:0,balance:10000});
    assert.deepEqual(amounts((await read(2))[0]),{wagered:44.44,net:0,balance:9955.56});
    f.betting.prepare("UPDATE BettingMarkets SET Status='locked' WHERE SeasonId=1").run();
    assert.deepEqual(amounts((await read()).find(p=>p.userId==='99')),{wagered:323.45,net:0,balance:9676.55});
    f.book.settle(f.markets[0],{team1:{result:'won'},team2:{result:'lost'}});
    const won=f.betting.prepare('SELECT PayoutCents-StakeCents NetCents FROM BettingTickets WHERE TicketId=?').get(single.ticketId).NetCents;
    players=await read();
    assert.equal(players[0].userId,'99','Ranking uses settled performance, not how many points are currently committed');
    assert.deepEqual(amounts(players.find(p=>p.userId==='99')),{wagered:123.45,net:won/100,balance:(1000000-12345+won)/100});
    assert.deepEqual(amounts(players.find(p=>p.userId==='101')),{wagered:0,net:-25.67,balance:9974.33});
    f.book.settle(f.markets[1],{team1:{result:'lost'},team2:{result:'won'}});
    assert.deepEqual(amounts((await read()).find(p=>p.userId==='99')),{wagered:0,net:(won-12345)/100,balance:(1000000+won-12345)/100});
    f.book.settle(f.markets[0],{team1:{result:'pending'},team2:{result:'pending'}},{correction:true});
    assert.deepEqual(amounts((await read()).find(p=>p.userId==='99')),{wagered:323.45,net:0,balance:9676.55});
    for(const market of f.markets)f.book.settle(market,{team1:{result:'void'},team2:{result:'void'}},{refund:true});
    for(const player of await read())assert.deepEqual(amounts(player),{wagered:0,net:0,balance:10000});
  }finally{if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});
