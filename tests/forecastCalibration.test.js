import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditForecastCalibration } from '../betting/auditForecastCalibration.js';

test('calibration uses original fair probabilities and excludes voids', t => {
  const dir = mkdtempSync(join(tmpdir(), 'forecast-calibration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bettingPath = join(dir, 'Betting.db');
  const db = new Database(bettingPath);
  try {
    db.exec(`CREATE TABLE BettingSchemaMeta (id INTEGER, version INTEGER);
      INSERT INTO BettingSchemaMeta VALUES (1,2);
      CREATE TABLE Markets (id INTEGER, type TEXT, source_run_key TEXT, source_as_of TEXT);
      CREATE TABLE MarketResults (market_id INTEGER, result_status TEXT, result_at TEXT);
      CREATE TABLE BettingOptions (id INTEGER, market_id INTEGER);
      CREATE TABLE OptionPriceHistory (id INTEGER, option_id INTEGER, fair_probability REAL);
      CREATE TABLE MarketResultWinningOptions (market_id INTEGER, option_id INTEGER);
      INSERT INTO Markets VALUES (1,'series_exact_score','run','2026-01-01'),
        (2,'series_exact_score','run','2026-01-01');
      INSERT INTO MarketResults VALUES (1,'FINAL','2026-01-02'),
        (2,'VOID','2026-01-02');
      INSERT INTO BettingOptions VALUES (11,1),(12,1),(13,1),(21,2),(22,2);
      INSERT INTO OptionPriceHistory VALUES (1,11,0.2),(2,12,0.3),(3,13,0.5),
        (4,13,0.9),(5,21,0.5),(6,22,0.5);
      INSERT INTO MarketResultWinningOptions VALUES (1,13);`);
  } finally { db.close(); }
  const report = auditForecastCalibration({ bettingPath });
  assert.equal(report.settledMarkets, 1);
  assert.equal(report.byType[0].markets, 1);
  assert.ok(Math.abs(report.byType[0].brier - 0.38) < 1e-10);
  assert.ok(Math.abs(report.byType[0].logLoss - Math.log(2)) < 1e-10);
});
