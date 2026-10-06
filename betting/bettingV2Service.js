// Runtime reads and wager placement for the v2 schema. The database connection
// is owned by databaseBet.js so it shares the application's SQLite lifecycle.
export function isBettingV2(db) {
  const meta = db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'BettingSchemaMeta'`).get();
  return Boolean(meta && db.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1')
    .get()?.version === 2);
}

export function getOpenV2Markets(db, now = new Date().toISOString()) {
  const markets = db.prepare(`SELECT id, market_key, season_id, type, title,
    reference_id, status, close_time FROM Markets
    WHERE status = 'OPEN' AND close_time > ?
    ORDER BY close_time, id`).all(now);
  const optionsFor = db.prepare(`SELECT bo.id, bo.name, bo.outcome_key,
    bo.line_value, bo.pool, p.odds
    FROM BettingOptions bo
    JOIN OptionPriceHistory p ON p.id = (SELECT MAX(latest.id)
      FROM OptionPriceHistory latest WHERE latest.option_id = bo.id)
    WHERE bo.market_id = ? AND bo.status = 'OPEN' ORDER BY bo.id`);
  return markets.map(market => ({ ...market, options: optionsFor.all(market.id), pools: [] }));
}

export function getV2Wallet(db, userId) {
  return db.prepare(`SELECT user_id, balance, total_wagered AS totalWagered,
    total_won AS totalWon, created_at FROM UserWallets WHERE user_id = ?`).all(userId);
}

export function getV2Bets(db, userId) {
  return db.prepare(`SELECT pt.id AS ticket_id, pt.total_amount,
    ROUND(pt.total_odds, 2) AS odds, pt.total_payout AS payout,
    pt.created_at, json_group_array(json_object('option_name', bo.name,
      'odds_taken', bl.odds_at_time, 'market_title', m.title,
      'market_id', m.id, 'status', bo.status)) AS legs
    FROM ParlayTickets pt JOIN BetLegs bl ON bl.ticket_id = pt.id
    JOIN BettingOptions bo ON bo.id = bl.option_id
    JOIN Markets m ON m.id = bl.market_id
    WHERE pt.user_id = ? AND pt.status = 'PENDING'
    GROUP BY pt.id ORDER BY pt.created_at DESC`).all(userId);
}

export function getV2Leaderboard(db) {
  return db.prepare(`SELECT user_id, SUM(amount) AS NetGain
    FROM TransactionLog WHERE type IN ('BET_PLACED', 'PAYOUT', 'REFUND')
    GROUP BY user_id ORDER BY NetGain DESC`).all();
}

export function placeV2Parlay(db, { userId, totalWager, betLegs,
  now = new Date().toISOString() } = {}) {
  if (typeof userId !== 'string' || !/^\d+$/.test(userId) ||
    !Number.isSafeInteger(totalWager) || totalWager <= 0 ||
    !Array.isArray(betLegs) || betLegs.length < 1 || betLegs.length > 10) {
    throw new Error('Invalid wager, account, or leg count');
  }
  if (Number.isNaN(Date.parse(now))) throw new Error('Invalid wager time');
  const seenMarkets = new Set();
  for (const leg of betLegs) {
    if (!Number.isSafeInteger(leg.marketId) || leg.marketId <= 0 ||
      !Number.isSafeInteger(leg.optionId) || leg.optionId <= 0 ||
      seenMarkets.has(leg.marketId)) throw new Error('Invalid or duplicate bet leg');
    seenMarkets.add(leg.marketId);
  }
  const quote = db.prepare(`SELECT m.id AS marketId, m.status AS marketStatus,
    m.close_time AS closeTime, m.type, m.market_key AS marketKey,
    m.reference_id AS referenceId,
    bo.id AS optionId, bo.outcome_key AS outcomeKey,
    bo.status AS optionStatus, p.id AS priceId, p.odds
    FROM Markets m JOIN BettingOptions bo ON bo.market_id = m.id
    JOIN OptionPriceHistory p ON p.id = (SELECT MAX(latest.id)
      FROM OptionPriceHistory latest WHERE latest.option_id = bo.id)
    WHERE m.id = ? AND bo.id = ?`);
  return db.transaction(() => {
    let totalOdds = 1;
    const chosen = [];
    for (const leg of betLegs) {
      const row = quote.get(leg.marketId, leg.optionId);
      if (!row || row.marketStatus !== 'OPEN' || row.optionStatus !== 'OPEN' ||
        !row.closeTime || Number.isNaN(Date.parse(row.closeTime)) ||
        Date.parse(row.closeTime) <= Date.parse(now)) {
        throw new Error(`Market ${leg.marketId} is unavailable or closed`);
      }
      if (!Number.isFinite(row.odds) || row.odds < 1) throw new Error('Invalid market price');
      totalOdds *= row.odds;
      chosen.push(row);
    }
    const eliminated = new Set(chosen.filter(row =>
      /^\d+:regular:playoffs_vs_eliminated:\d+$/.test(row.marketKey) &&
      row.outcomeKey === 'eliminated').map(row => row.marketKey.split(':').at(-1)));
    if (chosen.some(row => {
      const team = /^team_submission:(\d+)$/.exec(row.outcomeKey)?.[1];
      return team && eliminated.has(team) &&
        (/^\d+:regular:group_winner:\d+$/.test(row.marketKey) ||
          row.marketKey.endsWith(':season:champion'));
    })) throw new Error('Bet legs contain contradictory team futures');
    const payout = Math.round(totalWager * totalOdds);
    if (!Number.isSafeInteger(payout)) throw new Error('Potential payout exceeds safe integer range');
    const debit = db.prepare(`UPDATE UserWallets SET balance = balance - ?,
      total_wagered = total_wagered + ? WHERE user_id = ? AND balance >= ?`)
      .run(totalWager, totalWager, userId, totalWager);
    if (debit.changes !== 1) throw new Error('Wallet missing or insufficient funds');
    const ticketId = db.prepare(`INSERT INTO ParlayTickets
      (user_id, total_amount, total_odds, total_payout, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(userId, totalWager, totalOdds,
      payout, now).lastInsertRowid;
    const insertLeg = db.prepare(`INSERT INTO BetLegs
      (ticket_id, market_id, option_id, price_id, odds_at_time)
      VALUES (?, ?, ?, ?, ?)`);
    const addPool = db.prepare('UPDATE BettingOptions SET pool = pool + ? WHERE id = ?');
    for (const row of chosen) {
      insertLeg.run(ticketId, row.marketId, row.optionId, row.priceId, row.odds);
      addPool.run(totalWager, row.optionId);
    }
    db.prepare(`INSERT INTO TransactionLog
      (user_id, amount, type, reference_id) VALUES (?, ?, 'BET_PLACED', ?)`)
      .run(userId, -totalWager, ticketId);
    return { success: true, ticketId: Number(ticketId), finalOdds: totalOdds.toFixed(2),
      potentialPayout: payout };
  })();
}
