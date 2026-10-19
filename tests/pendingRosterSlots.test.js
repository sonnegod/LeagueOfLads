import test from 'node:test';
import assert from 'node:assert/strict';
import {preseasonFixture} from './helpers/bettingFixture.js';
import {currentSeasonRoster,conflictingRosterPlayers} from '../betting/rosterMembership.js';
import {currentPendingSlots} from '../config/pendingRosterSlots.js';
import {runBetting,seasonGuard,settleOperationalChanges} from '../betting/engine.js';
import {activeLineup,lineupPrior} from '../betting/rosterStrength.js';
import {readSeasonBettingInputs} from '../analytics/bettingInputs.js';
import {buildSignupPreseasonPreview} from '../betting/signupPreseasonPreview.js';
import {groupTeamMarkets} from '../betting/marketView.js';

const now=new Date('2026-10-13T12:00:00.000Z');
function fixture() {
  const f=preseasonFixture([4]);
  f.league.exec(`CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);
    INSERT INTO PlayerInfo SELECT DISTINCT PlayerId,'Player '||PlayerId FROM SeasonTeamPlayers;
    INSERT INTO PlayerInfo VALUES(999,'New player');
    CREATE TABLE MatchLeague(MatchId INTEGER PRIMARY KEY,LeagueId INTEGER);
    UPDATE SeasonTeamPlayers SET PlayerId=210 WHERE TeamSubmissionId=22 AND Slot=0;`);
  return f;
}
function sync(f) {
  // Mirror the separate Analytics build; its extraction is covered in analytics.test.js.
  const real=currentSeasonRoster(f.league,2,'signup_closed'),pending=currentPendingSlots(f.league,2);
  f.analytics.exec('DELETE FROM RosterMembership WHERE TeamSubmissionId>=21;DELETE FROM PrivatePendingRosterSlots');
  for(const p of real) {
    f.analytics.prepare('INSERT OR IGNORE INTO PlayerFacts VALUES(1,?,?)').run(p.PlayerId,`Player ${p.PlayerId}`);
    f.analytics.prepare("INSERT INTO RosterMembership VALUES(1,?,?,?,'2026-10-13T01:00:00.000Z',NULL,0,'submission')").run(p.TeamSubmissionId,p.PlayerId,p.Slot);
  }
  for(const p of pending)f.analytics.prepare('INSERT INTO PrivatePendingRosterSlots VALUES(1,?,?,?)').run(p.TeamSubmissionId,p.Slot,p.EstimatedMMR);
  f.analytics.prepare("UPDATE PrivateTeamFeatures SET AverageSignupMMR=?,QualityStatus=? WHERE TeamSubmissionId=22")
    .run(pending.length?(4*6000+pending[0].EstimatedMMR)/5:6200,pending.length?'provisional_roster':'ready');
}

