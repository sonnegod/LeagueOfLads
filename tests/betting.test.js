import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { BettingStore } from '../betting/store.js';
import { ScheduleStore } from '../betting/scheduleStore.js';
import { parseScheduleTime,parseScheduleMessage,localToUtc } from '../betting/scheduleParser.js';
import { seriesDistribution,anchorPrice,movedPrices } from '../betting/pricing.js';
import { engineFixture } from './helpers/bettingFixture.js';
import { runBetting,verifiedFixtureGames,settleSeason,settleOperationalChanges } from '../betting/engine.js';
import { validateBaseline,validateStatDistributions } from '../betting/models.js';
import { readSeasonBettingInputs } from '../analytics/bettingInputs.js';
import { settleLegacy } from '../betting/legacy.js';
import { exactPayoutCents,quotedReturn } from '../client/src/utils/bettingPoints.js';

const now=new Date('2026-10-13T12:00:00.000Z');
function bookFixture() {
  const db=new Database(':memory:');const book=new BettingStore(db,{now:()=>now});
  book.registerSeason({SeasonId:1,LeagueName:'Test',Status:'active'});
  db.prepare('INSERT INTO BettingInputSnapshots (SeasonId,AnalyticsRunId,AsOfUtc,Digest,InputJson,CreatedAtUtc) VALUES (1,1,?,?,?,?)').run(now.toISOString(),'one','{"secret":123}',now.toISOString());
  db.prepare('INSERT INTO BettingForecasts (SnapshotId,ModelVersion,Seed,ValidationJson,ForecastJson,CreatedAtUtc) VALUES (1,?,1,?,?,?)').run('test','{}','{}',now.toISOString());
  const market=book.publish({seasonId:1,eventId:1,eventRevision:1,stage:'regular',bestOf:2,type:'series_winner',title:'Test series'},
    [{key:'team1',label:'A',probability:.5},{key:'team2',label:'B',probability:.5}],1,'2026-10-17T01:00:00.000Z');
  const select=key=>db.prepare('SELECT s.SelectionId,m.QuoteVersion FROM BettingSelections s JOIN BettingMarkets m ON m.MarketId=s.MarketId WHERE s.MarketId=? AND OutcomeKey=?').get(market,key);
  const ticket=(key,stake=100,requestKey='request_0001')=>{const s=select(key);return book.accept('99',{seasonId:1,stake,requestKey,legs:[{selectionId:s.SelectionId,quoteVersion:s.QuoteVersion}]});};
  return {db,book,market,select,ticket};
}

test('Discord time formats use message time, New York DST, explicit AM and year rollover',()=>{
  for(const suffix of ['Saturday 9pm est','Saturday 9est','Saturday 9 pm','Saturday 9 est','10/17 9 pm','10/17 9:00'])
    assert.equal(parseScheduleTime(suffix,now.toISOString()).scheduledStartUtc,'2026-10-18T01:00:00.000Z');
  assert.equal(parseScheduleTime('2026-10-17 9 AM',now.toISOString()).scheduledStartUtc,'2026-10-17T13:00:00.000Z');
  assert.equal(parseScheduleTime('Saturday 9pst',now.toISOString()).scheduledStartUtc,'2026-10-18T04:00:00.000Z');
  assert.equal(parseScheduleTime('Saturday 00:30 UTC',now.toISOString()).scheduledStartUtc,'2026-10-17T00:30:00.000Z');
  assert.equal(parseScheduleTime('Saturday 09:30 UTC',now.toISOString()).scheduledStartUtc,'2026-10-17T09:30:00.000Z');
  assert.equal(parseScheduleTime('Saturday 21:30 UTC',now.toISOString()).scheduledStartUtc,'2026-10-17T21:30:00.000Z');
  assert.equal(parseScheduleTime('Saturday 9pm BST',now.toISOString()).error,'unknown_timezone');
  assert.equal(parseScheduleTime('played last Saturday 9pm',now.toISOString()).error,'retrospective_post');
  assert.equal(parseScheduleTime('1/2 9pm','2026-12-30T12:00:00Z').scheduledStartUtc,'2027-01-03T02:00:00.000Z');
  assert.equal(parseScheduleTime('2026-11-01 1 AM','2026-10-31T12:00:00Z').error,'ambiguous_dst_time');
  assert.equal(localToUtc({year:2026,month:3,day:8,hour:2,minute:30}).error,'invalid_local_time');
  assert.ok(parseScheduleTime('Saturday 9pm Sunday 8pm',now.toISOString()).error);
  assert.ok(parseScheduleTime('2/30 9pm',now.toISOString()).error);
  const parsed=parseScheduleMessage({content:'1011111 vs 1022222 Saturday 9est',authoredAt:now.toISOString()},
    [{TeamSubmissionId:11,ExternalTeamId:1011111},{TeamSubmissionId:12,ExternalTeamId:1022222}]);
  assert.equal(parsed.team1Key,11);assert.equal(parsed.bestOf,2);
});

