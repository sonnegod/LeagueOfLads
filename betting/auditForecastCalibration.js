import Database from 'better-sqlite3';
import path from 'node:path';

// Read-only scoring of the immutable fair probabilities saved when a market
// was drafted. Voided markets provide no outcome and are excluded.
export function auditForecastCalibration({ bettingPath } = {}) {
  if (!bettingPath || !path.isAbsolute(bettingPath)) {
    throw new Error('Pass an absolute Betting v2 database path');
  }
  const db = new Database(bettingPath, { readonly: true, fileMustExist: true });
  try {
    if (db.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    const markets = db.prepare(`SELECT m.id, m.type, m.source_run_key,
      m.source_as_of, r.result_at FROM Markets m JOIN MarketResults r
      ON r.market_id = m.id WHERE r.result_status = 'FINAL' ORDER BY m.id`).all();
    const optionsFor = db.prepare(`SELECT bo.id, p.fair_probability,
      EXISTS (SELECT 1 FROM MarketResultWinningOptions w
        WHERE w.market_id = ? AND w.option_id = bo.id) AS won
      FROM BettingOptions bo JOIN OptionPriceHistory p ON p.id = (
        SELECT MIN(first.id) FROM OptionPriceHistory first WHERE first.option_id = bo.id)
      WHERE bo.market_id = ? ORDER BY bo.id`);
    const groups = new Map();
    for (const market of markets) {
      const outcomes = optionsFor.all(market.id, market.id);
      if (outcomes.length < 2 || outcomes.filter(outcome => outcome.won).length !== 1 ||
        outcomes.some(outcome => !(outcome.fair_probability > 0 && outcome.fair_probability <= 1))) {
        throw new Error(`Settled market ${market.id} has invalid saved probabilities or result`);
      }
      const sum = outcomes.reduce((total, outcome) => total + outcome.fair_probability, 0);
      if (Math.abs(sum - 1) > 0.00001) {
        throw new Error(`Settled market ${market.id} was not normalized`);
      }
      const winner = outcomes.find(outcome => outcome.won);
      const brier = outcomes.reduce((score, outcome) => score +
        (outcome.fair_probability - Number(outcome.won)) ** 2, 0);
      const key = market.type;
      if (!groups.has(key)) groups.set(key, { type: key, markets: 0,
        brierTotal: 0, logLossTotal: 0, uniformLogLossTotal: 0 });
      const group = groups.get(key);
      group.markets += 1;
      group.brierTotal += brier;
      group.logLossTotal -= Math.log(winner.fair_probability);
      group.uniformLogLossTotal += Math.log(outcomes.length);
    }
    return { settledMarkets: markets.length,
      warning: markets.length < 100 ?
        'Fewer than 100 settled markets; calibration estimates are unstable.' : null,
      byType: [...groups.values()].map(group => ({ type: group.type,
        markets: group.markets,
        brier: group.brierTotal / group.markets,
        logLoss: group.logLossTotal / group.markets,
        uniformLogLoss: group.uniformLogLossTotal / group.markets })) };
  } finally { db.close(); }
}
