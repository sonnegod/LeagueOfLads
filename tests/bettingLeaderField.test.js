import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {engineFixture,preseasonFixture} from './helpers/bettingFixture.js';
import {eligibleLeaderRoster,leaderForecast,seededRandom,LEADER_FIELD_VERSION} from '../betting/models.js';
import {runBetting,settleSeason} from '../betting/engine.js';
import {readSeasonBettingInputs} from '../analytics/bettingInputs.js';
import {createBettingRoutes} from '../routes/bettingRoutes.js';

const now=new Date('2026-10-13T12:00:00.000Z');
const leaderRows=f=>f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='player_leader' AND json_extract(RulesJson,'$.leaderField')=? ORDER BY StatKey,Scope").all(LEADER_FIELD_VERSION);
const refresh=f=>runBetting({...f,seasonId:2,now,simulations:100});
function partialHistory() {
  const f=preseasonFixture();
  f.analytics.exec(`UPDATE PlayerGameFacts SET PlayerId=210 WHERE PlayerId=1;
    UPDATE PlayerGameFacts SET PlayerId=211 WHERE PlayerId=2;
    UPDATE PlayerGameFacts SET PlayerId=212,Kills=CASE WHEN MatchId>46 THEN Kills END WHERE PlayerId=3;`);
  return f;
}

test('leader fields require five personal metric samples, skip unknown players and never invent a one-person market',()=>{
  const roster=[1,2,3,4].map(PlayerId=>({PlayerId,TeamSubmissionId:1,PlayerName:`Player ${PlayerId}`}));
  const metricHistory=roster.flatMap(player=>Array.from({length:player.PlayerId===4?0:player.PlayerId===2?4:8},(_,index)=>({
    PlayerId:player.PlayerId,Kills:player.PlayerId===3&&index<4?null:10,GPM:500})))
    .concat(Array.from({length:60},()=>({PlayerId:999,Kills:10,GPM:500})));
  for(const modelMode of ['league','historical_roster']) {
    const inputs={modelMode,metricHistory};
    assert.deepEqual(eligibleLeaderRoster(inputs,roster,'kills').map(p=>p.PlayerId),[1]);
    assert.equal(leaderForecast(inputs,roster,'kills','total',10,seededRandom(1),100),null);
    const prices=leaderForecast(inputs,roster,'gpm','average',10,seededRandom(1),100);
    assert.deepEqual(prices.map(p=>p.key),['player:1','player:3']);
    assert.ok(Math.abs(prices.reduce((sum,p)=>sum+p.probability,0)-1)<1e-10);
    assert.deepEqual(eligibleLeaderRoster(inputs,[...roster,roster[0]],'gpm'),[]);
  }
});

