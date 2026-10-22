import test from 'node:test';
import assert from 'node:assert/strict';
import {engineFixture} from './helpers/bettingFixture.js';
import {runBetting} from '../betting/engine.js';

const openedAt=new Date('2026-10-13T12:00:00Z');
const playedAt=new Date('2026-10-17T04:00:00Z');
function fixture() {
  const f=engineFixture();
  f.league.exec('ALTER TABLE SeriesInfo ADD COLUMN DateCreated TEXT');
  return f;
}
function schedule(f,start='2026-10-17T01:00:00Z',extra={}) {
  return f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:start,...extra},'admin',openedAt);
}
function series(f,{id=900,day='2026-10-16',stage='g',leagueId=100,teams=[1022222,1011111],matches=[1,2],start='2026-10-17T01:00:00Z'}={}) {
  f.league.prepare('INSERT INTO SeriesInfo(SeriesId,Team1,Team2,LeagueId,Stage,DateCreated) VALUES(?,?,?,?,?,?)')
    .run(id,...teams,leagueId,stage,day);
  for(const [index,match] of matches.entries()) {
    f.league.prepare('INSERT INTO SeriesMatch VALUES(?,?)').run(id,match);
    f.analytics.prepare('UPDATE MatchFacts SET SeriesId=?,StartedAtUtc=? WHERE MatchId=?')
      .run(id,new Date(Date.parse(start)+index*3600000).toISOString(),match);
  }
}
const refresh=(f,now=playedAt)=>runBetting({...f,now,seasonId:1,simulations:50});

test('played fixtures link and settle automatically by New York date, preserving accepted odds across repeat nights',()=>{
  const f=fixture();try {
    const first=schedule(f),second=schedule(f,'2026-10-18T01:00:00Z');
    refresh(f,openedAt);
    const tickets=[first,second].map((event,index)=>{
      const quote=f.betting.prepare(`SELECT s.SelectionId,s.OfferedMicros,m.QuoteVersion FROM BettingSelections s
        JOIN BettingMarkets m USING(MarketId) WHERE m.EventId=? AND m.MarketType='series_winner' AND s.OutcomeKey='draw'`).get(event.EventId);
      const ticket=f.book.accept('99',{seasonId:1,stake:100,requestKey:`automatic_series_${index}`,
        legs:[{selectionId:quote.SelectionId,quoteVersion:quote.QuoteVersion}]});
      return {...ticket,accepted:quote.OfferedMicros};
    });
    series(f);
    assert.ok(refresh(f).marketsSettled>0);
    assert.equal(f.schedules.get(first.EventId).SeriesId,900);
    assert.equal(f.schedules.get(first.EventId).Status,'completed');
    assert.equal(f.schedules.get(second.EventId).SeriesId,null);
    assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(tickets[0].ticketId).Status,'won');
    assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(tickets[1].ticketId).Status,'pending');
    series(f,{id:901,day:'2026-10-17',matches:[3,4],start:'2026-10-18T01:00:00Z'});
    const later=new Date('2026-10-18T04:00:00Z');refresh(f,later);
    assert.equal(f.schedules.get(second.EventId).SeriesId,901);
    assert.equal(f.schedules.get(second.EventId).Status,'completed');
    for(const ticket of tickets) {
      assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status,'won');
      assert.equal(f.betting.prepare('SELECT AcceptedMicros FROM BettingTicketLegs WHERE TicketId=?').get(ticket.ticketId).AcceptedMicros,ticket.accepted);
    }
    const ledger=f.betting.prepare('SELECT COUNT(*) n FROM BettingLedger').get().n;
    const revisions=f.league.prepare('SELECT COUNT(*) n FROM ScheduleEventRevisions').get().n;
    refresh(f,later);
    assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingLedger').get().n,ledger);
    assert.equal(f.league.prepare('SELECT COUNT(*) n FROM ScheduleEventRevisions').get().n,revisions);
    assert.match(f.league.prepare('SELECT Reason FROM ScheduleEventRevisions WHERE EventId=? ORDER BY Revision LIMIT 1 OFFSET 1').get(first.EventId).Reason,/automatically/i);
  }finally{f.close();}
});

test('automatic links wait for a complete verified BO2 before settling or marking the fixture complete',()=>{
  const f=fixture();try {
    const event=schedule(f);refresh(f,openedAt);series(f,{matches:[1]});
    refresh(f);
    assert.equal(f.schedules.get(event.EventId).SeriesId,900);
    assert.notEqual(f.schedules.get(event.EventId).Status,'completed');
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE EventId=? AND Status='settled'").get(event.EventId).n,0);
    f.league.exec('INSERT INTO SeriesMatch VALUES(900,2)');
    f.analytics.exec("UPDATE MatchFacts SET SeriesId=900,StartedAtUtc='2026-10-17T02:00:00Z' WHERE MatchId=2");
    refresh(f);
    assert.equal(f.schedules.get(event.EventId).Status,'completed');
    assert.ok(f.betting.prepare("SELECT 1 FROM BettingMarkets WHERE EventId=? AND Status='settled'").get(event.EventId));
  }finally{f.close();}
});

