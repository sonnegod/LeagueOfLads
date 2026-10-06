import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { rebuildBettingV2, RESET_CONFIRMATION } from '../betting/migrations/rebuildBettingV2.js';
import { settleV2Markets } from '../betting/settleV2Markets.js';
import { voidScheduledSeries } from '../betting/voidScheduledSeries.js';
import { getOpenV2Markets, getV2Bets, getV2Wallet, placeV2Parlay }
  from '../betting/bettingV2Service.js';

function scratchDatabase(t) {
  const directory = mkdtempSync(join(tmpdir(), 'betting-v2-test-'));
  t.after(() => {
    const rel = relative(resolve(tmpdir()), resolve(directory));
    if (rel.startsWith('..') || rel === '' || !basename(directory).startsWith('betting-v2-test-')) {
      throw new Error('Refusing to remove a path outside the test temp directory');
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'Betting.db');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE Markets (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      type TEXT NOT NULL, reference_id TEXT, system_line TEXT, close_time DATETIME,
      status TEXT DEFAULT 'OPEN', Team1 INTEGER, Team2 INTEGER);
    CREATE TABLE BettingOptions (id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id INTEGER NOT NULL, name TEXT NOT NULL, line_value REAL, odds REAL NOT NULL,
      pool INTEGER DEFAULT 0, status TEXT DEFAULT 'OPEN', TeamId INTEGER,
      FOREIGN KEY (market_id) REFERENCES Markets(id));
    CREATE TABLE ParlayTickets (id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, total_amount INTEGER NOT NULL, total_odds REAL NOT NULL,
      total_payout INTEGER, status TEXT DEFAULT 'PENDING', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      settlement_time DATETIME);
    CREATE TABLE BetLegs (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL, odds_at_time REAL NOT NULL, market_type TEXT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES ParlayTickets(id),
      FOREIGN KEY (option_id) REFERENCES BettingOptions(id));
    CREATE TABLE UserWallets (user_id TEXT PRIMARY KEY, balance INTEGER DEFAULT 10000,
      total_wagered INTEGER DEFAULT 0, total_won INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE TransactionLog (id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT NOT NULL,
      reference_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES UserWallets(user_id));

    INSERT INTO Markets (id, title, type) VALUES (1, 'Old matchup', 'matchup');
    INSERT INTO BettingOptions (id, market_id, name, odds) VALUES (2, 1, 'Old option', 1.9);
    INSERT INTO UserWallets (user_id, balance, total_wagered, total_won)
      VALUES ('steam-a', 7300, 4000, 1300), ('steam-b', 9900, 100, 0);
    INSERT INTO ParlayTickets (id, user_id, total_amount, total_odds, total_payout)
      VALUES (3, 'steam-a', 100, 1.9, 190);
    INSERT INTO BetLegs (id, ticket_id, option_id, odds_at_time, market_type)
      VALUES (4, 3, 2, 1.9, 'matchup');
    INSERT INTO TransactionLog (user_id, amount, type) VALUES ('steam-a', -100, 'BET_PLACED');
  `);
  const walletSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'UserWallets'").get().sql;
  db.close();
  return { path, directory, walletSql };
}

test('rebuild requires an explicit path and confirmation; dry run does not mutate', async t => {
  const { path, directory } = scratchDatabase(t);
  await assert.rejects(rebuildBettingV2({ dryRun: true }), /explicit absolute path/);
  await assert.rejects(rebuildBettingV2({ dbPath: 'db/Betting.db', dryRun: true }), /explicit absolute path/);

  const dryRun = await rebuildBettingV2({ dbPath: path, dryRun: true });
  assert.deepEqual(dryRun.counts, {
    wallets: 2, markets: 1, options: 1, tickets: 1, legs: 1, transactions: 1,
  });
  await assert.rejects(rebuildBettingV2({ dbPath: path }), /Reset requires confirmation/);
  assert.deepEqual(readdirSync(directory), ['Betting.db']);

  const db = new Database(path, { readonly: true });
  try {
    assert.equal(db.prepare('SELECT balance FROM UserWallets WHERE user_id = ?').get('steam-a').balance, 7300);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BetLegs').get().n, 1);
  } finally {
    db.close();
  }
});

test('confirmed rebuild backs up legacy data, resets wallets, and is idempotent', async t => {
  const { path, directory, walletSql } = scratchDatabase(t);
  const result = await rebuildBettingV2({ dbPath: path, confirmation: RESET_CONFIRMATION });
  assert.equal(result.changed, true);
  assert.equal(readdirSync(directory).length, 2);

  const backup = new Database(result.backupPath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM BetLegs').get().n, 1);
    assert.equal(backup.prepare('SELECT balance FROM UserWallets WHERE user_id = ?').get('steam-a').balance, 7300);
    assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    backup.close();
  }

  const db = new Database(path, { readonly: true });
  try {
    assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'UserWallets'").get().sql, walletSql);
    assert.deepEqual(db.prepare(`SELECT user_id, balance, total_wagered, total_won
      FROM UserWallets ORDER BY user_id`).all(), [
      { user_id: 'steam-a', balance: 10000, total_wagered: 0, total_won: 0 },
      { user_id: 'steam-b', balance: 10000, total_wagered: 0, total_won: 0 },
    ]);
    for (const table of ['Markets', 'BettingOptions', 'ParlayTickets', 'BetLegs', 'MarketResults']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
    }
    assert.deepEqual(db.prepare('SELECT user_id, amount, type FROM TransactionLog ORDER BY user_id').all(), [
      { user_id: 'steam-a', amount: 10000, type: 'INITIAL_CREDIT' },
      { user_id: 'steam-b', amount: 10000, type: 'INITIAL_CREDIT' },
    ]);
    assert.equal(db.prepare('SELECT backup_path FROM BettingSchemaMeta WHERE id = 1').get().backup_path,
      result.backupPath);
  } finally {
    db.close();
  }

  assert.deepEqual(await rebuildBettingV2({ dbPath: path }), {
    path, changed: false, alreadyV2: true,
  });
  assert.equal(readdirSync(directory).length, 2);
});

test('v2 keys, immutable prices, quoted bet legs, and results enforce identity', async t => {
  const { path } = scratchDatabase(t);
  await rebuildBettingV2({ dbPath: path, confirmation: RESET_CONFIRMATION });
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.prepare(`INSERT INTO Markets
      (market_key, season_id, type, title, status, close_time, source_run_key, source_as_of, published_at)
      VALUES (?, 8, 'season_champion', 'Champion', 'OPEN', ?, 'run-1', ?, ?)`)
      .run('season:8:champion', '2026-11-01T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T01:00:00Z');
    assert.throws(() => db.prepare(`INSERT INTO Markets
      (market_key, season_id, type, title, source_run_key, source_as_of)
      VALUES ('season:8:champion', 8, 'season_champion', 'Duplicate', 'run-1', 'now')`).run(),
    /UNIQUE constraint failed/);

    db.prepare(`INSERT INTO BettingOptions (market_id, outcome_key, name)
      VALUES (1, 'team_submission:42', 'The Lads')`).run();
    assert.throws(() => db.prepare(`INSERT INTO BettingOptions (market_id, outcome_key, name)
      VALUES (1, 'team_submission:42', 'Duplicate')`).run(), /UNIQUE constraint failed/);
    db.prepare(`INSERT INTO OptionPriceHistory
      (option_id, odds, fair_probability, source_run_key, published_at)
      VALUES (1, 3.25, 0.32, 'run-1', '2026-10-05T01:00:00Z')`).run();
    assert.throws(() => db.prepare('UPDATE OptionPriceHistory SET odds = 4 WHERE id = 1').run(), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM OptionPriceHistory WHERE id = 1').run(), /append-only/);

    db.prepare(`INSERT INTO ParlayTickets
      (user_id, total_amount, total_odds, total_payout)
      VALUES ('steam-a', 100, 3.25, 325)`).run();
    assert.throws(() => db.prepare(`INSERT INTO BetLegs
      (ticket_id, market_id, option_id, price_id, odds_at_time)
      VALUES (1, 1, 1, 1, 4)`).run(), /odds do not match/);
    db.prepare(`INSERT INTO BetLegs
      (ticket_id, market_id, option_id, price_id, odds_at_time)
      VALUES (1, 1, 1, 1, 3.25)`).run();
    assert.throws(() => db.prepare(`INSERT INTO BetLegs
      (ticket_id, market_id, option_id, price_id, odds_at_time)
      VALUES (1, 1, 1, 1, 3.25)`).run(), /UNIQUE constraint failed/);

    db.prepare(`INSERT INTO MarketResults (market_id, result_status, result_reference, result_at)
      VALUES (1, 'FINAL', 'league:99:champion', '2027-01-01T00:00:00Z')`).run();
    db.prepare('INSERT INTO MarketResultWinningOptions (market_id, option_id) VALUES (1, 1)').run();
    assert.equal(db.pragma('foreign_key_check').length, 0);
  } finally {
    db.close();
  }
});

test('pushing one series refunds singles and removes only that leg from parlays', async t => {
  const { path } = scratchDatabase(t);
  await rebuildBettingV2({ dbPath: path, confirmation: RESET_CONFIRMATION });
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    const insertMarket = db.prepare(`INSERT INTO Markets
      (market_key, season_id, type, title, reference_id, status,
       source_run_key, source_as_of, close_time, published_at)
      VALUES (?, 7, ?, ?, ?, 'OPEN', 'test-run', '2026-10-05',
        '2026-10-10', '2026-10-05')`);
    insertMarket.run('7:series:99:exact_score', 'series_exact_score', 'Series 99', '99');
    insertMarket.run('7:season:champion', 'team_futures', 'Champion', null);
    const insertOption = db.prepare(`INSERT INTO BettingOptions
      (market_id, outcome_key, name) VALUES (?, ?, ?)`);
    insertOption.run(1, 'team_submission:11:2-0', 'One 2-0');
    insertOption.run(1, 'draw:1-1', 'Draw');
    insertOption.run(2, 'team_submission:11', 'One');
    insertOption.run(2, 'team_submission:12', 'Two');
    const insertPrice = db.prepare(`INSERT INTO OptionPriceHistory
      (option_id, odds, fair_probability, source_run_key, published_at)
      VALUES (?, ?, 0.5, 'test-run', '2026-10-05')`);
    for (let i = 1; i <= 4; i += 1) insertPrice.run(i, i <= 2 ? 2 : 3);
    const ticket = db.prepare(`INSERT INTO ParlayTickets
      (user_id, total_amount, total_odds, total_payout)
      VALUES ('steam-a', 100, ?, ?)`);
    ticket.run(2, 200);
    ticket.run(6, 600);
    ticket.run(6, 600);
    const leg = db.prepare(`INSERT INTO BetLegs
      (ticket_id, market_id, option_id, price_id, odds_at_time)
      VALUES (?, ?, ?, ?, ?)`);
    leg.run(1, 1, 1, 1, 2);
    leg.run(2, 1, 1, 1, 2);
    leg.run(2, 2, 3, 3, 3);
    leg.run(3, 1, 1, 1, 2);
    leg.run(3, 2, 4, 4, 3);
    db.prepare(`UPDATE UserWallets SET balance = 9700, total_wagered = 300
      WHERE user_id = 'steam-a'`).run();
  } finally { db.close(); }
  const pushed = voidScheduledSeries({ bettingPath: path, seriesUid: 99,
    reason: 'played without league ID' });
  assert.equal(pushed.newlyRecorded, 1);
  assert.equal(pushed.ticketsRefunded, 1);
  assert.equal(pushed.ticketsPending, 2);
  assert.equal(voidScheduledSeries({ bettingPath: path, seriesUid: 99,
    reason: 'played without league ID' }).newlyRecorded, 0);
  assert.throws(() => settleV2Markets({ bettingPath: path, results: [
    { marketId: 2, status: 'FINAL', winningOutcomeKey: 'team_submission:11',
      resultReference: 'season:7:champion' },
    { marketId: 999, status: 'VOID', resultReference: 'test:invalid' },
  ] }), /not found/);
  const afterRollback = new Database(path, { readonly: true });
  try {
    assert.equal(afterRollback.prepare('SELECT COUNT(*) AS n FROM MarketResults').get().n, 1);
  } finally { afterRollback.close(); }
  assert.deepEqual(settleV2Markets({ bettingPath: path, results: [{
    marketId: 2, status: 'FINAL', winningOutcomeKey: 'team_submission:11',
    resultReference: 'season:7:champion',
  }] }), { newlyRecorded: 1, ticketsWon: 1, ticketsLost: 1,
    ticketsRefunded: 0, ticketsPending: 0 });
  const checked = new Database(path, { readonly: true });
  try {
    assert.deepEqual(checked.prepare(`SELECT id, status FROM ParlayTickets ORDER BY id`).all(), [
      { id: 1, status: 'VOIDED' }, { id: 2, status: 'WON' }, { id: 3, status: 'LOST' },
    ]);
    assert.deepEqual(checked.prepare(`SELECT balance, total_won FROM UserWallets
      WHERE user_id = 'steam-a'`).get(), { balance: 10100, total_won: 300 });
    assert.deepEqual(checked.prepare(`SELECT amount, type FROM TransactionLog
      WHERE type IN ('REFUND','PAYOUT') ORDER BY id`).all(), [
      { amount: 100, type: 'REFUND' }, { amount: 300, type: 'PAYOUT' },
    ]);
  } finally { checked.close(); }
  assert.throws(() => settleV2Markets({ bettingPath: path, results: [{
    marketId: 1, status: 'FINAL', winningOutcomeKey: 'team_submission:11:2-0',
    resultReference: 'wrong-correction',
  }] }), /different result/);
});

test('v2 wagers use saved prices and combine series result with player props', async t => {
  const { path } = scratchDatabase(t);
  await rebuildBettingV2({ dbPath: path, confirmation: RESET_CONFIRMATION });
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.prepare(`INSERT INTO UserWallets (user_id, balance, total_wagered, total_won)
      VALUES ('123', 10000, 0, 0)`).run();
    const market = db.prepare(`INSERT INTO Markets
      (market_key, season_id, type, title, reference_id, status,
       source_run_key, source_as_of, close_time, published_at)
      VALUES (?, 7, ?, ?, '99', 'OPEN', 'run', '2026-10-05',
        '2026-10-10T00:00:00.000Z', '2026-10-05')`);
    market.run('7:series:99:exact_score', 'series_exact_score', 'Score');
    market.run('7:series:99:player:1101:kills_total', 'series_player_prop', 'Kills');
    const option = db.prepare(`INSERT INTO BettingOptions
      (market_id, outcome_key, name) VALUES (?, ?, ?)`);
    option.run(1, 'team_submission:11:2-0', 'One 2-0');
    option.run(1, 'team_submission:12:2-0', 'Two 2-0');
    option.run(1, 'draw:1-1', 'Draw');
    option.run(2, 'over', 'Over');
    const price = db.prepare(`INSERT INTO OptionPriceHistory
      (option_id, odds, fair_probability, source_run_key, published_at)
      VALUES (?, 2, 0.5, 'run', '2026-10-05')`);
    for (let i = 1; i <= 4; i += 1) price.run(i);
    assert.equal(getOpenV2Markets(db, '2026-10-06T00:00:00.000Z').length, 2);
    assert.throws(() => placeV2Parlay(db, { userId: '123', totalWager: 100,
      now: '2026-10-06T00:00:00.000Z', betLegs: [
        { marketId: 1, optionId: 1 }, { marketId: 1, optionId: 2 },
      ] }), /duplicate bet leg/);
    assert.equal(getV2Wallet(db, '123')[0].balance, 10000);
    const placed = placeV2Parlay(db, { userId: '123', totalWager: 100,
      now: '2026-10-06T00:00:00.000Z', betLegs: [
        { marketId: 1, optionId: 1 }, { marketId: 2, optionId: 4 },
      ] });
    assert.equal(placed.potentialPayout, 400);
    assert.equal(getV2Wallet(db, '123')[0].balance, 9900);
    assert.equal(getV2Bets(db, '123').length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BetLegs').get().n, 2);
    market.run('7:regular:playoffs_vs_eliminated:11', 'team_futures', 'Playoffs');
    market.run('7:season:champion', 'team_futures', 'Champion');
    option.run(3, 'eliminated', 'Eliminated');
    option.run(4, 'team_submission:11', 'One');
    price.run(5);
    price.run(6);
    assert.throws(() => placeV2Parlay(db, { userId: '123', totalWager: 100,
      now: '2026-10-06T00:00:00.000Z', betLegs: [
        { marketId: 3, optionId: 5 }, { marketId: 4, optionId: 6 },
      ] }), /contradictory/);
    assert.equal(getV2Wallet(db, '123')[0].balance, 9900);
    assert.throws(() => placeV2Parlay(db, { userId: '123', totalWager: 1,
      now: '2026-10-11T00:00:00.000Z', betLegs: [{ marketId: 1, optionId: 1 }],
    }), /closed/);
  } finally { db.close(); }
});
