import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const RESET_CONFIRMATION = 'RESET-ALL-BETS-AND-WALLETS';

const legacyColumns = {
  Markets: ['id', 'title', 'type', 'status'],
  BettingOptions: ['id', 'market_id', 'name', 'odds'],
  ParlayTickets: ['id', 'user_id', 'total_amount', 'status'],
  BetLegs: ['id', 'ticket_id', 'option_id', 'odds_at_time'],
  TransactionLog: ['id', 'user_id', 'amount', 'type'],
  UserWallets: ['user_id', 'balance', 'total_wagered', 'total_won', 'created_at'],
};

const v2Tables = [
  'Markets', 'BettingOptions', 'OptionPriceHistory', 'ParlayTickets', 'BetLegs',
  'MarketResults', 'MarketResultWinningOptions', 'TransactionLog', 'UserWallets',
  'BettingSchemaMeta',
];

function userTables(db) {
  return db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all().map(row => row.name);
}

function tableColumns(db, table) {
  return new Set(db.pragma(`table_info(${table})`).map(row => row.name));
}

function tableSql(db, table) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)?.sql;
}

function isV2(db) {
  if (!userTables(db).includes('BettingSchemaMeta')) return false;
  const version = db.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version;
  if (version !== 2 || v2Tables.some(table => !tableSql(db, table))) {
    throw new Error('Unsupported or incomplete Betting schema version');
  }
  return true;
}

function validateLegacy(db) {
  const found = userTables(db);
  const unexpected = found.filter(table => !Object.hasOwn(legacyColumns, table));
  if (unexpected.length) {
    throw new Error(`Unsupported Betting database; unexpected tables: ${unexpected.join(', ')}`);
  }
  const missing = [];
  for (const [table, columns] of Object.entries(legacyColumns)) {
    if (!found.includes(table)) {
      missing.push(table);
      continue;
    }
    const actual = tableColumns(db, table);
    for (const column of columns) if (!actual.has(column)) missing.push(`${table}.${column}`);
  }
  if (missing.length) throw new Error(`Not a supported Betting database; missing: ${missing.join(', ')}`);
}

function legacyCounts(db) {
  return {
    wallets: db.prepare('SELECT COUNT(*) AS n FROM UserWallets').get().n,
    markets: db.prepare('SELECT COUNT(*) AS n FROM Markets').get().n,
    options: db.prepare('SELECT COUNT(*) AS n FROM BettingOptions').get().n,
    tickets: db.prepare('SELECT COUNT(*) AS n FROM ParlayTickets').get().n,
    legs: db.prepare('SELECT COUNT(*) AS n FROM BetLegs').get().n,
    transactions: db.prepare('SELECT COUNT(*) AS n FROM TransactionLog').get().n,
  };
}

function legacyFingerprint(db) {
  const hash = createHash('sha256');
  const schema = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).iterate();
  for (const row of schema) hash.update(`${JSON.stringify(row)}\n`);
  for (const table of Object.keys(legacyColumns)) {
    hash.update(`table:${table}\n`);
    for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate()) {
      hash.update(`${JSON.stringify(row)}\n`);
    }
  }
  return hash.digest('hex');
}

