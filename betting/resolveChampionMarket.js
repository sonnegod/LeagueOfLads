import Database from 'better-sqlite3';

export function resolveChampionMarket({ seasonId, ladsPath, bettingPath } = {}) {
  if (!Number.isSafeInteger(seasonId) || seasonId <= 0 || !ladsPath || !bettingPath) {
    throw new Error('Pass a season ID and both database paths');
  }
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let betting;
  try {
    betting = new Database(bettingPath, { readonly: true, fileMustExist: true });
    if (betting.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    const season = lads.prepare(`SELECT Status, ChampionTeamId, ExternalLeagueId
      FROM LeagueSeasons WHERE SeasonId = ?`).get(seasonId);
    if (!season || season.Status !== 'ended' || !season.ChampionTeamId ||
      !season.ExternalLeagueId) throw new Error('Season champion is not final');
    const winner = lads.prepare(`SELECT TeamSubmissionId FROM SeasonTeams
      WHERE SeasonId = ? AND ExternalTeamId = ?`).all(seasonId, season.ChampionTeamId);
    if (winner.length !== 1) throw new Error('Champion does not map to one season team');
    const market = betting.prepare(`SELECT id FROM Markets WHERE market_key = ?`)
      .get(`${seasonId}:season:champion`);
    if (!market) throw new Error('Season champion market is missing');
    const winningOutcomeKey = `team_submission:${winner[0].TeamSubmissionId}`;
    if (!betting.prepare(`SELECT 1 FROM BettingOptions
      WHERE market_id = ? AND outcome_key = ?`).get(market.id, winningOutcomeKey)) {
      throw new Error('Champion is not an option in the market');
    }
    return { marketId: market.id, status: 'FINAL', winningOutcomeKey,
      resultReference: `season:${seasonId}:champion:${season.ChampionTeamId}` };
  } finally { betting?.close(); lads.close(); }
}

export function resolveChampionMarkets(args = {}) {
  const preseason = resolveChampionMarket(args);
  const betting = new Database(args.bettingPath, { readonly: true, fileMustExist: true });
  try {
    const playoff = betting.prepare('SELECT id FROM Markets WHERE market_key = ?')
      .get(`${args.seasonId}:playoffs:champion`);
    if (!playoff) return [preseason];
    if (!betting.prepare(`SELECT 1 FROM BettingOptions WHERE market_id = ?
      AND outcome_key = ?`).get(playoff.id, preseason.winningOutcomeKey)) {
      throw new Error('Playoff champion is not an option in the market');
    }
    return [preseason, { ...preseason, marketId: playoff.id }];
  } finally { betting.close(); }
}
