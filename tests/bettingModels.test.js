import test from 'node:test';
import assert from 'node:assert/strict';
import {lineupPrior,activeLineup} from '../betting/rosterStrength.js';
import {teamProbability,validateLineupModel} from '../betting/models.js';
import {plannedGames,gameCountsChanged} from '../betting/seasonFormat.js';
import {preseasonFixture,engineFixture} from './helpers/bettingFixture.js';
import {runBetting,settleOperationalChanges} from '../betting/engine.js';
import {readSeasonBettingInputs} from '../analytics/bettingInputs.js';
const at='2026-10-13T12:00:00.000Z';
function strengthInputs() {
  const roster=[1,2].flatMap(team=>Array.from({length:5},(_,slot)=>({TeamSubmissionId:team,PlayerId:(team-1)*5+slot+1,Slot:slot,
    EffectiveFromUtc:'2026-09-01T00:00:00Z',EffectiveToUtc:null,FromEstimated:0})));
  const strengthHistory=roster.flatMap(p=>Array.from({length:20},(_,i)=>({PlayerId:p.PlayerId,MatchId:i+1,SeasonId:1,
    StartedAtUtc:`2026-08-${String(i+1).padStart(2,'0')}T00:00:00Z`,DurationSeconds:2000,
    SourceObservedAtUtc:`2026-08-${String(i+1).padStart(2,'0')}T01:00:00Z`,Won:p.TeamSubmissionId===1?1:0})));
  return {modelMode:'lineup',season:{SeasonId:2},asOf:at,teams:[1,2].map(TeamSubmissionId=>({TeamSubmissionId,AverageSignupMMR:6000})),roster,
    teamStats:[],strengthHistory,historyRosters:roster,
    historyTeams:[1,2].map(TeamSubmissionId=>({TeamSubmissionId,SeasonId:2,AverageSignupMMR:6000,FromEstimated:0,EffectiveFromUtc:'2026-09-01T00:00:00Z'})),
    history:Array.from({length:30},(_,i)=>({MatchId:100+i,SeasonId:2,Team1Key:1,Team2Key:2,Team1Won:1,
      StartedAtUtc:new Date(Date.parse('2026-09-01T00:00:00Z')+i*86400000).toISOString(),DurationSeconds:2000,
      SourceObservedAtUtc:new Date(Date.parse('2026-09-01T01:00:00Z')+i*86400000).toISOString()}))};
}

test('equally ranked new teams receive different strength from their players earlier rostered results, without current-season double counting',()=>{
  const inputs=strengthInputs();const p=teamProbability(inputs,1,2);assert.ok(p>.65&&p<.9);
  assert.ok(Math.abs(teamProbability(inputs,2,1)-(1-p))<1e-12);
  assert.equal(teamProbability({...inputs,modelMode:'roster'},1,2),.5);
  const polluted={...inputs,strengthHistory:[...inputs.strengthHistory,...inputs.strengthHistory.map(g=>({...g,SeasonId:2,Won:1-g.Won}))]};
  assert.equal(teamProbability(polluted,1,2),p);
  const unseen={...inputs,strengthHistory:inputs.strengthHistory.map(g=>({...g,SourceObservedAtUtc:'2026-10-14T00:00:00Z'}))};
  assert.equal(teamProbability(unseen,1,2),.5);
  assert.equal(teamProbability({...inputs,strengthHistory:inputs.strengthHistory.filter(g=>g.MatchId<=4)},1,2),.5);
  const duplicate={...inputs,roster:inputs.roster.map(r=>r.TeamSubmissionId===1?{...r,Slot:0}:r)};
  assert.equal(activeLineup(duplicate.roster,1,at),null);
});

test('tiebreakers remain separate facts and cannot enter pricing history or publish scheduled markets',()=>{
  const f=engineFixture();try {
    f.analytics.exec("UPDATE MatchFacts SET Stage='tiebreaker' WHERE MatchId<=10;UPDATE TeamSeasonStats SET GamesPlayed=40,Wins=20,Losses=20;INSERT INTO TeamSeasonStats VALUES(1,1,11,'tiebreaker',10,5,5),(1,1,12,'tiebreaker',10,5,5)");
    const inputs=readSeasonBettingInputs(f.analytics,1,new Date(at));
    assert.equal(inputs.games.length,50);assert.equal(inputs.history.length,40);assert.equal(inputs.strengthHistory.length,400);
    assert.ok(inputs.metricHistory.every(g=>g.Stage==='regular'));assert.ok(inputs.teamStats.every(t=>t.Stage==='regular'));
    const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'tiebreaker',bestOf:3,scheduledStartUtc:'2026-10-17T01:00:00Z'},'1',new Date(at));
    runBetting({...f,now:new Date(at),simulations:50});assert.equal(f.betting.prepare('SELECT COUNT(*) AS n FROM BettingMarkets WHERE EventId=?').get(event.EventId).n,0);
  }finally{f.close();}
});