test('BO1/BO2/BO3/BO5 score distributions are coherent and wager prices remain anchored',()=>{
  for(const bestOf of [1,2,3,5]) {
    const scores=seriesDistribution(.6,bestOf);assert.ok(Math.abs(scores.reduce((s,p)=>s+p.probability,0)-1)<1e-12);
    assert.equal(scores.length,bestOf===1?2:bestOf===2?3:bestOf===3?4:6);
  }
  assert.ok(Math.abs(seriesDistribution(.7,1).find(score=>score.a>score.b).probability-.7)<1e-12);
  assert.ok(seriesDistribution(.7,3).filter(score=>score.a>score.b).reduce((sum,score)=>sum+score.probability,0)>.7);
  const selections=[.3,.4,.3].map(Probability=>({Probability,AnchorMicros:anchorPrice(Probability)}));
  for(const stakes of [[1,0,0],[10000000,0,0],[0,10000,0]]) {
    const prices=movedPrices(selections,stakes);
    prices.forEach((p,i)=>assert.ok(p>=Math.ceil(selections[i].AnchorMicros*.9)&&p<=Math.floor(selections[i].AnchorMicros*1.1)));
  }
  assert.deepEqual(movedPrices(selections,[100,0,0]),movedPrices(selections,[100,0,0]));
});

test('season credits, quote checks, cumulative market caps and duplicate requests are atomic',()=>{
  const f=bookFixture();try {
    assert.equal(f.book.wallet(1,'99').balance,10000);assert.equal(f.book.wallet(1,'99').balance,10000);
    const quote=f.select('team1');const first=f.ticket('team1',600);
    assert.equal(f.book.wallet(1,'99').balance,9400);
    assert.deepEqual(f.book.accept('99',{seasonId:1,stake:600,requestKey:'request_0001',legs:[{selectionId:quote.SelectionId,quoteVersion:quote.QuoteVersion}]}),{ticketId:first.ticketId,reused:true});
    assert.throws(()=>f.book.accept('99',{seasonId:1,stake:100,requestKey:'request_0002',legs:[{selectionId:quote.SelectionId,quoteVersion:quote.QuoteVersion}]}),{code:'QUOTE_CHANGED'});
    assert.throws(()=>f.ticket('team2',401,'request_0003'),{code:'STAKE_CAP'});
    f.ticket('team2',400,'request_0004');assert.equal(f.book.wallet(1,'99').balance,9000);
    f.book.registerSeason({SeasonId:2,LeagueName:'Next',Status:'active'});assert.equal(f.book.wallet(2,'99').balance,10000);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM BettingLedger WHERE Kind='season_credit' AND SeasonId=1").get().n,1);
  }finally{f.db.close();}
});

test('settlement is idempotent, corrections can revert, and old-season payouts never credit a new season',()=>{
  const f=bookFixture();try {
    const placed=f.ticket('team1');f.book.registerSeason({SeasonId:2,LeagueName:'Next',Status:'active'});f.book.wallet(2,'99');
    const won={team1:{result:'won',divisor:2},team2:{result:'lost'}};
    assert.equal(f.book.settle(f.market,won,{matchIds:[1]}),true);
    assert.equal(f.book.wallet(1,'99').balance,9990); // 100 * 1.80 / 2 gross return.
    assert.equal(f.book.settle(f.market,won,{matchIds:[1]}),false);
    f.book.settle(f.market,{team1:{result:'lost'},team2:{result:'won'}},{matchIds:[1]});assert.equal(f.book.wallet(1,'99').balance,9900);
    f.book.settle(f.market,won,{matchIds:[1]});assert.equal(f.book.wallet(1,'99').balance,9990);
    assert.equal(f.book.wallet(2,'99').balance,10000);
    assert.equal(f.db.prepare('SELECT PayoutCents FROM BettingTickets WHERE TicketId=?').get(placed.ticketId).PayoutCents,9000);
  }finally{f.db.close();}
});