test('explicit TBD slots unblock team and confirmed-player markets, hold leaders, and preserve accepted tickets when filled',()=>{
  const f=fixture();try {
    assert.deepEqual(conflictingRosterPlayers(currentSeasonRoster(f.league,2,'signup_closed')),[210]);
    f.schedules.setPendingSlot(2,{teamKey:22,slot:0,estimatedMMR:6500,expectedPlayerId:210},'42',now);
    const setup=JSON.parse(f.schedules.setup(2).SetupJson);
    assert.equal(setup.roster.length,19);assert.equal(setup.pendingSlots.length,1);
    assert.deepEqual(conflictingRosterPlayers(currentSeasonRoster(f.league,2,'signup_closed')),[]);
    assert.equal(f.league.prepare('SELECT PlayerId FROM SeasonTeamPlayers WHERE TeamSubmissionId=22 AND Slot=0').get().PlayerId,210);
    sync(f);
    const result=runBetting({...f,seasonId:2,now,simulations:100});
    assert.equal(result.issues.includes('conflicting_roster_memberships'),false);
    const teams=f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType IN ('champion','placement','season_team') AND Status='open'").all();
    assert.ok(teams.length>0);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE SeasonId=2 AND MarketType='player_leader' AND Status='open'").get().n,0);
    assert.equal(f.betting.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_player' AND TeamKey=22 AND PlayerId=210 AND Status='open'").get().n,0);
    assert.ok(f.betting.prepare("SELECT 1 FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_player' AND PlayerId=210 AND TeamKey=21 AND Status='open'").get());
    assert.match(seasonGuard(f.league,'unused.db',2,{RulesJson:'{}',MarketType:'player_leader'},now),/every roster is confirmed/);
    assert.match(seasonGuard(f.league,'unused.db',2,{RulesJson:'{}',MarketType:'season_player',TeamKey:22,PlayerId:210},now),/not confirmed/);
    const tickets=[];
    for(const market of [teams[0],f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_player' AND PlayerId=211 AND Status='open' LIMIT 1").get()]) {
      const selection=f.betting.prepare('SELECT SelectionId,OfferedMicros FROM BettingSelections WHERE MarketId=? LIMIT 1').get(market.MarketId);
      const ticket=f.book.accept('99',{seasonId:2,stake:100,requestKey:`pending_slot_${market.MarketId}`,legs:[{selectionId:selection.SelectionId,quoteVersion:market.QuoteVersion}]});
      tickets.push({id:ticket.ticketId,odds:selection.OfferedMicros});
    }
    f.schedules.confirmPendingSlot(2,{teamKey:22,slot:0,playerId:999,mmr:7000},'42',now);
    sync(f);runBetting({...f,seasonId:2,now,simulations:100});settleOperationalChanges(f.book,f.league,2);
    for(const t of tickets) {
      assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(t.id).Status,'pending');
      assert.equal(f.betting.prepare('SELECT AcceptedMicros FROM BettingTicketLegs WHERE TicketId=?').get(t.id).AcceptedMicros,t.odds);
    }
    assert.equal(f.book.wallet(2,'99').balance,9800);
    assert.equal(f.league.prepare('SELECT COUNT(*) n FROM SeasonRosterChanges').get().n,0);
    assert.equal(currentPendingSlots(f.league,2).length,0);
    assert.equal(currentSeasonRoster(f.league,2,'signup_closed').find(p=>p.TeamSubmissionId===22&&p.Slot===0).PlayerId,999);
    assert.ok(f.betting.prepare("SELECT 1 FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_player' AND PlayerId=999 AND Status='open'").get());
  }finally{f.close();}
});

test('pending slots reject invalid estimates, occupied confirmed players, stale identities, cross-season targets and duplicate confirmations',()=>{
  const f=fixture();try {
    const save=overrides=>f.schedules.setPendingSlot(2,{teamKey:22,slot:0,estimatedMMR:6500,expectedPlayerId:210,...overrides},'42',now);
    assert.throws(()=>save({estimatedMMR:5500}),/above 5,500/);
    assert.throws(()=>save({teamKey:999}),/Choose a team/);
    assert.throws(()=>save({expectedPlayerId:999}),/roster changed/);
    assert.throws(()=>save({slot:1,expectedPlayerId:221}),/confirmed player/);
    save({});
    assert.throws(()=>f.schedules.confirmPendingSlot(2,{teamKey:22,slot:0,playerId:210,mmr:7000},'42',now),/already on a roster/);
    assert.equal(currentPendingSlots(f.league,2).length,1);
    save({expectedPlayerId:null,estimatedMMR:6600});
    assert.equal(currentPendingSlots(f.league,2)[0].EstimatedMMR,6600);
    f.league.exec('INSERT INTO MatchLeague VALUES(999,200)');
    assert.throws(()=>save({expectedPlayerId:null}),/before the season begins/);
  }finally{f.close();}
});

test('TBD contribution is neutral while the four confirmed player histories still influence team strength',()=>{
  const players=Array.from({length:4},(_,i)=>({PlayerId:i+1,TeamSubmissionId:1,Slot:i,EffectiveFromUtc:'2026-01-01T00:00:00Z',FromEstimated:0}));
  const lineup=activeLineup(players,1,now.toISOString(),[{TeamSubmissionId:1,Slot:4,EstimatedMMR:6000}]);
  assert.equal(lineup.length,5);assert.equal(lineup[4].PlayerId,null);
  const history=players.flatMap(p=>Array.from({length:10},(_,i)=>({PlayerId:p.PlayerId,SeasonId:1,MatchId:i,Won:1,
    StartedAtUtc:'2026-01-01T00:00:00Z',DurationSeconds:2400,SourceObservedAtUtc:'2026-01-02T00:00:00Z'})));
  const result=lineupPrior({lineup,history,seasonId:2,at:now.toISOString()});
  assert.equal(result.ready,true);assert.equal(result.publicReady,false);assert.ok(result.probability>.5);
  assert.equal(lineupPrior({lineup,history:[],seasonId:2,at:now.toISOString()}).ready,false);
});

test('preseason preview supports explicit pending slots and public team labels contain no estimated MMR',()=>{
  const f=fixture();try {
    f.schedules.setPendingSlot(2,{teamKey:22,slot:0,estimatedMMR:6500,expectedPlayerId:210},'42',now);sync(f);
    const inputs=readSeasonBettingInputs(f.analytics,2,now);
    const preview=buildSignupPreseasonPreview({inputs,history:[],simulations:100,now});
    assert.equal(preview.rosterTeams.find(t=>t.teamId===22).pendingPlayers,1);
    assert.equal(preview.markets.filter(m=>m.type==='player_leader').length,0);
    assert.ok(preview.markets.some(m=>m.type==='season_team'));
    const groups=groupTeamMarkets([{type:'season_team',stat:'wins',teamKey:22}],f.schedules.teams(2));
    assert.equal(groups[0].teams[0].pendingPlayers,1);
    assert.doesNotMatch(JSON.stringify(groups),/EstimatedMMR|6500/);
  }finally{f.close();}
});