test('live publication and public leaders API offer only per-stat qualified players and preserve legacy market definitions',async()=>{
  const f=partialHistory();let server;
  try {
    const legacy=f.book.publish({seasonId:2,type:'player_leader',stage:'regular',stat:'kills',scope:'total',title:'Old league-wide leader',
      roster:[210,211,212].map(PlayerId=>({PlayerId,TeamSubmissionId:21}))},[210,211,212].map(PlayerId=>({key:`player:${PlayerId}`,label:`Old ${PlayerId}`,probability:1/3})),1,'2026-10-17T01:00:00.000Z');
    refresh(f);
    const leaders=leaderRows(f);assert.equal(leaders.length,4);
    for(const market of leaders) {
      const field=JSON.parse(market.RulesJson).roster.map(p=>p.PlayerId);
      assert.deepEqual(field,market.StatKey==='kills'?[210,211]:[210,211,212]);
      assert.equal(market.Status,'open');assert.match(market.Title,/Among listed players/);
      assert.equal(f.betting.prepare('SELECT COUNT(*) n FROM BettingSelections WHERE MarketId=?').get(market.MarketId).n,field.length);
    }
    assert.equal(JSON.parse(f.betting.prepare('SELECT RulesJson FROM BettingMarkets WHERE MarketId=?').get(legacy).RulesJson).leaderField,undefined);
    const app=express();app.use(createBettingRoutes({...f,analyticsPath:'unavailable.db',refresh:()=>{}}).publicRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
    const base=`http://127.0.0.1:${server.address().port}/markets?seasonId=2&view=all&type=player_leader`;
    const dto=await(await fetch(base)).json();assert.equal(dto.markets.length,4);
    assert.ok(dto.markets.every(m=>m.leaderField===LEADER_FIELD_VERSION&&m.marketId!==legacy));
    const byName=await(await fetch(`${base}&search=Player%20212`)).json();
    assert.equal(byName.markets.length,2);assert.ok(byName.markets.every(m=>['gpm','xpm'].includes(m.stat)));
    for(const secret of ['SignupMMR','RulesJson','ForecastJson','InputJson'])assert.ok(!JSON.stringify(dto).includes(secret));
  }finally{if(server)await new Promise(done=>server.close(done));f.close();}
});

test('a published field stays frozen when more players gain history, and lost history holds its quotes',()=>{
  const f=partialHistory();try {
    refresh(f);const before=leaderRows(f).map(m=>({id:m.MarketId,stat:m.StatKey,scope:m.Scope,roster:JSON.parse(m.RulesJson).roster}));
    f.analytics.exec('UPDATE PlayerGameFacts SET PlayerId=213 WHERE PlayerId=4; UPDATE PlayerGameFacts SET Kills=10 WHERE PlayerId=212;');
    refresh(f);const after=leaderRows(f);
    assert.deepEqual(after.map(m=>({id:m.MarketId,stat:m.StatKey,scope:m.Scope,roster:JSON.parse(m.RulesJson).roster})),before);
    const market=after.find(m=>m.StatKey==='kills');
    assert.throws(()=>f.book.publish({seasonId:2,type:'player_leader',stage:'regular',stat:market.StatKey,scope:market.Scope,
      title:'Changed field',regularGames:JSON.parse(market.RulesJson).regularGames,roster:[{PlayerId:210,TeamSubmissionId:21},{PlayerId:213,TeamSubmissionId:21}],rules:{leaderField:LEADER_FIELD_VERSION}},
      [210,213].map(id=>({key:`player:${id}`,label:`Player ${id}`,probability:.5})),1,'2026-10-17T01:00:00Z'),/original listed field/);
    f.analytics.exec('UPDATE PlayerGameFacts SET Kills=NULL WHERE PlayerId=210;');refresh(f);
    assert.ok(leaderRows(f).filter(m=>m.StatKey==='kills').every(m=>m.Status==='held'&&m.HoldReason==='leader_field_needs_review'));
    assert.ok(leaderRows(f).filter(m=>m.StatKey!=='kills').every(m=>m.Status==='open'));
  }finally{f.close();}
});

test('listed-field settlement ignores higher unlisted scores and splits ties only among listed eligible players',()=>{
  const f=engineFixture();try {
    f.book.registerSeason(f.league.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId=1').get());
    f.schedules.finalizeSetup(1,50,'1',now);f.schedules.completion(1,{completion:'normal',regularSeasonComplete:true},'1',now);
    f.analytics.exec(`UPDATE PlayerGameFacts SET GPM=CASE WHEN PlayerId IN(1,2) THEN 500 WHEN PlayerId=4 THEN 99999 ELSE 400 END;
      INSERT INTO PlayerTeamSeasonStats SELECT 1,1,TeamSubmissionId,PlayerId,'regular','rostered',COUNT(*),SUM(Won),50,1
        FROM PlayerGameFacts GROUP BY TeamSubmissionId,PlayerId;
      INSERT INTO PlayerMetricStats SELECT 1,1,TeamSubmissionId,PlayerId,'regular','rostered','GPM',COUNT(GPM),SUM(GPM),AVG(GPM),MIN(GPM),MAX(GPM),0,10,AVG(GPM)
        FROM PlayerGameFacts GROUP BY TeamSubmissionId,PlayerId;`);
    const roster=[1,2,3].map(PlayerId=>({PlayerId,TeamSubmissionId:11}));
    const definition={seasonId:1,type:'player_leader',stage:'regular',stat:'gpm',scope:'average',regularGames:50,roster,title:'GPM · Among listed players',rules:{leaderField:LEADER_FIELD_VERSION}};
    const market=f.book.publish(definition,roster.map(p=>({key:`player:${p.PlayerId}`,label:`Player ${p.PlayerId}`,probability:1/3})),1,'2026-10-17T01:00:00Z');
    const selection=f.betting.prepare("SELECT SelectionId FROM BettingSelections WHERE MarketId=? AND OutcomeKey='player:1'").get(market);
    f.book.accept('99',{seasonId:1,stake:100,requestKey:'listed_leader_tie',legs:[{selectionId:selection.SelectionId,quoteVersion:1}]});
    settleSeason(f.book,f.league,readSeasonBettingInputs(f.analytics,1,now),f.schedules.setup(1),[]);
    assert.equal(f.betting.prepare("SELECT PayoutCents FROM BettingTickets WHERE RequestKey='listed_leader_tie'").get().PayoutCents,13500);
    const evidence=JSON.parse(f.betting.prepare('SELECT EvidenceJson FROM BettingMarketSettlements WHERE MarketId=? ORDER BY Revision DESC LIMIT 1').get(market).EvidenceJson);
    assert.deepEqual(evidence.leaders,[1,2]);assert.equal(evidence.leaderField,LEADER_FIELD_VERSION);
  }finally{f.close();}
});
