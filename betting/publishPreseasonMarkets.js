import Database from 'better-sqlite3';
import path from 'node:path';
import { REGULAR_PLAYER_MARKETS } from './marketCatalog.js';

// Publication is a separate, explicitly confirmed step after reviewing the
// complete preseason draft. All futures close together at first-map kickoff.
export function publishPreseasonMarkets({ seasonId, ladsPath, bettingPath,
  closeAt, now = new Date().toISOString(), apply = false } = {}) {
  if (!Number.isSafeInteger(seasonId) || seasonId <= 0 || !ladsPath || !bettingPath ||
    !path.isAbsolute(ladsPath) || !path.isAbsolute(bettingPath)) {
    throw new Error('Pass a season ID and absolute LadsData and Betting v2 paths');
  }
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(closeAt || '') ||
    Number.isNaN(Date.parse(closeAt)) || Number.isNaN(Date.parse(now)) ||
    Date.parse(closeAt) <= Date.parse(now)) {
    throw new Error('The first-map close time must be a future ISO timestamp');
  }
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let betting;
  try {
    const season = lads.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId = ?')
      .get(seasonId);
    if (season?.Status !== 'signup_closed') {
      throw new Error('Only a closed-signup, not-yet-active season can publish preseason markets');
    }
    betting = new Database(bettingPath, { readonly: !apply, fileMustExist: true });
    betting.pragma('foreign_keys = ON');
    if (betting.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    const teams = lads.prepare(`SELECT TeamSubmissionId, GroupId FROM SeasonTeams
      WHERE SeasonId = ? ORDER BY TeamSubmissionId`).all(seasonId);
    if (!teams.length || teams.some(team => !team.GroupId)) {
      throw new Error('Every team must have a group before publishing');
    }
    const expected = new Set([
      ...REGULAR_PLAYER_MARKETS.map(market => `${seasonId}:${market.key}`),
      ...[...new Set(teams.map(team => team.GroupId))].map(groupId =>
        `${seasonId}:regular:group_winner:${groupId}`),
      ...teams.map(team => `${seasonId}:regular:playoffs_vs_eliminated:${team.TeamSubmissionId}`),
      `${seasonId}:season:champion`,
    ]);
    const markets = betting.prepare(`SELECT id, market_key, type, status, source_run_key,
      source_as_of FROM Markets WHERE season_id = ? AND type IN
      ('player_futures', 'team_futures') ORDER BY id`).all(seasonId);
    if (markets.length !== expected.size ||
      markets.some(market => !expected.has(market.market_key))) {
      throw new Error('Preseason draft set is incomplete');
    }
    if (new Set(markets.map(market => market.source_run_key)).size !== 1 ||
      !markets[0].source_run_key.startsWith(`preseason:${seasonId}:`) ||
      markets.some(market => market.status !== 'DRAFT' ||
        !Number.isFinite(Date.parse(market.source_as_of)) ||
        Date.parse(market.source_as_of) > Date.parse(now))) {
      throw new Error('All preseason markets must be DRAFT from one completed forecast run');
    }
    const optionCounts = betting.prepare(`SELECT COUNT(*) AS options,
      SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM OptionPriceHistory p
        WHERE p.option_id = bo.id) THEN 1 ELSE 0 END) AS unpriced
      FROM BettingOptions bo WHERE bo.market_id = ?`);
    for (const market of markets) {
      const count = optionCounts.get(market.id);
      if (count.options < 2 || count.unpriced) {
        throw new Error(`Preseason market ${market.market_key} has incomplete pricing`);
      }
    }
    const preview = { dryRun: !apply, seasonId, closeAt,
      markets: markets.length, sourceRunKey: markets[0].source_run_key };
    if (!apply) return preview;
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
    return { ...preview, dryRun: false, published };
  } finally { betting?.close(); lads.close(); }
}
