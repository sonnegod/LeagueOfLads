import Database from 'better-sqlite3';
import path from 'node:path';

// Voids a market (push) or records its final outcome, then settles only tickets
// whose every leg has resolved. The whole batch and all wallet credits commit
// together. A void leg contributes 1.0 to a parlay's effective odds.
export function settleV2Markets({ bettingPath, results } = {}) {
  if (!bettingPath || !path.isAbsolute(bettingPath)) {
    throw new Error('Pass an explicit absolute Betting v2 database path');
  }
  if (!Array.isArray(results) || !results.length) throw new Error('Pass market results');
  const db = new Database(bettingPath, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    if (db.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    const unique = new Set();
    for (const result of results) {
      if (!Number.isSafeInteger(result.marketId) || result.marketId <= 0 ||
        !['FINAL', 'VOID'].includes(result.status) ||
        typeof result.resultReference !== 'string' || !result.resultReference.trim() ||
        (result.status === 'VOID' && result.winningOutcomeKey != null) ||
        (result.status === 'FINAL' && !result.winningOutcomeKey)) {
        throw new Error('Invalid market result');
      }
      if (unique.has(result.marketId)) throw new Error('Duplicate market in result batch');
      unique.add(result.marketId);
    }
    return db.transaction(() => {
      const now = new Date().toISOString();
      const affectedMarkets = [];
      let newlyRecorded = 0;
      for (const result of results) {
        const market = db.prepare('SELECT id, status FROM Markets WHERE id = ?').get(result.marketId);
        if (!market) throw new Error(`Market ${result.marketId} not found`);
        const winning = result.status === 'FINAL' ? db.prepare(`SELECT id FROM BettingOptions
          WHERE market_id = ? AND outcome_key = ?`).get(result.marketId, result.winningOutcomeKey) : null;
        if (result.status === 'FINAL' && !winning) {
          throw new Error(`Winning option missing for market ${result.marketId}`);
        }
        const existing = db.prepare(`SELECT result_status, result_reference FROM MarketResults
          WHERE market_id = ?`).get(result.marketId);
        if (existing) {
          const oldWinners = db.prepare(`SELECT option_id FROM MarketResultWinningOptions
            WHERE market_id = ?`).all(result.marketId);
          if (existing.result_status !== result.status ||
            existing.result_reference !== result.resultReference ||
            oldWinners.length !== (winning ? 1 : 0) ||
            (winning && oldWinners[0].option_id !== winning.id)) {
            throw new Error(`Market ${result.marketId} already has a different result`);
          }
          continue;
        }
        if (!['DRAFT', 'OPEN', 'LOCKED'].includes(market.status) ||
          (market.status === 'DRAFT' && result.status === 'FINAL')) {
          throw new Error(`Market ${result.marketId} cannot be settled from ${market.status}`);
        }
        db.prepare(`INSERT INTO MarketResults
          (market_id, result_status, result_reference, result_at)
          VALUES (?, ?, ?, ?)`).run(result.marketId, result.status, result.resultReference, now);
        if (winning) {
          db.prepare(`INSERT INTO MarketResultWinningOptions (market_id, option_id)
            VALUES (?, ?)`).run(result.marketId, winning.id);
          db.prepare(`UPDATE BettingOptions SET status = CASE WHEN id = ? THEN 'WON' ELSE 'LOST' END
            WHERE market_id = ?`).run(winning.id, result.marketId);
        } else {
          db.prepare(`UPDATE BettingOptions SET status = 'VOIDED' WHERE market_id = ?`)
            .run(result.marketId);
        }
        db.prepare(`UPDATE Markets SET status = ?, settled_at = ? WHERE id = ?`).run(
          result.status === 'VOID' ? 'VOIDED' : 'SETTLED', now, result.marketId);
        affectedMarkets.push(result.marketId);
        newlyRecorded += 1;
      }
      if (!affectedMarkets.length) return { newlyRecorded: 0, ticketsWon: 0,
        ticketsLost: 0, ticketsRefunded: 0, ticketsPending: 0 };
      const marks = affectedMarkets.map(() => '?').join(',');
      const tickets = db.prepare(`SELECT DISTINCT pt.id, pt.user_id, pt.total_amount
        FROM ParlayTickets pt JOIN BetLegs bl ON bl.ticket_id = pt.id
        WHERE pt.status = 'PENDING' AND bl.market_id IN (${marks})`).all(...affectedMarkets);
      const counts = { newlyRecorded, ticketsWon: 0, ticketsLost: 0,
        ticketsRefunded: 0, ticketsPending: 0 };
      const legsFor = db.prepare(`SELECT bo.status, bl.odds_at_time FROM BetLegs bl
        JOIN BettingOptions bo ON bo.id = bl.option_id WHERE bl.ticket_id = ?`);
      const setTicket = db.prepare(`UPDATE ParlayTickets SET status = ?, settlement_time = ? WHERE id = ?`);
      const credit = db.prepare(`UPDATE UserWallets SET balance = balance + ?,
        total_won = total_won + ? WHERE user_id = ?`);
      const log = db.prepare(`INSERT INTO TransactionLog (user_id, amount, type, reference_id)
        VALUES (?, ?, ?, ?)`);
      for (const ticket of tickets) {
        const legs = legsFor.all(ticket.id);
        if (!legs.length) throw new Error(`Ticket ${ticket.id} has no legs`);
        if (legs.some(leg => leg.status === 'LOST')) {
          setTicket.run('LOST', now, ticket.id);
          counts.ticketsLost += 1;
        } else if (legs.some(leg => leg.status === 'OPEN')) {
          counts.ticketsPending += 1;
        } else if (legs.every(leg => leg.status === 'VOIDED')) {
          if (credit.run(ticket.total_amount, 0, ticket.user_id).changes !== 1) {
            throw new Error(`Wallet missing for ticket ${ticket.id}`);
          }
          log.run(ticket.user_id, ticket.total_amount, 'REFUND', ticket.id);
          setTicket.run('VOIDED', now, ticket.id);
          counts.ticketsRefunded += 1;
        } else {
          const effectiveOdds = legs.filter(leg => leg.status === 'WON')
            .reduce((odds, leg) => odds * leg.odds_at_time, 1);
          const payout = Math.round(ticket.total_amount * effectiveOdds);
          if (!Number.isSafeInteger(payout)) throw new Error('Payout exceeds safe integer range');
          if (credit.run(payout, payout, ticket.user_id).changes !== 1) {
            throw new Error(`Wallet missing for ticket ${ticket.id}`);
          }
          log.run(ticket.user_id, payout, 'PAYOUT', ticket.id);
          setTicket.run('WON', now, ticket.id);
          counts.ticketsWon += 1;
        }
      }
      return counts;
    })();
  } finally { db.close(); }
}
