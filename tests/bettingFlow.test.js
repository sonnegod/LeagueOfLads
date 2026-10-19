import test from 'node:test';
import assert from 'node:assert/strict';
import {preseasonFixture} from './helpers/bettingFixture.js';
import {runBetting} from '../betting/engine.js';
const openedAt=new Date('2026-10-13T12:00:00.000Z');

test('finalized preseason and scheduled wagers settle from linked official results, correct idempotently and stay in their season wallet',()=>{
  const f=preseasonFixture();try {
    runBetting({...f,seasonId:2,now:openedAt,simulations:100});
    const total=f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='season_player' AND PlayerId=210 AND StatKey='kills' AND Scope='total'").get();
    const champion=f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='champion'").get();
    const winner=f.betting.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=2 AND MarketType='series_winner'").get();
    const accept=(market,outcome,key)=>{const q=f.betting.prepare('SELECT SelectionId,OfferedMicros FROM BettingSelections WHERE MarketId=? AND OutcomeKey=?').get(market.MarketId,outcome);
      const ticket=f.book.accept('99',{seasonId:2,stake:100,requestKey:key,legs:[{selectionId:q.SelectionId,quoteVersion:market.QuoteVersion}]});
      return {...ticket,quote:q.OfferedMicros};};
    const playerTicket=accept(total,'under','flow_season_player'),championTicket=accept(champion,'team:21','flow_season_champion'),seriesTicket=accept(winner,'team1','flow_series_winner');
    assert.equal(f.book.wallet(2,'99').balance,9700);
    const event=f.schedules.list(2)[0];
    f.league.exec('INSERT INTO SeriesInfo VALUES(1000,2000021,2000022,200,\'g\')');
    f.schedules.save(2,{eventId:event.EventId,revision:event.Revision,team1Key:21,team2Key:22,stage:'regular',bestOf:2,
      scheduledStartUtc:event.ScheduledStartUtc,seriesId:1000},'1',openedAt);
    const teams=f.schedules.teams(2);let match=1000;
    for(const group of [2,3]) {
      const entries=teams.filter(t=>t.GroupId===group);
      for(let a=0;a<entries.length;a++)for(let b=a+1;b<entries.length;b++)for(let g=0;g<2;g++,match++) {
        const left=entries[a],right=entries[b],series=left.TeamSubmissionId===21&&right.TeamSubmissionId===22?1000:null;
        const started=new Date(Date.parse('2026-10-17T01:00:00Z')+(match-1000)*3600000).toISOString();
        f.analytics.prepare(`INSERT INTO MatchFacts(RunId,MatchId,SeasonId,LeagueId,SeriesId,Stage,StartedAtUtc,RecordedDate,TimeSource,DurationSeconds,WinnerTeamId,SourceObservedAtUtc)
          VALUES(1,?,2,200,?,'regular',?,?,'api',2000,?,?)`).run(match,series,started,started,left.ExternalTeamId,started);
        f.analytics.prepare("INSERT INTO TeamGameFacts VALUES(1,?,?,?,?,1,'radiant')").run(match,left.TeamSubmissionId,right.TeamSubmissionId,left.ExternalTeamId);
        f.analytics.prepare("INSERT INTO TeamGameFacts VALUES(1,?,?,?,?,0,'dire')").run(match,right.TeamSubmissionId,left.TeamSubmissionId,right.ExternalTeamId);
        for(const team of [left,right])for(let slot=0;slot<5;slot++)f.analytics.prepare(`INSERT INTO PlayerGameFacts(RunId,MatchId,PlayerId,TeamSubmissionId,HeroId,Won,Membership,Kills)
          VALUES(1,?,?,?,1,?,'rostered',10)`).run(match,team.TeamSubmissionId*10+slot,team.TeamSubmissionId,Number(team===left));
        if(series)f.league.prepare('INSERT INTO SeriesMatch VALUES(1000,?)').run(match);
      }
    }
    f.analytics.exec(`INSERT INTO TeamSeasonStats SELECT 1,2,TeamSubmissionId,'regular',COUNT(*),SUM(Won),COUNT(*)-SUM(Won)
      FROM TeamGameFacts WHERE MatchId>=1000 GROUP BY TeamSubmissionId;
      INSERT INTO PlayerTeamSeasonStats SELECT 1,2,TeamSubmissionId,PlayerId,'regular','rostered',COUNT(*),SUM(Won),6,1
      FROM PlayerGameFacts WHERE MatchId>=1000 GROUP BY TeamSubmissionId,PlayerId;
      INSERT INTO PlayerMetricStats SELECT 1,2,TeamSubmissionId,PlayerId,'regular','rostered','Kills',COUNT(*),SUM(Kills),AVG(Kills),MIN(Kills),MAX(Kills),0,6,AVG(Kills)
      FROM PlayerGameFacts WHERE MatchId>=1000 GROUP BY TeamSubmissionId,PlayerId;`);
    const endedAt=new Date('2026-10-22T12:00:00.000Z');f.book.now=()=>endedAt;
    f.schedules.completion(2,{completion:'normal',regularSeasonComplete:true},'1',endedAt);
    f.league.exec("UPDATE LeagueSeasons SET Status='ended',ChampionTeamId=2000021 WHERE SeasonId=2");
    f.analytics.prepare('UPDATE AnalyticsRuns SET AsOfUtc=?').run(endedAt.toISOString());
    runBetting({...f,seasonId:2,now:endedAt,simulations:100});
    for(const ticket of [playerTicket,championTicket,seriesTicket])assert.equal(f.betting.prepare('SELECT Status FROM BettingTickets WHERE TicketId=?').get(ticket.ticketId).Status,'won');
    const beforeCorrection=f.book.wallet(2,'99').balance;
    f.book.registerSeason({SeasonId:3,LeagueName:'Following season',Status:'signup_open'});assert.equal(f.book.wallet(3,'99').balance,10000);
    f.analytics.exec("UPDATE PlayerMetricStats SET Total=70,Average=70.0/6,Maximum=20 WHERE SeasonId=2 AND PlayerId=210 AND Metric='Kills'");
    runBetting({...f,seasonId:2,now:endedAt,simulations:100});
    const corrected=f.betting.prepare('SELECT * FROM BettingTickets WHERE TicketId=?').get(playerTicket.ticketId);
    assert.equal(corrected.Status,'lost');assert.equal(corrected.PayoutCents,0);
    assert.ok(Math.abs(f.book.wallet(2,'99').balance-(beforeCorrection-playerTicket.quote/10000))<.000001);
    assert.equal(f.book.wallet(3,'99').balance,10000);
    const ledger=f.betting.prepare('SELECT COUNT(*) AS n FROM BettingLedger').get().n;
    runBetting({...f,seasonId:2,now:endedAt,simulations:100});assert.equal(f.betting.prepare('SELECT COUNT(*) AS n FROM BettingLedger').get().n,ledger);
    assert.equal(f.betting.prepare('SELECT AcceptedMicros FROM BettingTicketLegs WHERE TicketId=?').get(playerTicket.ticketId).AcceptedMicros,playerTicket.quote);
  }finally{f.close();}
});
