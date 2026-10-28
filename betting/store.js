import { readFileSync } from 'node:fs';
import { digest, fail } from './scheduleStore.js';
import { anchorPrice, movedPrices, ODDS_SCALE, PRICE_POLICY,configuredPricePolicy } from './pricing.js';
import { importLegacyPending } from './legacy.js';
import { toPointCents,exactPayoutCents } from '../client/src/utils/bettingPoints.js';
import {localBettingTestMode} from './localTestPolicy.js';
import {parlayConflict} from '../client/src/utils/bettingParlays.js';
import {marketHasClosed} from './marketTiming.js';
import {workerOwner,workerOwnerAlive} from './workerLock.js';

export function pointCents(value) {
  const cents=toPointCents(value);if(cents===null)fail('Enter points with at most two decimal places');return cents;
}
export class BettingStore {
  constructor(db, { eventGuard = () => null, seasonGuard = () => null, now = () => new Date(),policy=configuredPricePolicy(),env=process.env } = {}) {
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='BettingPreviewMetadata'").get())throw new Error('Historical previews cannot be used as a live betting database');
    const localTesting=localBettingTestMode(env);
    const marked=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='BettingLocalTestMetadata'").get();
    if(marked&&!localTesting)throw new Error('Local test betting databases cannot be used outside development test mode');
    if(localTesting&&!marked) {
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('BettingSchema','BettingMarkets','MatchTeam','AnalyticsRuns') LIMIT 1").get())
        throw new Error('Refusing to convert an existing database into a local test database');
      db.exec('CREATE TABLE BettingLocalTestMetadata(Id INTEGER PRIMARY KEY CHECK(Id=1));INSERT INTO BettingLocalTestMetadata VALUES(1)');
    }
    this.db = db; this.eventGuard = eventGuard; this.seasonGuard = seasonGuard; this.now = now;this.policy=policy;this.env=env;this.localTesting=localTesting;
    db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
    db.exec(readFileSync(new URL('../scripts/db/betting-v2.schema.sql', import.meta.url), 'utf8'));
    if(!db.pragma('table_info(BettingForecasts)').some(c=>c.name==='ForecastKey'))db.exec('ALTER TABLE BettingForecasts ADD COLUMN ForecastKey TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_BettingForecasts_Key ON BettingForecasts(ForecastKey)');
    if(!db.pragma('table_info(BettingSelections)').some(c=>c.name==='IsActive'))db.exec('ALTER TABLE BettingSelections ADD COLUMN IsActive INTEGER NOT NULL DEFAULT 1');
    this.migrateLegacy();
    importLegacyPending(this);
  }
  migrateLegacy() {
    this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM BettingSchema WHERE Version=1').get()) return;
      this.db.prepare("INSERT OR IGNORE INTO BettingSeasons VALUES (0,'Legacy betting','legacy')").run();
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='UserWallets'").get()) {
        for (const wallet of this.db.prepare('SELECT user_id,balance FROM UserWallets').all()) {
          const balance = Math.round(Number(wallet.balance) * 100);
          if (!Number.isSafeInteger(balance)) throw new Error('Legacy balance cannot be migrated');
          this.db.prepare('INSERT OR IGNORE INTO BettingWallets VALUES (0,?,?)').run(String(wallet.user_id), balance);
          this.db.prepare("INSERT OR IGNORE INTO BettingLedger (SeasonId,UserId,AmountCents,Kind,IdempotencyKey,CreatedAtUtc) VALUES (0,?,?,'legacy_snapshot',?,?)")
            .run(String(wallet.user_id), balance, `legacy:${wallet.user_id}`, this.now().toISOString());
        }
      }
      this.db.prepare('INSERT INTO BettingSchema VALUES (1,?)').run(this.now().toISOString());
    })();
  }
  registerSeason(season) { this.db.prepare(`INSERT INTO BettingSeasons VALUES (?,?,?) ON CONFLICT(SeasonId)
    DO UPDATE SET LeagueName=excluded.LeagueName,Status=excluded.Status`).run(season.SeasonId, season.LeagueName, season.Status); }
  wallet(seasonId, userId) {
    if (!Number.isSafeInteger(seasonId) || seasonId < 0 || !/^\d+$/.test(String(userId))) fail('Invalid account');
    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM BettingSeasons WHERE SeasonId=?').get(seasonId)) fail('Season not available', 404);
      this.db.prepare('INSERT OR IGNORE INTO BettingWallets VALUES (?,?,0)').run(seasonId, String(userId));
      if (seasonId > 0) {
        const credit = this.db.prepare(`INSERT OR IGNORE INTO BettingLedger (SeasonId,UserId,AmountCents,Kind,IdempotencyKey,CreatedAtUtc)
          VALUES (?,?,1000000,'season_credit',?,?)`).run(seasonId, String(userId), `start:${seasonId}:${userId}`, this.now().toISOString());
        if (credit.changes) this.db.prepare('UPDATE BettingWallets SET BalanceCents=BalanceCents+1000000 WHERE SeasonId=? AND UserId=?').run(seasonId, String(userId));
      }
      const row = this.db.prepare('SELECT BalanceCents FROM BettingWallets WHERE SeasonId=? AND UserId=?').get(seasonId, String(userId));
      return { seasonId, balance: row.BalanceCents / 100 };
    })();
  }
  credit(ticket, cents, key, kind) {
    if (!Number.isSafeInteger(cents)) fail('Payout exceeds supported point precision', 409);
    const row = this.db.prepare(`INSERT OR IGNORE INTO BettingLedger (SeasonId,UserId,AmountCents,Kind,IdempotencyKey,TicketId,CreatedAtUtc)
      VALUES (?,?,?,?,?,?,?)`).run(ticket.SeasonId, ticket.UserId, cents, kind, key, ticket.TicketId, this.now().toISOString());
    if (row.changes) this.db.prepare('UPDATE BettingWallets SET BalanceCents=BalanceCents+? WHERE SeasonId=? AND UserId=?').run(cents, ticket.SeasonId, ticket.UserId);
  }
  quoteHistory(marketId) {
    const market = this.db.prepare('SELECT QuoteVersion FROM BettingMarkets WHERE MarketId=?').get(marketId);
    const quotes = this.db.prepare('SELECT SelectionId,OfferedMicros FROM BettingSelections WHERE MarketId=? ORDER BY SelectionId').all(marketId);
    this.db.prepare('INSERT OR IGNORE INTO BettingQuoteHistory VALUES (?,?,?,?)').run(marketId, market.QuoteVersion, JSON.stringify(quotes), this.now().toISOString());
  }
  publish(definition, probabilities, forecastId, closeTime=null) {
    const closeAt=closeTime??'';
    if((definition.eventId||closeAt)&&!Number.isFinite(Date.parse(closeAt)))fail('A scheduled market needs a valid close time');
    return this.db.transaction(() => {
      if(Boolean(definition.rules?.localTesting)!==this.localTesting)fail('Local test markets require a dedicated development test database',409);
      if (!probabilities.length || probabilities.some(p => !(p.probability > 0 && p.probability < 1))
        || Math.abs(probabilities.reduce((sum,p) => sum + p.probability,0) - 1) > .000001) fail('Invalid forecast probabilities');
      if(definition.type==='player_leader'&&definition.rules?.leaderField) {
        const ids=(definition.roster||[]).map(p=>`player:${p.PlayerId}`).sort();
        if(ids.length<2||new Set(ids).size!==ids.length||JSON.stringify(ids)!==JSON.stringify(probabilities.map(p=>p.key).sort()))
          fail('Player-leader selections must match the listed field');
      }
      const key = digest({ season: definition.seasonId, event: definition.eventId || null, type: definition.type,
        scope: definition.scope || null, stat: definition.stat || null, player: definition.playerId || null, team: definition.teamKey || null,
        game: definition.gameNumber || null, regularGames: definition.scope==='total'?definition.regularGames||null:null,
        ...(definition.type==='player_leader'&&definition.rules?.leaderField?{leaderField:definition.rules.leaderField}:{}),
        ...(this.localTesting?{localTesting:true}:{}) });
      const previous = this.db.prepare('SELECT * FROM BettingMarkets WHERE DefinitionKey=?').get(key);
      if(previous&&definition.type==='player_leader'&&definition.rules?.leaderField) {
        const field=roster=>roster.map(p=>[p.PlayerId,p.TeamSubmissionId]).sort((a,b)=>a[0]-b[0]);
        if(JSON.stringify(field(JSON.parse(previous.RulesJson).roster))!==JSON.stringify(field(definition.roster||[])))
          fail('A published player-leader market keeps its original listed field',409);
      }
      if(previous&&previous.Line!==(definition.line??null))fail('An existing market keeps its original line',409);
      if (previous && ['settled','void','locked'].includes(previous.Status)) return previous.MarketId;
      if (marketHasClosed({CloseAtUtc:closeAt},this.now())) return previous?.MarketId || null;
      const rules = { version: 1, participation: ['player_prop','season_player','player_leader'].includes(definition.type)
        ?definition.eventId?(definition.scope==='game'?'specified_game':'every_game'):'five_games_and_more_than_half':null,
        roster: definition.roster || [], setupRevision: definition.setupRevision || null, regularGames: definition.regularGames || null,
        ...definition.rules,pricing:this.policy };
      let marketId;
      if (!previous) {
        const result = this.db.prepare(`INSERT INTO BettingMarkets (DefinitionKey,SeasonId,EventId,EventRevision,Stage,MarketType,Scope,StatKey,
          PlayerId,TeamKey,Line,GameNumber,BestOf,Title,RulesJson,RulesVersion,ForecastId,CloseAtUtc,Status,CreatedAtUtc,UpdatedAtUtc)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,'open',?,?)`).run(key, definition.seasonId, definition.eventId || null, definition.eventRevision || null,
            definition.stage, definition.type, definition.scope || null, definition.stat || null, definition.playerId || null, definition.teamKey || null,
            definition.line ?? null, definition.gameNumber || null, definition.bestOf || null, definition.title, JSON.stringify(rules), forecastId, closeAt,
            this.now().toISOString(), this.now().toISOString());
        marketId = Number(result.lastInsertRowid);
      } else {
        marketId = previous.MarketId;
        const old=this.db.prepare('SELECT OutcomeKey,Probability,AnchorMicros FROM BettingSelections WHERE MarketId=? AND IsActive=1').all(marketId);
        const changed=previous.CloseAtUtc!==closeAt||previous.EventRevision!==(definition.eventRevision||null)
          ||old.length!==probabilities.length||probabilities.some(p=>!old.some(o=>o.OutcomeKey===p.key&&o.Probability===p.probability&&o.AnchorMicros===anchorPrice(p.probability,this.policy.margin)));
        this.db.prepare(`UPDATE BettingMarkets SET ForecastId=?,CloseAtUtc=?,EventRevision=?,RulesJson=?,Status='open',HoldReason=NULL,
          QuoteVersion=QuoteVersion+?,UpdatedAtUtc=? WHERE MarketId=?`).run(forecastId, closeAt, definition.eventRevision || null,JSON.stringify(rules),Number(changed), this.now().toISOString(), marketId);
      }
      this.db.prepare('UPDATE BettingSelections SET IsActive=0 WHERE MarketId=?').run(marketId);
      for (const p of probabilities) {
        const anchor = anchorPrice(p.probability,this.policy.margin);
        this.db.prepare(`INSERT INTO BettingSelections (MarketId,OutcomeKey,Label,Probability,AnchorMicros,OfferedMicros)
          VALUES (?,?,?,?,?,?) ON CONFLICT(MarketId,OutcomeKey) DO UPDATE SET Label=excluded.Label,Probability=excluded.Probability,
          AnchorMicros=excluded.AnchorMicros,OfferedMicros=excluded.OfferedMicros,IsActive=1`).run(marketId, p.key, p.label, p.probability, anchor, anchor);
      }
      this.move(marketId, false); this.quoteHistory(marketId); return marketId;
    })();
  }
  move(marketId, bump = true) {
    const rows = this.db.prepare('SELECT * FROM BettingSelections WHERE MarketId=? AND IsActive=1 ORDER BY SelectionId').all(marketId);
    const stakes = rows.map(row => this.db.prepare(`SELECT COALESCE(SUM(t.StakeCents),0) AS cents FROM BettingTickets t
      JOIN BettingTicketLegs l ON l.TicketId=t.TicketId WHERE l.SelectionId=? AND t.Status!='cancelled'`).get(row.SelectionId).cents / 100);
    const policy=JSON.parse(this.db.prepare('SELECT RulesJson FROM BettingMarkets WHERE MarketId=?').get(marketId).RulesJson).pricing||PRICE_POLICY;
    const prices = movedPrices(rows, stakes,policy);
    const changed = rows.some((row,index) => row.OfferedMicros !== prices[index]);
    rows.forEach((row,index) => this.db.prepare('UPDATE BettingSelections SET OfferedMicros=? WHERE SelectionId=?').run(prices[index], row.SelectionId));
    if (changed && bump) { this.db.prepare('UPDATE BettingMarkets SET QuoteVersion=QuoteVersion+1 WHERE MarketId=?').run(marketId); this.quoteHistory(marketId); }
  }
  accept(userId, { seasonId, stake, legs, requestKey }) {
    userId = String(userId); seasonId = Number(seasonId); const cents = pointCents(stake);
    if (!cents || !Array.isArray(legs) || !legs.length || legs.length > 8
      || typeof requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestKey)) fail('Invalid stake, selections or request key');
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM BettingTickets WHERE UserId=? AND RequestKey=?').get(userId, requestKey);
      if (previous) {
        const oldLegs = this.db.prepare('SELECT SelectionId,QuoteVersion FROM BettingTicketLegs WHERE TicketId=? ORDER BY SelectionId').all(previous.TicketId);
        const current = legs.map(l => ({ SelectionId: Number(l.selectionId), QuoteVersion: Number(l.quoteVersion) })).sort((a,b)=>a.SelectionId-b.SelectionId);
        if (previous.SeasonId !== seasonId || previous.StakeCents !== cents || JSON.stringify(oldLegs) !== JSON.stringify(current)) fail('Request key was already used for another ticket',409);
        return { ticketId: previous.TicketId, reused: true };
      }
      const accepted = [];
      for (const leg of legs) {
        const row = this.db.prepare(`SELECT s.*,m.* FROM BettingSelections s JOIN BettingMarkets m ON m.MarketId=s.MarketId WHERE s.SelectionId=?`).get(Number(leg.selectionId));
        if (!row || !row.IsActive || row.SeasonId !== seasonId || row.Status !== 'open' || marketHasClosed(row,this.now())) fail('A selected market is closed',409,'MARKET_CLOSED');
        if(JSON.parse(row.RulesJson).localTesting&&!localBettingTestMode(this.env))fail('Local test markets are disabled',409,'MARKET_HELD');
        if (row.QuoteVersion !== Number(leg.quoteVersion)) fail('Odds changed. Review the refreshed quote before placing your bet.',409,'QUOTE_CHANGED');
        const guard = this.eventGuard(row.EventId, row);
        const seasonIssue = this.seasonGuard(seasonId, row);
        if (guard || seasonIssue) fail(guard || seasonIssue,409,'MARKET_HELD');
        const conflict=parlayConflict([...accepted,row].map(m=>({marketId:m.MarketId,selectionId:m.SelectionId,eventId:m.EventId,
          type:m.MarketType,playerId:m.PlayerId,stat:m.StatKey,scope:m.Scope,gameNumber:m.GameNumber})));
        if(conflict)fail(conflict.message,400,conflict.code);
        accepted.push(row);
      }
      const odds = accepted.reduce((product,l)=>product*l.OfferedMicros/ODDS_SCALE,1);
      if (exactPayoutCents(cents,accepted.map(l=>({Result:'won',AcceptedMicros:l.OfferedMicros,Divisor:1})))===null)fail('Return is too large. Choose fewer selections.');
      if(accepted.some(row=>marketHasClosed(row,this.now())))fail('A selected market is closed',409,'MARKET_CLOSED');
      this.wallet(seasonId,userId);
      const debit = this.db.prepare('UPDATE BettingWallets SET BalanceCents=BalanceCents-? WHERE SeasonId=? AND UserId=? AND BalanceCents>=?')
        .run(cents,seasonId,userId,cents);
      if (!debit.changes) fail('Not enough points',409,'INSUFFICIENT_BALANCE');
      const created = this.db.prepare('INSERT INTO BettingTickets (SeasonId,UserId,StakeCents,RequestKey,PlacedAtUtc) VALUES (?,?,?,?,?)')
        .run(seasonId,userId,cents,requestKey,this.now().toISOString()); const ticketId = Number(created.lastInsertRowid);
      this.db.prepare(`INSERT INTO BettingLedger (SeasonId,UserId,AmountCents,Kind,IdempotencyKey,TicketId,CreatedAtUtc) VALUES (?,?,?,'stake',?,?,?)`)
        .run(seasonId,userId,-cents,`stake:${ticketId}`,ticketId,this.now().toISOString());
      for (const row of accepted) {
        this.db.prepare('INSERT INTO BettingTicketLegs (TicketId,MarketId,SelectionId,OutcomeKey,QuoteVersion,AcceptedMicros,DefinitionJson) VALUES (?,?,?,?,?,?,?)')
          .run(ticketId,row.MarketId,row.SelectionId,row.OutcomeKey,row.QuoteVersion,row.OfferedMicros,JSON.stringify({ type:row.MarketType,scope:row.Scope,
            stat:row.StatKey,playerId:row.PlayerId,teamKey:row.TeamKey,line:row.Line,gameNumber:row.GameNumber,bestOf:row.BestOf,rules:JSON.parse(row.RulesJson) }));
        this.move(row.MarketId);
      }
      return { ticketId, acceptedOdds: odds };
    }).immediate();
  }
  cancellationIssue(ticket,guard=market=>this.eventGuard(market.EventId,market),now=this.now()) {
    if(ticket.Status!=='pending'||ticket.PayoutCents!==0)return 'Only unsettled tickets can be cancelled';
    if(ticket.SeasonId<=0)return 'Legacy tickets cannot be cancelled';
    const legs=this.db.prepare(`SELECT l.Result,m.*,EXISTS(SELECT 1 FROM BettingMarketSettlements s WHERE s.MarketId=l.MarketId) HasSettlement FROM BettingTicketLegs l
      LEFT JOIN BettingMarkets m ON m.MarketId=l.MarketId WHERE l.TicketId=?`).all(ticket.TicketId);
    if(!legs.length||legs.some(leg=>leg.Result!=='pending'||leg.HasSettlement||!leg.MarketId
      ||!['open','held'].includes(leg.Status)||marketHasClosed(leg,now)))return 'A selection has closed or has a result; this ticket cannot be cancelled';
    for(const leg of legs){const issue=guard(leg,now);if(issue)return issue;}
    return null;
  }
  cancel(userId,ticketId,guard=market=>this.eventGuard(market.EventId,market)) {
    if(!/^\d+$/.test(String(userId))||!Number.isSafeInteger(ticketId)||ticketId<=0)fail('Invalid ticket');
    return this.db.transaction(()=>{
      const ticket=this.db.prepare('SELECT * FROM BettingTickets WHERE TicketId=? AND UserId=?').get(ticketId,String(userId));
      if(!ticket)fail('Ticket not found',404);
      if(ticket.Status==='cancelled')return {ticketId,status:'cancelled',refunded:ticket.StakeCents/100,reused:true};
      const issue=this.cancellationIssue(ticket,guard);
      if(issue)fail(issue,409,'TICKET_NOT_CANCELLABLE');
      if(!this.db.prepare('SELECT 1 FROM BettingWallets WHERE SeasonId=? AND UserId=?').get(ticket.SeasonId,ticket.UserId))
        fail('Ticket wallet is unavailable',409);
      this.db.prepare("UPDATE BettingTickets SET Status='cancelled',PayoutCents=StakeCents WHERE TicketId=?").run(ticketId);
      this.db.prepare("UPDATE BettingTicketLegs SET Result='void',Divisor=1 WHERE TicketId=?").run(ticketId);
      this.credit(ticket,ticket.StakeCents,`cancel:${ticketId}`,'cancellation_refund');
      for(const leg of this.db.prepare('SELECT MarketId FROM BettingTicketLegs WHERE TicketId=?').all(ticketId))this.move(leg.MarketId);
      return {ticketId,status:'cancelled',refunded:ticket.StakeCents/100,reused:false};
    }).immediate();
  }
  settle(marketId, outcomes, evidence = {}) {
    return this.db.transaction(() => {
      const market = this.db.prepare('SELECT * FROM BettingMarkets WHERE MarketId=?').get(marketId);
      if (!market) fail('Market not found',404);
      const selections = this.db.prepare('SELECT OutcomeKey FROM BettingSelections WHERE MarketId=?').all(marketId);
      if (selections.some(s => !outcomes[s.OutcomeKey] || !['won','lost','void','pending'].includes(outcomes[s.OutcomeKey].result)
        || !Number.isInteger(outcomes[s.OutcomeKey].divisor || 1) || (outcomes[s.OutcomeKey].divisor || 1) < 1)) fail('Invalid settlement');
      const fingerprint = digest({ outcomes, evidence });
      if (this.db.prepare('SELECT Digest FROM BettingMarketSettlements WHERE MarketId=? ORDER BY Revision DESC LIMIT 1').get(marketId)?.Digest === fingerprint) return false;
      const revision = this.db.prepare('SELECT COALESCE(MAX(Revision),0)+1 AS n FROM BettingMarketSettlements WHERE MarketId=?').get(marketId).n;
      this.db.prepare('INSERT INTO BettingMarketSettlements VALUES (?,?,?,?,?,?)').run(marketId,revision,fingerprint,JSON.stringify(outcomes),JSON.stringify(evidence),this.now().toISOString());
      for (const s of selections) this.db.prepare(`UPDATE BettingTicketLegs SET Result=?,Divisor=? WHERE MarketId=? AND OutcomeKey=?
        AND EXISTS (SELECT 1 FROM BettingTickets t WHERE t.TicketId=BettingTicketLegs.TicketId AND t.Status!='cancelled')`)
        .run(outcomes[s.OutcomeKey].result,outcomes[s.OutcomeKey].divisor || 1,marketId,s.OutcomeKey);
      const pending=selections.some(s=>outcomes[s.OutcomeKey].result==='pending');
      this.db.prepare('UPDATE BettingMarkets SET Status=?,UpdatedAtUtc=? WHERE MarketId=?')
        .run(pending?(['settled','void'].includes(market.Status)?'held':market.Status):selections.every(s => outcomes[s.OutcomeKey].result === 'void') ? 'void' : 'settled',this.now().toISOString(),marketId);
      for (const ticket of this.db.prepare(`SELECT DISTINCT t.* FROM BettingTickets t JOIN BettingTicketLegs l ON l.TicketId=t.TicketId WHERE l.MarketId=? AND t.Status!='cancelled'`).all(marketId)) {
        const legs = this.db.prepare('SELECT * FROM BettingTicketLegs WHERE TicketId=?').all(ticket.TicketId);
        // Wait for every leg even after a loss, so late corrections never require
        // inventing the unknown result of another fixture.
        if (legs.some(l => l.Result === 'pending')) {
          if(ticket.PayoutCents) {this.credit(ticket,-ticket.PayoutCents,`hold:${marketId}:${revision}:${ticket.TicketId}`,'correction');
            this.db.prepare("UPDATE BettingTickets SET Status='pending',PayoutCents=0 WHERE TicketId=?").run(ticket.TicketId);}
          continue;
        }
        const payout=exactPayoutCents(ticket.StakeCents,legs);
        if(payout===null)fail('Return is too large',409);
        const status = legs.every(l => l.Result === 'void') ? 'refunded' : payout ? 'won' : 'lost';
        this.credit(ticket,payout-ticket.PayoutCents,`settle:${marketId}:${revision}:${ticket.TicketId}`,revision === 1 ? 'settlement' : 'correction');
        this.db.prepare('UPDATE BettingTickets SET Status=?,PayoutCents=? WHERE TicketId=?').run(status,payout,ticket.TicketId);
      }
      return true;
    }).immediate();
  }
  void(marketId, reason) { const outcomes = Object.fromEntries(this.db.prepare('SELECT OutcomeKey FROM BettingSelections WHERE MarketId=?').all(marketId)
    .map(s=>[s.OutcomeKey,{ result:'void' }])); return this.settle(marketId,outcomes,{reason}); }
  acquireLock() {
    return this.db.transaction(()=>{
      const owner=workerOwner(),now=this.now();
      const previous=this.db.prepare('SELECT * FROM BettingWorkerLock WHERE Id=1').get();
      if(previous) {
        const alive=workerOwnerAlive(previous.Owner);
        if(alive===true||(alive===null&&previous.LeaseUntilUtc>now.toISOString()))return null;
        this.db.prepare('DELETE FROM BettingWorkerLock WHERE Id=1 AND Owner=?').run(previous.Owner);
      }
      this.db.prepare('INSERT INTO BettingWorkerLock VALUES (1,?,?)').run(owner,new Date(now.getTime()+15*60000).toISOString());
      return owner;
    }).immediate();
  }
}