test('a cancelled parlay leg refunds its stake factor, same-event combinations are rejected, and guards lock acceptance',()=>{
  const f=bookFixture();try {
    const second=f.book.publish({seasonId:1,eventId:2,eventRevision:1,stage:'playoff',bestOf:3,type:'series_winner',title:'Other series'},
      [{key:'team1',label:'C',probability:.5},{key:'team2',label:'D',probability:.5}],1,'2026-10-17T01:00:00.000Z');
    const a=f.select('team1');const b=f.db.prepare('SELECT SelectionId FROM BettingSelections WHERE MarketId=? AND OutcomeKey=?').get(second,'team1');
    const related=f.book.publish({seasonId:1,eventId:1,eventRevision:1,stage:'regular',type:'exact_score',title:'Related'},[{key:'a',label:'A',probability:.5},{key:'b',label:'B',probability:.5}],1,'2026-10-17T01:00:00.000Z');
    const relatedSelection=f.db.prepare('SELECT SelectionId FROM BettingSelections WHERE MarketId=? LIMIT 1').get(related);
    assert.throws(()=>f.book.accept('99',{seasonId:1,stake:100,requestKey:'related_0001',legs:[{selectionId:a.SelectionId,quoteVersion:a.QuoteVersion},{selectionId:relatedSelection.SelectionId,quoteVersion:1}]}),/Related selections/);
    const ticket=f.book.accept('99',{seasonId:1,stake:100,requestKey:'parlay_0001',legs:[{selectionId:a.SelectionId,quoteVersion:a.QuoteVersion},{selectionId:b.SelectionId,quoteVersion:1}]});
    f.book.void(second,'cancelled');assert.equal(f.book.wallet(1,'99').balance,9900);
    f.book.settle(f.market,{team1:{result:'won'},team2:{result:'lost'}});assert.equal(f.book.wallet(1,'99').balance,10080);
    assert.equal(f.db.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status,'won');
    const extra=f.book.publish({seasonId:1,eventId:3,eventRevision:1,stage:'regular',type:'series_winner',title:'Held'},[{key:'a',label:'A',probability:.5},{key:'b',label:'B',probability:.5}],1,'2026-10-17T01:00:00.000Z');
    const q=f.db.prepare('SELECT SelectionId FROM BettingSelections WHERE MarketId=? LIMIT 1').get(extra);
    f.book.eventGuard=()=> 'Started';assert.throws(()=>f.book.accept('99',{seasonId:1,stake:100,requestKey:'started_0001',legs:[{selectionId:q.SelectionId,quoteVersion:1}]}),{code:'MARKET_HELD'});
  }finally{f.db.close();}
});


