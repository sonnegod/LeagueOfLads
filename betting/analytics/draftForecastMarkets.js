import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGULAR_PLAYER_MARKETS, PLAYOFF_PLAYER_MARKETS } from '../marketCatalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const playerTitles = new Map([...REGULAR_PLAYER_MARKETS, ...PLAYOFF_PLAYER_MARKETS]
  .map(market => [market.key, market.title]));

function marketTitle(key, teamNames, playerNames) {
  if (playerTitles.has(key)) return playerTitles.get(key);
  if (key === 'season:champion') return 'Season champion';
  if (key === 'playoffs:champion') return 'Playoff champion';
  let match = /^regular:group_winner:(\d+)$/.exec(key);
  if (match) return `Group ${match[1]} winner`;
  match = /^regular:playoffs_vs_eliminated:(\d+)$/.exec(key);
  if (match) return `${teamNames.get(Number(match[1])) || `Team ${match[1]}`}: playoffs or eliminated`;
  match = /^series:(\d+):exact_score$/.exec(key);
  if (match) return `Series ${match[1]}: Bo2 result`;
  match = /^series:(\d+):player:(\d+):(kills|deaths|assists|gpm|xpm)_(total|avg)$/.exec(key);
  if (match) return `${playerNames.get(Number(match[2])) || `Player ${match[2]}`}: ` +
    `${match[3].toUpperCase()} ${match[4] === 'avg' ? 'average' : 'total'} in series ${match[1]}`;
  throw new Error(`Unsupported forecast market: ${key}`);
}

function offeredOdds(probability, margin, cap) {
  return Math.max(1.01, Math.min(cap, Number(((1 - margin) / probability).toFixed(2))));
}