test('multiple played series or multiple scheduled fixtures on the same night require review instead of a guessed link',()=>{
  for(const duplicate of ['series','fixtures']) {
    const f=fixture();try {
      const event=schedule(f);series(f);
      if(duplicate==='series')series(f,{id:901,matches:[3,4]});
      else schedule(f,'2026-10-17T02:00:00Z',{team1Key:12,team2Key:11});
      const result=refresh(f);
      assert.equal(f.schedules.get(event.EventId).SeriesId,null);
      assert.equal(f.schedules.get(event.EventId).Status,'needs_review');
      assert.ok(result.issues.includes('fixture_series_link_needs_review'));
      assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE Status='settled'").get().n,0);
    }finally{f.close();}
  }
});

test('automatic linking excludes other dates, stages, leagues, teams, empty series and future fixtures',()=>{
  for(const change of [{day:'2026-10-17'},{stage:'p'},{leagueId:999},{teams:[1011111,9999999]},{matches:[]}]) {
    const f=fixture();try {
      const event=schedule(f);series(f,change);refresh(f);
      assert.equal(f.schedules.get(event.EventId).SeriesId,null,JSON.stringify(change));
    }finally{f.close();}
  }
  const f=fixture();try {
    const event=schedule(f);series(f);refresh(f,openedAt);
    assert.equal(f.schedules.get(event.EventId).SeriesId,null);
  }finally{f.close();}
});

test('playoff fixtures automatically link and settle after the BO3 or BO5 clincher',()=>{
  for(const bestOf of [3,5]) {
    const f=fixture();try {
      const event=schedule(f,undefined,{stage:'playoff',bestOf});refresh(f,openedAt);
      const matches=Array.from({length:(bestOf+1)/2},(_,index)=>index+1);
      series(f,{stage:'p',matches});
      for(const match of matches)f.analytics.prepare("UPDATE MatchFacts SET Stage='playoff',WinnerTeamId=1011111 WHERE MatchId=?").run(match);
      refresh(f,new Date('2026-10-17T06:00:00Z'));
      assert.equal(f.schedules.get(event.EventId).SeriesId,900);
      assert.equal(f.schedules.get(event.EventId).Status,'completed');
      assert.equal(f.betting.prepare("SELECT Status FROM BettingMarkets WHERE EventId=? AND MarketType='series_winner'").get(event.EventId).Status,'settled');
    }finally{f.close();}
  }
});

test('automatic links use the New York calendar date on both sides of the DST change',()=>{
  for(const [start,day,at] of [['2026-10-31T01:00:00Z','2026-10-30','2026-10-31T12:00:00Z'],
    ['2026-11-02T02:00:00Z','2026-11-01','2026-11-02T12:00:00Z']]) {
    const f=fixture();try {
      const event=schedule(f,start);series(f,{day,start});
      f.schedules.linkPlayedSeries(1,new Date(at));
      assert.equal(f.schedules.get(event.EventId).SeriesId,900);
    }finally{f.close();}
  }
});

test('manual links, review/cancelled fixtures and claimed series are preserved, and local test fixtures remain isolated',()=>{
  for(const status of ['needs_review','cancelled','forfeit']) {
    const f=fixture();try {
      const event=schedule(f,undefined,{status});series(f);refresh(f);
      assert.equal(f.schedules.get(event.EventId).SeriesId,null,status);
      assert.equal(f.schedules.get(event.EventId).Status,status);
    }finally{f.close();}
  }
  const f=fixture();try {
    const manual=schedule(f,'2026-10-18T01:00:00Z'),automatic=schedule(f);
    series(f);series(f,{id:901,matches:[3,4]});
    f.schedules.save(1,{eventId:manual.EventId,revision:manual.Revision,team1Key:11,team2Key:12,stage:'regular',bestOf:2,
      scheduledStartUtc:manual.ScheduledStartUtc,seriesId:900},'admin',openedAt);
    refresh(f);
    assert.equal(f.schedules.get(manual.EventId).SeriesId,900);
    assert.equal(f.schedules.get(automatic.EventId).SeriesId,null);
  }finally{f.close();}
  const local=fixture();try {
    const event=schedule(local,undefined,{sourceMessageId:'local-test:fixture'});series(local);refresh(local);
    assert.equal(local.schedules.get(event.EventId).SeriesId,null);
  }finally{local.close();}
  const claimed=fixture();try {
    const manual=schedule(claimed,'2026-10-18T01:00:00Z'),automatic=schedule(claimed);series(claimed);
    claimed.league.prepare('UPDATE ScheduledEvents SET SeriesId=900 WHERE EventId=?').run(manual.EventId);
    refresh(claimed);
    assert.equal(claimed.schedules.get(automatic.EventId).SeriesId,null);
    assert.equal(claimed.schedules.get(manual.EventId).SeriesId,900);
  }finally{claimed.close();}
});