test('Betting records the first daily private feature observation without backdating or overwriting it',()=>{
  const f=engineFixture();try {
    f.analytics.exec(`INSERT INTO SourceSnapshots VALUES(1,'public_matches','2026-10-13T12:00:00.000Z','2026-10-13T11:00:00.000Z',1,'complete',0);
      INSERT INTO PrivatePlayerFeatures VALUES(1,1,'2026-07-15T12:00:00.000Z','2026-10-13T12:00:00.000Z',100,60,10,5,15,1,'ready')`);
    runBetting({...f,now:new Date(at),simulations:50});
    const first=f.betting.prepare('SELECT * FROM BettingPrivateFeatureHistory').get();assert.equal(first.ObservedAtUtc,at);assert.equal(first.Wins,60);
    const later=new Date('2026-10-13T13:00:00.000Z');f.book.now=()=>later;
    f.analytics.exec("UPDATE PrivatePlayerFeatures SET Wins=70,AsOfUtc='2026-10-13T13:00:00.000Z';UPDATE AnalyticsRuns SET AsOfUtc='2026-10-13T13:00:00.000Z'");
    runBetting({...f,now:later,simulations:50});
    assert.deepEqual(f.betting.prepare('SELECT * FROM BettingPrivateFeatureHistory').all(),[first]);
    f.analytics.exec("UPDATE PrivatePlayerFeatures SET QualityStatus='stale'");
    runBetting({...f,now:new Date('2026-10-14T12:00:00.000Z'),simulations:50});
    assert.equal(f.betting.prepare('SELECT COUNT(*) AS n FROM BettingPrivateFeatureHistory').get().n,1);
  }finally{f.close();}
});

test('lineup models validate before kickoff, require real prior samples and compare with the simpler model on the same games',()=>{
  const inputs=strengthInputs();const report=validateLineupModel(inputs);
  assert.equal(report.samples,30);assert.equal(report.validated,true);assert.ok(report.brier<report.referenceBrier);
  assert.equal(validateLineupModel({...inputs,strengthHistory:inputs.strengthHistory.map(g=>({...g,SourceObservedAtUtc:at}))}).samples,0);
  assert.equal(validateLineupModel({...inputs,historyRosters:inputs.roster.map(r=>({...r,FromEstimated:1}))}).samples,0);
  assert.equal(validateLineupModel(inputs,{includePublic:true}).samples,0);
});

test('private public summaries need recorded availability, freshness, supported version and all five players',()=>{
  const inputs=strengthInputs(),lineup=inputs.roster.filter(p=>p.TeamSubmissionId===1);
  const features=lineup.map(p=>({PlayerId:p.PlayerId,ObservedAtUtc:'2026-10-13T10:00:00Z',AsOfUtc:'2026-10-13T09:00:00Z',
    FeatureVersion:1,QualityStatus:'ready',SampleCount:100,Wins:80}));
  const predict=publicFeatures=>lineupPrior({lineup,history:inputs.strengthHistory,seasonId:2,at,publicFeatures});
  const baseline=predict([]),publicPrior=predict(features);assert.equal(publicPrior.publicReady,true);assert.ok(publicPrior.probability>baseline.probability);
  for(const unavailable of [features.slice(1),features.map(f=>({...f,ObservedAtUtc:at})),features.map(f=>({...f,AsOfUtc:'2026-10-01T00:00:00Z'})),
    features.map(f=>({...f,SampleCount:10})),features.map(f=>({...f,QualityStatus:'stale'})),features.map(f=>({...f,FeatureVersion:2}))]) {
    assert.equal(predict(unavailable).publicReady,false);assert.equal(predict(unavailable).probability,baseline.probability);
  }
});

test('unequal BO2 groups use their own game counts for lines, setup guards and refunds, preserving accepted quotes',()=>{
  const f=preseasonFixture([4,5]);try {
    const setup=f.schedules.setup(2);assert.equal(plannedGames(setup,21),6);assert.equal(plannedGames(setup,25),8);
    assert.equal(gameCountsChanged(setup,6,21),false);assert.equal(gameCountsChanged(setup,8,25),false);
    const result=runBetting({...f,seasonId:2,now:new Date(at),simulations:100});assert.ok(result.marketsOpened>100);
    const market=team=>f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_player' AND TeamKey=? AND StatKey='kills' AND Scope='total' LIMIT 1").get(team);
    const smaller=market(21),larger=market(25);assert.equal(smaller.Line,60.5);assert.equal(larger.Line,80.5);
    assert.equal(JSON.parse(larger.RulesJson).regularGames,8);
    const q=f.betting.prepare('SELECT SelectionId,OfferedMicros FROM BettingSelections WHERE MarketId=? LIMIT 1').get(larger.MarketId);
    const ticket=f.book.accept('99',{seasonId:2,stake:100,requestKey:'unequal_test_001',legs:[{selectionId:q.SelectionId,quoteVersion:larger.QuoteVersion}]});
    f.schedules.finalizeSetup(2,6,'1',new Date(at));settleOperationalChanges(f.book,f.league,2);
    assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status,'refunded');
    assert.equal(f.betting.prepare('SELECT AcceptedMicros FROM BettingTicketLegs WHERE TicketId=?').get(ticket.ticketId).AcceptedMicros,q.OfferedMicros);
    assert.equal(f.betting.prepare('SELECT Status FROM BettingMarkets WHERE MarketId=?').get(smaller.MarketId).Status,'open');
    assert.equal(f.book.wallet(2,'99').balance,10000);
  }finally{f.close();}
});