export function draftForecastMarkets({ runId,
  analyticsPath = path.join(root, 'db/Analytics.db'),
  bettingPath, margin = 0.08, oddsCap = 100, dryRun = true,
} = {}) {
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('Pass a positive runId');
  if (!bettingPath || !path.isAbsolute(bettingPath)) {
    throw new Error('Pass an explicit absolute Betting v2 database path');
  }
  if (!Number.isFinite(margin) || margin < 0 || margin >= 0.5) throw new Error('Invalid margin');
  if (!Number.isFinite(oddsCap) || oddsCap < 2) throw new Error('Invalid odds cap');
  const analytics = new Database(analyticsPath, { readonly: true, fileMustExist: true });
  let betting;
  try {
    betting = new Database(bettingPath, { readonly: dryRun, fileMustExist: true });
    betting.pragma('foreign_keys = ON');
    if (betting.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    const run = analytics.prepare(`SELECT RunId, RunKey, SeasonId, CutoffAt, Status,
      ModelVersion FROM AnalyticsRuns WHERE RunId = ?`).get(runId);
    if (!run || run.Status !== 'complete' ||
      !['preseason-regular-', 'series-bo2-', 'playoff-bracket-']
        .some(prefix => run.ModelVersion.startsWith(prefix))) {
      throw new Error('Only completed preseason, playoff, or Bo2 runs can become draft markets');
    }
    const teams = analytics.prepare(`SELECT TeamSubmissionId, TeamName
      FROM PreseasonTeamFeatures WHERE RunId = ?`).all(runId);
    const players = analytics.prepare(`SELECT PlayerId, PlayerName
      FROM PreseasonPlayerFeatures WHERE RunId = ?`).all(runId);
    const teamNames = new Map(teams.map(team => [team.TeamSubmissionId, team.TeamName]));
    const playerNames = new Map(players.map(player => [player.PlayerId, player.PlayerName]));
    const rows = analytics.prepare(`SELECT MarketKey, OutcomeKey, TeamSubmissionId,
      LineValue, FairProbability FROM ModelForecasts WHERE RunId = ?
      ORDER BY MarketKey, OutcomeKey`).all(runId);
    if (!rows.length) throw new Error('Forecast run has no outcomes');
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.MarketKey)) grouped.set(row.MarketKey, []);
      grouped.get(row.MarketKey).push(row);
    }
    const drafts = [];
    for (const [key, outcomes] of grouped) {
      const title = marketTitle(key, teamNames, playerNames);
      const sum = outcomes.reduce((total, row) => total + row.FairProbability, 0);
      if (Math.abs(sum - 1) > 0.00001 || outcomes.length < 2) {
        throw new Error(`Forecast market ${key} is incomplete or not normalized`);
      }
      const options = outcomes.map(row => {
        let name;
        if (row.OutcomeKey.startsWith('player:')) {
          name = playerNames.get(Number(row.OutcomeKey.slice(7)));
        } else if (row.OutcomeKey.startsWith('team_submission:')) {
          const match = /^team_submission:(\d+)(:2-0)?$/.exec(row.OutcomeKey);
          if (match) name = `${teamNames.get(Number(match[1])) || `Team ${match[1]}`}${match[2] || ''}`;
        } else if (row.OutcomeKey === 'qualify') name = 'Make playoffs';
        else if (row.OutcomeKey === 'eliminated') name = 'Eliminated';
        else if (row.OutcomeKey === 'draw:1-1') name = '1-1 draw';
        else if (row.OutcomeKey === 'over') name = `Over ${row.LineValue}`;
        else if (row.OutcomeKey === 'under') name = `Under ${row.LineValue}`;
        if (!name) throw new Error(`Unknown outcome subject: ${row.OutcomeKey}`);
        return { key: row.OutcomeKey, name, probability: row.FairProbability,
          lineValue: row.LineValue, odds: offeredOdds(row.FairProbability, margin, oddsCap) };
      });
      const seriesMatch = /^series:(\d+):/.exec(key);
      drafts.push({ key: `${run.SeasonId}:${key}`, title, type: key.startsWith('regular:season_') ||
        key.startsWith('regular:average_') || key.startsWith('regular:game_')
        || key.startsWith('playoffs:season_') || key.startsWith('playoffs:average_') ||
        key.startsWith('playoffs:game_')
        ? 'player_futures' : key.includes(':player:') ? 'series_player_prop'
          : key.endsWith(':exact_score') ? 'series_exact_score' : 'team_futures',
      referenceId: seriesMatch?.[1] || null, options });
    }
    if (dryRun) return { dryRun: true, runKey: run.RunKey, markets: drafts.length,
      options: rows.length, sample: drafts.slice(0, 3) };
    const apply = betting.transaction(() => {
      const insertMarket = betting.prepare(`INSERT INTO Markets
        (market_key, season_id, type, title, status, reference_id, source_run_key, source_as_of)
        VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?)`);
      const insertOption = betting.prepare(`INSERT INTO BettingOptions
        (market_id, outcome_key, name, line_value) VALUES (?, ?, ?, ?)`);
      const insertPrice = betting.prepare(`INSERT INTO OptionPriceHistory
        (option_id, odds, fair_probability, source_run_key, published_at)
        VALUES (?, ?, ?, ?, ?)`);
      let created = 0;
      for (const draft of drafts) {
        const previous = betting.prepare(`SELECT id, status, source_run_key FROM Markets
          WHERE market_key = ?`).get(draft.key);
        if (previous) {
          if (previous.source_run_key !== run.RunKey || previous.status !== 'DRAFT') {
            throw new Error(`Market ${draft.key} already exists from another run or is no longer draft`);
          }
          continue;
        }
        const marketId = insertMarket.run(draft.key, run.SeasonId,
          draft.type, draft.title, draft.referenceId, run.RunKey, run.CutoffAt).lastInsertRowid;
        for (const option of draft.options) {
          const optionId = insertOption.run(marketId, option.key, option.name,
            option.lineValue).lastInsertRowid;
          insertPrice.run(optionId, option.odds, option.probability,
            run.RunKey, new Date().toISOString());
        }
        created += 1;
      }
      return created;
    });
    const created = apply();
    return { dryRun: false, runKey: run.RunKey, markets: drafts.length,
      created, options: rows.length, status: 'DRAFT' };
  } finally {
    betting?.close();
    analytics.close();
  }
}
