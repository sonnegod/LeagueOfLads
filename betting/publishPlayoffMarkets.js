import Database from 'better-sqlite3';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PLAYOFF_PLAYER_MARKETS } from './marketCatalog.js';
import { preparePlayoffBracket } from './analytics/playoffBracketModel.js';

export function publishPlayoffMarkets({ seasonId, ladsPath, bettingPath,
  closeAt, now = new Date().toISOString(), apply = false } = {}) {
  if (!Number.isSafeInteger(seasonId) || seasonId <= 0 || !ladsPath || !bettingPath ||
    !path.isAbsolute(ladsPath) || !path.isAbsolute(bettingPath)) {
    throw new Error('Pass a season ID and absolute LadsData and Betting v2 paths');
  }
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(closeAt || '') ||
    Number.isNaN(Date.parse(closeAt)) || Number.isNaN(Date.parse(now)) ||
    Date.parse(closeAt) <= Date.parse(now)) {
    throw new Error('Pass a future first-playoff-map kickoff in ISO UTC');
  }
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let betting;
  try {
    const season = lads.prepare(`SELECT Status, ExternalLeagueId FROM LeagueSeasons
      WHERE SeasonId = ?`).get(seasonId);
    if (season?.Status !== 'active' || !season.ExternalLeagueId) {
      throw new Error('Playoff markets require an active season');
    }
    const boundary = lads.prepare(`SELECT GroupEndMatchId, TieBreakerEndMatchId
      FROM LeagueStageBoundaries WHERE LeagueId = ?`).get(season.ExternalLeagueId);
    const seededRows = lads.prepare(`SELECT TeamId, Seed, Bracket FROM PlayoffSeeding
      WHERE LeagueId = ? ORDER BY TeamId, Seed, Bracket`).all(season.ExternalLeagueId);
    const bracketJson = lads.prepare(`SELECT PlayoffStructure FROM PlayoffBracket
      WHERE LeagueId = ?`).get(season.ExternalLeagueId)?.PlayoffStructure;
    preparePlayoffBracket(bracketJson, [...new Set(seededRows.map(row => row.TeamId))]);
    const bracketFingerprint = createHash('sha256').update(JSON.stringify({
      boundary, seededRows, bracketJson })).digest('hex');
    betting = new Database(bettingPath, { readonly: !apply, fileMustExist: true });
    betting.pragma('foreign_keys = ON');
    if (betting.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    const expected = new Set([...PLAYOFF_PLAYER_MARKETS.map(market =>
      `${seasonId}:${market.key}`), `${seasonId}:playoffs:champion`]);
    const markets = betting.prepare(`SELECT id, market_key, status, source_run_key,
      source_as_of FROM Markets WHERE season_id = ? AND
      market_key LIKE ? ORDER BY id`).all(seasonId, `${seasonId}:playoffs:%`);
    if (markets.length !== expected.size || markets.some(market => !expected.has(market.market_key))) {
      throw new Error('Playoff draft set is incomplete');
    }
    if (new Set(markets.map(market => market.source_run_key)).size !== 1 ||
      !markets[0].source_run_key.startsWith(
        `playoffs:${seasonId}:playoff-bracket-v1-draft:${bracketFingerprint}:`) ||
      markets.some(market => market.status !== 'DRAFT' ||
        !Number.isFinite(Date.parse(market.source_as_of)) ||
        Date.parse(market.source_as_of) > Date.parse(now))) {
      throw new Error('All playoff markets must be DRAFT from one completed bracket run');
    }
    const optionCounts = betting.prepare(`SELECT COUNT(*) AS options,
      SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM OptionPriceHistory p
        WHERE p.option_id = bo.id) THEN 1 ELSE 0 END) AS unpriced
      FROM BettingOptions bo WHERE bo.market_id = ?`);
    for (const market of markets) {
      const count = optionCounts.get(market.id);
      if (count.options < 2 || count.unpriced) {
        throw new Error(`Playoff market ${market.market_key} is not fully priced`);
      }
    }
    if (!apply) return { dryRun: true, seasonId, closeAt, markets: markets.length,
      sourceRunKey: markets[0].source_run_key };
    const published = betting.transaction(() => {
      const update = betting.prepare(`UPDATE Markets SET status = 'OPEN', close_time = ?,
        published_at = ? WHERE id = ? AND status = 'DRAFT'`);
      for (const market of markets) {
        if (update.run(closeAt, now, market.id).changes !== 1) {
          throw new Error(`Market ${market.id} changed during publication`);
        }
      }
      return markets.length;
    })();
    return { dryRun: false, seasonId, closeAt, published,
      sourceRunKey: markets[0].source_run_key };
  } finally { betting?.close(); lads.close(); }
}