test('Discord ingestion preserves fixture identity on edits, rejects conflicting revisions, and holds deleted posts',()=>{
  const f=engineFixture();try {
    const message={messageId:'123',channelId:'99',content:'1011111 vs 1022222 Saturday 9est',authoredAt:now.toISOString()};
    const first=f.schedules.ingest(message,1,now);assert.equal(first.status,'parsed');
    assert.equal(f.schedules.ingest(message,1,now).unchanged,true);
    const edited=f.schedules.ingest({...message,content:'1011111 vs 1022222 Sunday 9pm est',editedAt:now.toISOString()},1,now);
    assert.equal(edited.eventId,first.eventId);assert.equal(f.schedules.get(first.eventId).Revision,2);
    assert.throws(()=>f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-18T01:00:00Z',eventId:first.eventId,revision:1}),{code:'REVISION_CONFLICT'});
    f.schedules.ingest({...message,deleted:true},1,now);assert.equal(f.schedules.get(first.eventId).Status,'needs_review');
    f.league.exec("INSERT INTO LeagueSeasons VALUES(2,200,'Later league','active',NULL)");
    assert.equal(f.schedules.ingest({...message,content:'Changed post'},2,now).issue,'belongs_to_another_season');
    assert.equal(f.schedules.get(first.eventId).Status,'needs_review');
  }finally{f.close();}
});

test('Betting generates typed scheduled markets from a validated signup-era generation and holds stale sources',()=>{
  const f=engineFixture();try {
    f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-17T01:00:00Z'},null,now);
    const built=runBetting({...f,now,simulations:50});assert.ok(built.marketsOpened>2);
    const scores=f.betting.prepare("SELECT s.OutcomeKey FROM BettingSelections s JOIN BettingMarkets m ON m.MarketId=s.MarketId WHERE m.MarketType='exact_score'").all();
    assert.deepEqual(scores.map(s=>s.OutcomeKey).sort(),['0-2','1-1','2-0']);
    const count=f.betting.prepare('SELECT COUNT(*) AS n FROM BettingMarkets').get().n;
    const forecasts=f.betting.prepare('SELECT COUNT(*) AS n FROM BettingForecasts').get().n;
    runBetting({...f,now,simulations:50});assert.equal(f.betting.prepare('SELECT COUNT(*) AS n FROM BettingMarkets').get().n,count);
    assert.equal(f.betting.prepare('SELECT COUNT(*) AS n FROM BettingForecasts').get().n,forecasts);
    f.analytics.exec("UPDATE SourceSnapshots SET LastSuccessAtUtc='2026-10-01T00:00:00Z'");
    const stale=runBetting({...f,now,simulations:50});assert.ok(stale.issues.includes('league_source_not_ready'));
    assert.equal(f.betting.prepare("SELECT COUNT(*) AS n FROM BettingMarkets WHERE Status='open'").get().n,0);
  }finally{f.close();}
});

test('legacy pending tickets preserve original tables and settle only against the legacy wallet',()=>{
  const db=new Database(':memory:');try {
    db.exec(`CREATE TABLE UserWallets(user_id TEXT,balance REAL);
      CREATE TABLE ParlayTickets(id INTEGER PRIMARY KEY,user_id TEXT,total_amount REAL,total_odds REAL,total_payout REAL,status TEXT,created_at TEXT);
      CREATE TABLE Markets(id INTEGER PRIMARY KEY,title TEXT,close_time TEXT);
      CREATE TABLE BettingOptions(id INTEGER PRIMARY KEY,market_id INTEGER,name TEXT);
      CREATE TABLE BetLegs(ticket_id INTEGER,option_id INTEGER,odds_at_time REAL);
      INSERT INTO UserWallets VALUES('99',9900);
      INSERT INTO ParlayTickets VALUES(7,'99',100,2,200,'PENDING','2026-10-01T00:00:00Z');
      INSERT INTO Markets VALUES(1,'Old matchup','2026-10-02T00:00:00Z');
      INSERT INTO BettingOptions VALUES(3,1,'A wins'); INSERT INTO BetLegs VALUES(7,3,2);`);
    db.exec("INSERT INTO ParlayTickets VALUES(8,'99',50,4,200,'PENDING','2026-10-01T00:00:00Z');INSERT INTO BetLegs VALUES(8,3,2);INSERT INTO BetLegs VALUES(8,999,2);");
    const book=new BettingStore(db,{now:()=>now});book.registerSeason({SeasonId:1,LeagueName:'New',Status:'active'});book.wallet(1,'99');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BettingLegacyImportIssues').get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM BettingTickets WHERE RequestKey='legacy_ticket_8'").get().n,0);
    settleLegacy(book,1,[3],{seriesId:100,actorId:'1'});
    assert.equal(book.wallet(0,'99').balance,10100);assert.equal(book.wallet(1,'99').balance,10000);
    assert.equal(db.prepare('SELECT status FROM ParlayTickets').get().status,'PENDING');
    assert.equal(db.prepare('SELECT balance FROM UserWallets').get().balance,9900);
    settleLegacy(book,1,[3],{seriesId:100,actorId:'1'});assert.equal(book.wallet(0,'99').balance,10100);
    new BettingStore(db,{now:()=>now});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BettingTickets').get().n,1);
  }finally{db.close();}
});

test('invalidated settlement returns a paid ticket to hold and a corrected result restores its frozen return',()=>{
  const f=bookFixture();try {
    f.ticket('team1');f.book.settle(f.market,{team1:{result:'won'},team2:{result:'lost'}},{matchIds:[1]});
    assert.equal(f.book.wallet(1,'99').balance,10080);
    f.book.settle(f.market,{team1:{result:'pending'},team2:{result:'pending'}},{reason:'bad_source'});
    assert.equal(f.book.wallet(1,'99').balance,9900);assert.equal(f.db.prepare('SELECT Status FROM BettingTickets').get().Status,'pending');
    f.book.settle(f.market,{team1:{result:'won'},team2:{result:'lost'}},{matchIds:[1]});assert.equal(f.book.wallet(1,'99').balance,10080);
  }finally{f.db.close();}
});

test('BO2 settlement waits for both linked games and player props refund a missed game without treating missing metrics as zero',()=>{
  const f=engineFixture();try {
    const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-17T01:00:00Z'},null,now);
    runBetting({...f,now,simulations:50});
    f.league.exec("INSERT INTO SeriesInfo VALUES(900,1011111,1022222,100,'g');INSERT INTO SeriesMatch VALUES(900,1);");
    f.analytics.exec('UPDATE MatchFacts SET SeriesId=900 WHERE MatchId=1');
    const updated=f.schedules.save(1,{eventId:event.EventId,revision:1,team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:event.ScheduledStartUtc,seriesId:900},null,now);
    let inputs=readSeasonBettingInputs(f.analytics,1,now);
    assert.equal(verifiedFixtureGames(f.league,inputs,updated),null);
    f.league.exec('INSERT INTO SeriesMatch VALUES(900,2)');f.analytics.exec('UPDATE MatchFacts SET SeriesId=900 WHERE MatchId=2');
    inputs=readSeasonBettingInputs(f.analytics,1,now);const result=verifiedFixtureGames(f.league,inputs,updated);assert.equal(result.a,1);assert.equal(result.b,1);
    const market=f.betting.prepare("SELECT * FROM BettingMarkets WHERE MarketType='player_prop' AND PlayerId=1 AND Scope='total' AND StatKey='kills'").get();
    f.analytics.exec('DELETE FROM PlayerGameFacts WHERE MatchId=2 AND PlayerId=1');inputs=readSeasonBettingInputs(f.analytics,1,now);
    settleSeason(f.book,f.league,inputs,null,f.schedules.list(1));assert.equal(f.betting.prepare('SELECT Status FROM BettingMarkets WHERE MarketId=?').get(market.MarketId).Status,'void');
    const damage=f.betting.prepare("SELECT * FROM BettingMarkets WHERE MarketType='player_prop' AND PlayerId=2 AND Scope='total' AND StatKey='hero_damage'").get();
    f.analytics.exec('UPDATE PlayerGameFacts SET HeroDamage=NULL WHERE MatchId=2 AND PlayerId=2');inputs=readSeasonBettingInputs(f.analytics,1,now);
    settleSeason(f.book,f.league,inputs,null,f.schedules.list(1));
    assert.notEqual(f.betting.prepare('SELECT Status FROM BettingMarkets WHERE MarketId=?').get(damage.MarketId).Status,'settled');
  }finally{f.close();}
});

test('finalized preseason setup publishes player totals, averages, leaders and supported bracket futures',()=>{
  const f=engineFixture();try {
    f.league.exec("INSERT INTO LeagueSeasons VALUES(2,200,'Next season','signup_closed',NULL);INSERT INTO SeasonLeagueRules VALUES(2,2,2,0,0,NULL);");
    f.analytics.exec(`INSERT INTO SeasonFacts VALUES(1,2,200,'Next season','signup_closed','{"UpperBracketTeams":2,"LowerBracketTeams":2,"EliminatedTeams":0,"HasTiebreaker":false}',NULL,NULL);`);
    for(let team=21;team<=28;team++) {
      const group=team<=24?2:3;f.league.prepare('INSERT INTO SeasonTeams VALUES(?,2,?,?,?,0)').run(team,2000000+team,`Team ${team}`,group);
      f.analytics.prepare('INSERT INTO TeamFacts VALUES(1,?,2,?,?,?,0)').run(team,2000000+team,`Team ${team}`,group);
      f.analytics.prepare("INSERT INTO PrivateTeamFeatures VALUES(1,?,2,6000,5,1,'ready')").run(team);
      for(let slot=0;slot<5;slot++) {const player=team*10+slot;
        f.league.prepare('INSERT INTO SeasonTeamPlayers VALUES(?,?,?)').run(team,player,slot);
        f.analytics.prepare('INSERT INTO PlayerFacts VALUES(1,?,?)').run(player,`Player ${player}`);
        f.analytics.prepare("INSERT INTO RosterMembership VALUES(1,?,?,?,NULL,NULL,1,'submission')").run(team,player,slot);
      }
    }
    f.schedules.finalizeSetup(2,6,'1',now);
    f.schedules.save(2,{team1Key:21,team2Key:22,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-17T01:00:00Z'},'1',now);
    const result=runBetting({...f,seasonId:2,now,simulations:50});assert.ok(result.marketsOpened>20);
    const types=f.betting.prepare('SELECT DISTINCT MarketType FROM BettingMarkets WHERE SeasonId=2').all().map(r=>r.MarketType);
    for(const type of ['season_player','player_leader','champion','placement'])assert.ok(types.includes(type),type);
    assert.equal(f.betting.prepare("SELECT COUNT(*) AS n FROM BettingMarkets WHERE StatKey IN ('gpm','xpm') AND Scope='total'").get().n,0);
    const snapshot=JSON.parse(f.betting.prepare('SELECT InputJson FROM BettingInputSnapshots ORDER BY SnapshotId DESC LIMIT 1').get().InputJson);
    assert.ok(snapshot.setup&&snapshot.events.length&&snapshot.inputs.analyticsRunId);
  }finally{f.close();}
});

test('total and average markets refund exactly-half participation, average leader ties divide gross returns, and shortened seasons refund totals',()=>{
  const f=engineFixture();try {
    f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-17T01:00:00Z'},null,now);
    runBetting({...f,now,simulations:50});
    f.schedules.finalizeSetup(1,50,'1',now);
    f.schedules.completion(1,{completion:'normal',regularSeasonComplete:true},'1',now);
    f.analytics.exec(`UPDATE PlayerGameFacts SET PlayerId=11,Membership='stand_in' WHERE PlayerId=1 AND MatchId>25;
      UPDATE PlayerGameFacts SET PlayerId=12,Membership='stand_in' WHERE PlayerId=2 AND MatchId>26;
      INSERT INTO PlayerTeamSeasonStats SELECT 1,1,TeamSubmissionId,PlayerId,'regular','rostered',COUNT(*),SUM(Won),50,
        COUNT(*)>=5 AND COUNT(*)*2>50 FROM PlayerGameFacts WHERE PlayerId IN (1,2,3) AND Membership='rostered' GROUP BY TeamSubmissionId,PlayerId;
      INSERT INTO PlayerMetricStats SELECT 1,1,TeamSubmissionId,PlayerId,'regular','rostered','Kills',COUNT(Kills),SUM(Kills),AVG(Kills),MIN(Kills),MAX(Kills),0,10,AVG(Kills)
        FROM PlayerGameFacts WHERE PlayerId IN (1,2,3) AND Membership='rostered' GROUP BY TeamSubmissionId,PlayerId;`);
    const roster=[1,2,3].map(PlayerId=>({PlayerId,TeamSubmissionId:11}));
    const forecast=f.betting.prepare('SELECT MIN(ForecastId) AS n FROM BettingForecasts').get().n;
    const definition={seasonId:1,stage:'regular',regularGames:50,roster,stat:'kills'};
    const markets=[];
    for(const scope of ['total','average']) {
      const m=f.book.publish({...definition,type:'season_player',playerId:1,teamKey:11,scope,line:scope==='total'?250.5:10.5,title:'Half participation'},
        [{key:'over',label:'Over',probability:.5},{key:'under',label:'Under',probability:.5}],forecast,'2026-10-17T01:00:00Z');markets.push(m);
    }
    const leader=f.book.publish({...definition,type:'player_leader',scope:'average',title:'Average kills leader'},roster.map(p=>({key:`player:${p.PlayerId}`,label:`Player ${p.PlayerId}`,probability:1/3})),forecast,'2026-10-17T01:00:00Z');
    const wager=(market,key,requestKey)=>{const q=f.betting.prepare('SELECT SelectionId FROM BettingSelections WHERE MarketId=? AND OutcomeKey=?').get(market,key);
      return f.book.accept('99',{seasonId:1,stake:100,requestKey,legs:[{selectionId:q.SelectionId,quoteVersion:1}]});};
    markets.forEach((m,i)=>wager(m,'under',`half_case_${i}`));wager(leader,'player:2','leader_tie_1');
    settleSeason(f.book,f.league,readSeasonBettingInputs(f.analytics,1,now),f.schedules.setup(1),f.schedules.list(1));
    assert.deepEqual(f.betting.prepare("SELECT Status,PayoutCents FROM BettingTickets WHERE RequestKey LIKE 'half_case_%'").all(),[{Status:'refunded',PayoutCents:10000},{Status:'refunded',PayoutCents:10000}]);
    assert.equal(f.betting.prepare("SELECT PayoutCents FROM BettingTickets WHERE RequestKey='leader_tie_1'").get().PayoutCents,13500); // 100 * 2.70 / 2.
    const total=f.book.publish({...definition,type:'season_player',playerId:2,teamKey:11,scope:'total',line:260.5,title:'Season total'},
      [{key:'over',label:'Over',probability:.5},{key:'under',label:'Under',probability:.5}],forecast,'2026-10-17T01:00:00Z');wager(total,'under','shortened_1');
    f.schedules.completion(1,{completion:'shortened',regularSeasonComplete:true},'1',now);
    settleSeason(f.book,f.league,readSeasonBettingInputs(f.analytics,1,now),f.schedules.setup(1),f.schedules.list(1));
    assert.equal(f.betting.prepare("SELECT Status FROM BettingTickets WHERE RequestKey='shortened_1'").get().Status,'refunded');
    f.schedules.completion(1,{completion:'canceled',regularSeasonComplete:true},'1',now);
    settleSeason(f.book,f.league,readSeasonBettingInputs(f.analytics,1,now),f.schedules.setup(1),f.schedules.list(1));
    assert.equal(f.betting.prepare("SELECT PayoutCents FROM BettingTickets WHERE RequestKey='leader_tie_1'").get().PayoutCents,13500);
  }finally{f.close();}
});

test('a permanent replacement refunds only its leader selection before completion while other participants stay pending',()=>{
  const f=bookFixture();try {
    const market=f.book.publish({seasonId:1,stage:'regular',type:'player_leader',stat:'kills',scope:'total',title:'Leader',
      roster:[{PlayerId:1,TeamSubmissionId:11},{PlayerId:2,TeamSubmissionId:11}]},
      [{key:'player:1',label:'First',probability:.5},{key:'player:2',label:'Second',probability:.5}],1,'2026-10-17T01:00:00Z');
    const q=f.db.prepare("SELECT SelectionId FROM BettingSelections WHERE MarketId=? AND OutcomeKey='player:1'").get(market);
    f.book.accept('99',{seasonId:1,stake:100,requestKey:'replacement_1',legs:[{selectionId:q.SelectionId,quoteVersion:1}]});
    f.book.settle(market,{'player:1':{result:'void'},'player:2':{result:'pending'}},{reason:'permanent_roster_change',players:[1]});
    assert.equal(f.book.wallet(1,'99').balance,10000);assert.equal(f.db.prepare("SELECT Status FROM BettingTickets WHERE RequestKey='replacement_1'").get().Status,'refunded');
    assert.equal(f.db.prepare('SELECT Status FROM BettingMarkets WHERE MarketId=?').get(market).Status,'open');
  }finally{f.db.close();}
});

test('accepted returns and the slip use exact decimal arithmetic and floor once to a centipoint',()=>{
  assert.equal(quotedReturn('0.01',[3.15,1.99]),.06);
  assert.equal(exactPayoutCents(10000,[{Result:'won',AcceptedMicros:4000000,Divisor:3}]),13333);
  assert.equal(quotedReturn('100',[2.01,3.15,1.99]),1259.96);
});

test('temporal validation excludes later observations and simultaneous player results',()=>{
  const f=engineFixture();try {
    const inputs=readSeasonBettingInputs(f.analytics,1,now);
    assert.equal(validateBaseline(inputs.history).validated,true);
    const delayed=inputs.history.map(g=>({...g,SourceObservedAtUtc:now.toISOString()}));
    assert.equal(validateBaseline(delayed).samples,0);
    const stats=inputs.metricHistory.map(g=>({...g,SourceObservedAtUtc:now.toISOString()}));
    assert.equal(validateStatDistributions(stats).kills.samples,0);
  }finally{f.close();}
});

test('fixture cancellations, forfeits and changed definitions refund independently of Analytics availability',()=>{
  for(const status of ['cancelled','forfeit','replacement']) {
    const f=engineFixture();try {
      const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-17T01:00:00Z'},null,now);
      runBetting({...f,now,simulations:50});
      const selection=f.betting.prepare("SELECT s.SelectionId,m.QuoteVersion FROM BettingSelections s JOIN BettingMarkets m ON m.MarketId=s.MarketId WHERE m.MarketType='series_winner' LIMIT 1").get();
      const placed=f.book.accept('99',{seasonId:1,stake:100,requestKey:`cancel_${status}`,legs:[{selectionId:selection.SelectionId,quoteVersion:selection.QuoteVersion}]});
      const updated=f.schedules.save(1,{eventId:event.EventId,revision:event.Revision,team1Key:11,team2Key:12,
        stage:status==='replacement'?'playoff':'regular',bestOf:status==='replacement'?3:2,
        scheduledStartUtc:event.ScheduledStartUtc,status:status==='replacement'?'scheduled':status},null,now);
      if(status==='replacement')assert.notEqual(updated.EventId,event.EventId);
      settleOperationalChanges(f.book,f.league);
      assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(placed.ticketId).Status,'refunded');
      assert.equal(f.book.wallet(1,'99').balance,10000);
      settleOperationalChanges(f.book,f.league);assert.equal(f.book.wallet(1,'99').balance,10000);
    }finally{f.close();}
  }
});

test('a kickoff-locked market cannot reopen after a reschedule or a stale-source recovery',()=>{
  const f=engineFixture();try {
    const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-17T01:00:00Z'},null,now);
    runBetting({...f,now,simulations:50});
    const later=new Date('2026-10-17T01:01:00Z');f.book.now=()=>later;
    runBetting({...f,now:later,simulations:50});
    f.schedules.save(1,{eventId:event.EventId,revision:event.Revision,team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-18T01:00:00Z'},null,later);
    f.analytics.prepare('UPDATE AnalyticsRuns SET AsOfUtc=?').run(later.toISOString());
    f.analytics.prepare('UPDATE SourceSnapshots SET LastSuccessAtUtc=?').run(later.toISOString());
    runBetting({...f,now:later,simulations:50});
    assert.equal(f.betting.prepare("SELECT COUNT(*) AS n FROM BettingMarkets WHERE EventId=? AND Status!='locked'").get(event.EventId).n,0);
  }finally{f.close();}
});

test('future fixtures enter the pricing window without requiring changed analytical inputs',()=>{
  const f=engineFixture();try {
    f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-20T13:00:00Z'},null,now);
    assert.equal(runBetting({...f,now,simulations:50}).marketsOpened,0);
    const later=new Date('2026-10-13T14:00:00Z');f.book.now=()=>later;
    assert.ok(runBetting({...f,now:later,simulations:50}).marketsOpened>2);
  }finally{f.close();}
});

test('BO3 and BO5 settle only after the verified clincher and reject extra games after it',()=>{
  for(const bestOf of [3,5]) {
    const f=engineFixture();try {
      const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'playoff',bestOf,scheduledStartUtc:'2026-10-17T01:00:00Z'},null,now);
      runBetting({...f,now,simulations:50});
      const q=f.betting.prepare("SELECT s.SelectionId,m.MarketId,m.QuoteVersion FROM BettingSelections s JOIN BettingMarkets m ON m.MarketId=s.MarketId WHERE m.MarketType='exact_score' AND OutcomeKey=?").get(bestOf===3?'2-0':'3-0');
      const ticket=f.book.accept('99',{seasonId:1,stake:100,requestKey:`postseason_${bestOf}`,legs:[{selectionId:q.SelectionId,quoteVersion:q.QuoteVersion}]});
      f.league.exec("INSERT INTO SeriesInfo VALUES(900,1011111,1022222,100,'p');");
      const updated=f.schedules.save(1,{eventId:event.EventId,revision:1,team1Key:11,team2Key:12,stage:'playoff',bestOf,scheduledStartUtc:event.ScheduledStartUtc,seriesId:900},null,now);
      const target=(bestOf+1)/2;
      for(let g=1;g<=target;g++) {
        f.league.prepare('INSERT INTO SeriesMatch VALUES(900,?)').run(g);
        f.analytics.prepare("UPDATE MatchFacts SET SeriesId=900,Stage='playoff',WinnerTeamId=1011111 WHERE MatchId=?").run(g);
        const inputs=readSeasonBettingInputs(f.analytics,1,now);
        if(g<target)assert.equal(verifiedFixtureGames(f.league,inputs,updated),null);
        settleSeason(f.book,f.league,inputs,null,f.schedules.list(1));
      }
      assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status,'won');
      f.league.prepare('INSERT INTO SeriesMatch VALUES(900,?)').run(target+1);
      f.analytics.prepare("UPDATE MatchFacts SET SeriesId=900,Stage='playoff',WinnerTeamId=1011111 WHERE MatchId=?").run(target+1);
      assert.equal(verifiedFixtureGames(f.league,readSeasonBettingInputs(f.analytics,1,now),updated),null);
      f.league.exec("UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=1");
      const unlinked=f.schedules.save(1,{eventId:event.EventId,revision:updated.Revision,team1Key:11,team2Key:12,stage:'playoff',bestOf,
        scheduledStartUtc:event.ScheduledStartUtc,seriesId:null},null,now);
      assert.equal(unlinked.SeriesId,null);
      assert.throws(()=>f.schedules.save(1,{team1Key:11,team2Key:12,stage:'playoff',bestOf,scheduledStartUtc:event.ScheduledStartUtc},null,now),/New schedules/);
    }finally{f.close();}
  }
});
