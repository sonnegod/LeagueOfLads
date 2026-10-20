import { readPreseasonPreviewHistory } from '../analytics/preseasonHistory.js';
import { digest } from './scheduleStore.js';
import { METRICS } from './models.js';

export const HISTORICAL_PRICING_VERSION = 'historical-roster-v1';
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const completedAt = row => Date.parse(row.StartedAtUtc) + Number(row.DurationSeconds) * 1000;
const logit = p => Math.log(p / (1 - p));
const sigmoid = value => 1 / (1 + Math.exp(-value));

// This is a retrospective replay of recorded match participants, not evidence
// that signup rosters or source observations existed at the historical kickoff.
// Keep the original observation timestamps intact, and never use these rows for
// current-season ownership, results, or settlement.
function eligibleGames(history, leagueId, now) {
  const grouped = new Map();
  for (const row of history) {
    if (!grouped.has(row.MatchId)) grouped.set(row.MatchId, []);
    grouped.get(row.MatchId).push(row);
  }
  return [...grouped.values()].filter(rows => {
    const first = rows[0], sides = new Map();
    if (rows.length !== 10 || new Set(rows.map(r => r.PlayerId)).size !== 10
      || first.LeagueId === leagueId || !['regular', 'playoff'].includes(first.Stage)
      || !Number.isFinite(Date.parse(first.StartedAtUtc)) || !(first.DurationSeconds > 0)
      || completedAt(first) >= now.getTime()) return false;
    for (const row of rows) {
      if (!Number.isSafeInteger(row.PlayerId) || row.PlayerId <= 0 || row.TeamSubmissionId == null
        || row.LeagueId !== first.LeagueId || row.Stage !== first.Stage || row.StartedAtUtc !== first.StartedAtUtc
        || row.DurationSeconds !== first.DurationSeconds || ![0, 1].includes(row.Won)
        || !Number.isFinite(Date.parse(row.SourceObservedAtUtc)) || Date.parse(row.SourceObservedAtUtc) > now.getTime()) return false;
      if (!sides.has(row.TeamSubmissionId)) sides.set(row.TeamSubmissionId, []);
      sides.get(row.TeamSubmissionId).push(row);
    }
    const teams = [...sides.values()];
    return teams.length === 2 && teams.every(team => team.length === 5 && team.every(p => p.Won === team[0].Won))
      && teams[0][0].Won + teams[1][0].Won === 1;
  }).sort((a, b) => Date.parse(a[0].StartedAtUtc) - Date.parse(b[0].StartedAtUtc) || a[0].MatchId - b[0].MatchId);
}

function rosterPrior(lineup, byPlayer) {
  const signal = lineup.reduce((sum, player) => {
    const rows = byPlayer.get(player.PlayerId) || [];
    return sum + logit((rows.reduce((wins, row) => wins + row.Won, 0) + 10) / (rows.length + 20));
  }, 0) / 5;
  return sigmoid(.35 * Math.max(-.6, Math.min(.6, signal)));
}

function playerHistory(rows) {
  const players = new Map();
  for (const row of rows) {
    if (!players.has(row.PlayerId)) players.set(row.PlayerId, []);
    const games = players.get(row.PlayerId); games.push(row);
    if (games.length > 100) games.shift();
  }
  return players;
}