function createV2Schema(db, backupPath, originalWalletSql) {
  db.exec(`
    DROP TABLE BetLegs;
    DROP TABLE ParlayTickets;
    DROP TABLE BettingOptions;
    DROP TABLE Markets;
    DROP TABLE TransactionLog;

    CREATE TABLE Markets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_key TEXT NOT NULL UNIQUE,
      season_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      reference_id TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'OPEN', 'LOCKED', 'SETTLED', 'VOIDED')),
      close_time TEXT,
      source_run_key TEXT NOT NULL,
      source_as_of TEXT NOT NULL,
      published_at TEXT,
      settled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (status <> 'OPEN' OR (published_at IS NOT NULL AND close_time IS NOT NULL))
    );
    CREATE INDEX idx_Markets_SeasonStatus ON Markets(season_id, status);
    CREATE INDEX idx_Markets_CloseTime ON Markets(close_time) WHERE status = 'OPEN';

    -- Use stable subjects such as team_submission:<TeamSubmissionId> or player:<PlayerId>.
    -- These are values from LadsData, not cross-database foreign keys.
    CREATE TABLE BettingOptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id INTEGER NOT NULL REFERENCES Markets(id),
      outcome_key TEXT NOT NULL,
      name TEXT NOT NULL,
      line_value REAL,
      status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'WON', 'LOST', 'VOIDED')),
      pool INTEGER NOT NULL DEFAULT 0 CHECK (pool >= 0),
      UNIQUE (market_id, outcome_key),
      UNIQUE (market_id, id)
    );

    CREATE TABLE OptionPriceHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      option_id INTEGER NOT NULL REFERENCES BettingOptions(id),
      odds REAL NOT NULL CHECK (odds >= 1),
      fair_probability REAL NOT NULL CHECK (fair_probability BETWEEN 0 AND 1),
      source_run_key TEXT NOT NULL,
      published_at TEXT NOT NULL,
      UNIQUE (option_id, id)
    );
    CREATE INDEX idx_OptionPriceHistory_Latest ON OptionPriceHistory(option_id, id DESC);
    CREATE TRIGGER trg_OptionPriceHistory_NoUpdate BEFORE UPDATE ON OptionPriceHistory
      BEGIN SELECT RAISE(ABORT, 'OptionPriceHistory is append-only'); END;
    CREATE TRIGGER trg_OptionPriceHistory_NoDelete BEFORE DELETE ON OptionPriceHistory
      BEGIN SELECT RAISE(ABORT, 'OptionPriceHistory is append-only'); END;

    CREATE TABLE ParlayTickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES UserWallets(user_id),
      total_amount INTEGER NOT NULL CHECK (total_amount > 0),
      total_odds REAL NOT NULL CHECK (total_odds >= 1),
      total_payout INTEGER NOT NULL CHECK (total_payout >= 0),
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'WON', 'LOST', 'VOIDED')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      settlement_time TEXT
    );
    CREATE INDEX idx_ParlayTickets_UserStatus ON ParlayTickets(user_id, status);

    CREATE TABLE BetLegs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES ParlayTickets(id),
      market_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL,
      price_id INTEGER NOT NULL,
      odds_at_time REAL NOT NULL CHECK (odds_at_time >= 1),
      UNIQUE (ticket_id, market_id),
      FOREIGN KEY (market_id, option_id) REFERENCES BettingOptions(market_id, id),
      FOREIGN KEY (option_id, price_id) REFERENCES OptionPriceHistory(option_id, id)
    );
    CREATE INDEX idx_BetLegs_Option ON BetLegs(option_id);
    CREATE TRIGGER trg_BetLegs_QuotedOdds BEFORE INSERT ON BetLegs
      WHEN NOT EXISTS (SELECT 1 FROM OptionPriceHistory p
        WHERE p.id = NEW.price_id AND p.option_id = NEW.option_id
          AND p.odds = NEW.odds_at_time)
      BEGIN SELECT RAISE(ABORT, 'Bet leg odds do not match its price'); END;

    CREATE TABLE MarketResults (
      market_id INTEGER PRIMARY KEY REFERENCES Markets(id),
      result_status TEXT NOT NULL CHECK (result_status IN ('FINAL', 'VOID')),
      result_reference TEXT NOT NULL,
      result_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE MarketResultWinningOptions (
      market_id INTEGER NOT NULL REFERENCES MarketResults(market_id),
      option_id INTEGER NOT NULL,
      PRIMARY KEY (market_id, option_id),
      FOREIGN KEY (market_id, option_id) REFERENCES BettingOptions(market_id, id)
    );

    CREATE TABLE TransactionLog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES UserWallets(user_id),
      amount INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN
        ('INITIAL_CREDIT', 'BET_PLACED', 'PAYOUT', 'REFUND', 'ADJUSTMENT')),
      reference_id INTEGER REFERENCES ParlayTickets(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_TransactionLog_UserTime ON TransactionLog(user_id, created_at);

    CREATE TABLE BettingSchemaMeta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL CHECK (version = 2),
      reset_at TEXT NOT NULL,
      backup_path TEXT NOT NULL,
      opening_balance INTEGER NOT NULL CHECK (opening_balance = 10000)
    );
  `);

  db.prepare(`UPDATE UserWallets
    SET balance = 10000, total_wagered = 0, total_won = 0`).run();
  db.prepare(`INSERT INTO TransactionLog (user_id, amount, type)
    SELECT user_id, 10000, 'INITIAL_CREDIT' FROM UserWallets`).run();
  db.prepare(`INSERT INTO BettingSchemaMeta
    (id, version, reset_at, backup_path, opening_balance) VALUES (1, 2, ?, ?, 10000)`)
    .run(new Date().toISOString(), backupPath);

  if (tableSql(db, 'UserWallets') !== originalWalletSql) {
    throw new Error('UserWallets schema changed during rebuild');
  }
  if (!isV2(db) || db.pragma('foreign_key_check').length) {
    throw new Error('Betting v2 schema failed verification');
  }
  if (db.pragma('quick_check', { simple: true }) !== 'ok') {
    throw new Error('Betting v2 integrity check failed');
  }
}

export async function rebuildBettingV2({ dbPath, dryRun = false, confirmation } = {}) {
  if (typeof dbPath !== 'string' || !isAbsolute(dbPath)) {
    throw new Error('Pass an explicit absolute path to an existing Betting.db');
  }
  const target = realpathSync(dbPath);
  if (!statSync(target).isFile()) throw new Error(`Not a database file: ${target}`);

  let backupPath;
  let backupFingerprint;
  let counts;
  const source = new Database(target, { readonly: true, fileMustExist: true });
  try {
    source.pragma('busy_timeout = 5000');
    if (isV2(source)) return { path: target, changed: false, alreadyV2: true };
    validateLegacy(source);
    counts = legacyCounts(source);
    if (dryRun) return { path: target, changed: false, dryRun: true, counts };
    if (confirmation !== RESET_CONFIRMATION) {
      throw new Error(`Reset requires confirmation: ${RESET_CONFIRMATION}`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${target}.pre-betting-v2-${stamp}-${randomUUID()}.bak`;
    if (existsSync(backupPath)) throw new Error(`Backup already exists: ${backupPath}`);
    await source.backup(backupPath);
  } finally {
    source.close();
  }

  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    if (backup.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new Error(`Backup integrity check failed: ${backupPath}`);
    }
    validateLegacy(backup);
    backupFingerprint = legacyFingerprint(backup);
  } finally {
    backup.close();
  }

  const db = new Database(target, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      validateLegacy(db);
      if (legacyFingerprint(db) !== backupFingerprint) {
        throw new Error('Betting database changed after backup; stop server/jobs and retry');
      }
      createV2Schema(db, backupPath, tableSql(db, 'UserWallets'));
    }).exclusive();
    db.pragma('foreign_keys = ON');
    return { path: target, changed: true, backupPath, counts };
  } finally {
    db.close();
  }
}
