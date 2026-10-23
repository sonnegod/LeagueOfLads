import {fixtureGuard,seasonGuard} from './engine.js';
import {marketHasClosed} from './marketTiming.js';
import {ODDS_SCALE} from './pricing.js';

export function readUpcomingSweepOdds({book,league,analyticsPath},games,now=new Date()) {
  const prices=new Map();
  if(!games.length)return prices;
  return book.db.transaction(()=>{
    const markets=book.db.prepare(`SELECT * FROM BettingMarkets WHERE MarketId IN (
      SELECT MAX(MarketId) FROM BettingMarkets WHERE MarketType='exact_score'
      AND EventId IN (${games.map(()=>'?').join(',')}) GROUP BY EventId)`).all(...games.map(game=>game.eventId));
    const sourceState={};
    for(const market of markets) {
      if(market.Status!=='open'||marketHasClosed(market,now)
        ||fixtureGuard(league,market.EventId,market,now,book.env)
        ||seasonGuard(league,analyticsPath,market.SeasonId,market,now,sourceState,book.env))continue;
      if(![2,3,5].includes(market.BestOf))continue;
      const wins=market.BestOf===5?3:2,keys=[`${wins}-0`,`0-${wins}`];
      const selections=book.db.prepare(`SELECT OutcomeKey,OfferedMicros FROM BettingSelections
        WHERE MarketId=? AND IsActive=1 AND OutcomeKey IN (?,?)`).all(market.MarketId,...keys);
      if(selections.length!==2||selections.some(selection=>!Number.isSafeInteger(selection.OfferedMicros)||selection.OfferedMicros<=ODDS_SCALE))continue;
      prices.set(market.EventId,Object.fromEntries(keys.map((score,index)=>[
        index?'team2':'team1',{score,odds:selections.find(selection=>selection.OutcomeKey===score).OfferedMicros/ODDS_SCALE},
      ])));
    }
    return prices;
  })();
}