export function historicalPricingInputs(inputs, { history, reports = [] }, now = new Date()) {
  const games = eligibleGames(history, inputs.season.LeagueId, now);
  const rows = games.flat().sort((a, b) => completedAt(a) - completedAt(b) || a.MatchId - b.MatchId || a.PlayerId - b.PlayerId);
  let samples = 0, brier = 0, loss = 0;
  const stats = Object.fromEntries(Object.keys(METRICS).map(stat => [stat, { samples: 0, squaredError: 0 }]));
  // A season is held out in full. No match from that season can help predict
  // another match in it, matching the live preseason history policy.
  for (const game of games) {
    const past = rows.filter(row => row.LeagueId !== game[0].LeagueId && completedAt(row) < Date.parse(game[0].StartedAtUtc));
    const players = playerHistory(past), sides = [...new Set(game.map(row => row.TeamSubmissionId))]
      .map(team => game.filter(row => row.TeamSubmissionId === team));
    if (sides.every(side => side.some(player => (players.get(player.PlayerId)?.length || 0) >= 5))) {
      const [a, b] = sides.map(side => rosterPrior(side, players));
      const probability = a * (1 - b) / (a + b - 2 * a * b), actual = sides[0][0].Won;
      brier += (probability - actual) ** 2;
      loss -= actual * Math.log(probability) + (1 - actual) * Math.log(1 - probability); samples++;
    }
    for (const [stat, column] of Object.entries(METRICS)) {
      const pooled = past.filter(row => Number.isFinite(row[column])).slice(-2000).map(row => row[column]);
      if (pooled.length < 50) continue;
      for (const player of game) {
        const own = past.filter(row => row.PlayerId === player.PlayerId && Number.isFinite(row[column])).slice(-100).map(row => row[column]);
        if (own.length < 5 || !Number.isFinite(player[column])) continue;
        const weight = own.length / (own.length + 10), line = Math.floor(weight * mean(own) + (1 - weight) * mean(pooled)) + .5;
        const probability = weight * own.filter(value => value > line).length / own.length
          + (1 - weight) * pooled.filter(value => value > line).length / pooled.length;
        stats[stat].squaredError += (probability - Number(player[column] > line)) ** 2; stats[stat].samples++;
      }
    }
  }
  const score = samples ? brier / samples : null, logLoss = samples ? loss / samples : null;
  const validation = { modelVersion: HISTORICAL_PRICING_VERSION, method: 'retrospective_season_holdout',
    lineupSource: 'recorded_match_participants', availabilityAssumption: 'prior_season_results_available_after_completion',
    historicalSignupMMRUsed: false, samples, brier: score, logLoss,
    validated: samples >= 20 && score <= .27 && logLoss <= .8,
    reason: samples < 20 ? 'insufficient_historical_samples' : score > .27 || logLoss > .8 ? 'historical_pricing_validation_failed' : null,
    games: games.length, seasons: reports,
    statDistributions: Object.fromEntries(Object.entries(stats).map(([stat, report]) => [stat, {
      samples: report.samples, brier: report.samples ? report.squaredError / report.samples : null,
      validated: report.samples >= 20 && report.squaredError / report.samples <= .30,
    }])) };
  const players = playerHistory(rows);
  return { modelMode: 'historical_roster', modelVersion: HISTORICAL_PRICING_VERSION, metricHistory: rows,
    preseasonTeamPriors: Object.fromEntries(inputs.teams.map(team => [team.TeamSubmissionId,
      rosterPrior(inputs.roster.filter(player => player.TeamSubmissionId === team.TeamSubmissionId), players)])), validation };
}

// Invalidate outstanding quotes when a historical import is added, repaired or
// removed. Reads are small metadata queries, including failed/in-progress loads.
export function historicalSourceFingerprint(league) {
  const tables = [ ['MatchIngestionState', 'MatchId,Status,SourceHash,AttemptedAt,LastSuccessAt'],
    ['MatchSourceResponses', 'MatchId,SourceHash,CollectedAt'], ['MatchSourceDetails', 'MatchId,ObservedAtUtc'],
    ['SourceLoadRuns', 'SourceRunId,SourceName,Status,FinishedAtUtc'] ];
  return digest(tables.map(([table, columns]) => [table,
    league.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
      ? league.prepare(`SELECT ${columns} FROM ${table} ORDER BY 1`).all() : []]));
}

export function buildHistoricalPricingInputs(league, inputs, now = new Date()) {
  if (!['LeagueInfo', 'MatchLeague', 'MatchTeam'].every(table =>
    league.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))) return null;
  // Analytics owns a source read transaction for each extracted league. Reject
  // this batch if an importer changes the source between those snapshots.
  const sourceFingerprint = historicalSourceFingerprint(league);
  const source = readPreseasonPreviewHistory(league, { excludeLeagueId: inputs.season.LeagueId, now });
  const changed = sourceFingerprint !== historicalSourceFingerprint(league);
  const result = historicalPricingInputs(inputs, source, now);
  if (changed) result.validation = { ...result.validation, validated: false, reason: 'historical_source_changed' };
  return { ...result, sourceFingerprint };
}
