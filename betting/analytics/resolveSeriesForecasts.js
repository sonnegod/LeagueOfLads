import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stats = new Map([
  ['kills_total', 'Kills'], ['deaths_total', 'Deaths'],
  ['assists_total', 'Assists'], ['gpm_avg', 'GPM'], ['xpm_avg', 'XPM'],
]);

// A ScheduledSeries row has no direct foreign key to SeriesInfo. The caller must
// explicitly identify the completed SeriesInfo record; this function validates
// the link before returning outcomes. It never touches wallets or market state.
export function resolveSeriesForecasts({ seriesUid, completedSeriesId,
  ladsPath = path.join(root, 'db/LadsData.db'), bettingPath,
} = {}) {
  if (!Number.isSafeInteger(seriesUid) || seriesUid <= 0 ||
      !Number.isSafeInteger(completedSeriesId) || completedSeriesId <= 0) {
    throw new Error('Pass positive scheduled and completed series IDs');
  }
  if (!bettingPath || !path.isAbsolute(bettingPath)) {
    throw new Error('Pass an explicit absolute Betting v2 database path');
  }
  const lads = new Database(ladsPath, { readonly: true, fileMustExist: true });
  let betting;
  try {
    betting = new Database(bettingPath, { readonly: true, fileMustExist: true });
    if (betting.prepare('SELECT version FROM BettingSchemaMeta WHERE id = 1').get()?.version !== 2) {
      throw new Error('Betting database is not v2');
    }
    const scheduled = lads.prepare('SELECT Team1, Team2, Date FROM ScheduledSeries WHERE UID = ?')
      .get(seriesUid);
    const completed = lads.prepare('SELECT Team1, Team2, LeagueId FROM SeriesInfo WHERE SeriesId = ?')
      .get(completedSeriesId);
    if (!scheduled || !completed ||
      new Set([completed.Team1, completed.Team2]).size !== 2 ||
      ![completed.Team1, completed.Team2].every(id => [scheduled.Team1, scheduled.Team2].includes(id))) {
      throw new Error('Completed series does not match the scheduled teams');
    }
    const season = lads.prepare(`SELECT SeasonId FROM LeagueSeasons
      WHERE ExternalLeagueId = ?`).get(completed.LeagueId);
    if (!season) throw new Error('Completed series has no matching season');
    const teams = lads.prepare(`SELECT TeamSubmissionId, ExternalTeamId FROM SeasonTeams
      WHERE SeasonId = ? AND ExternalTeamId IN (?, ?)`).all(
      season.SeasonId, scheduled.Team1, scheduled.Team2);
    if (teams.length !== 2) throw new Error('Completed teams have no unique season submissions');
    const ids = new Map(teams.map(team => [team.ExternalTeamId, team.TeamSubmissionId]));
    const games = lads.prepare(`SELECT mt.MatchId, mt.TeamRad, mt.TeamDire, mt.WinnerId,
      mt.Rehost, ml.LeagueId, ml.DatePlayed FROM SeriesMatch sm
      JOIN MatchTeam mt ON mt.MatchId = sm.MatchId
      JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
      WHERE sm.SeriesId = ? ORDER BY mt.MatchId`).all(completedSeriesId);
    const valid = games.filter(game => !game.Rehost);
    if (valid.length !== 2 || new Set(valid.map(game => game.MatchId)).size !== 2 ||
      valid.some(game => game.LeagueId !== completed.LeagueId ||
        game.WinnerId === null ||
        ![scheduled.Team1, scheduled.Team2].includes(game.WinnerId) ||
        ![game.TeamRad, game.TeamDire].every(id => [scheduled.Team1, scheduled.Team2].includes(id)) ||
        game.TeamRad === game.TeamDire)) {
      throw new Error('Series needs exactly two valid completed maps with the scheduled teams');
    }
    const prefix = `${season.SeasonId}:series:${seriesUid}:`;
    const markets = betting.prepare(`SELECT id, market_key, type FROM Markets
      WHERE season_id = ? AND reference_id = ? AND market_key LIKE ?
      ORDER BY id`).all(season.SeasonId, String(seriesUid), `${prefix}%`);
    if (!markets.length) throw new Error('No draft markets for scheduled series');
    const marketIds = markets.map(market => market.id);
    const placeholders = marketIds.map(() => '?').join(',');
    const options = betting.prepare(`SELECT market_id, outcome_key, line_value
      FROM BettingOptions WHERE market_id IN (${placeholders})`).all(...marketIds);
    const byMarket = new Map();
    for (const option of options) {
      if (!byMarket.has(option.market_id)) byMarket.set(option.market_id, []);
      byMarket.get(option.market_id).push(option);
    }
    const winners = new Map([[scheduled.Team1, 0], [scheduled.Team2, 0]]);
    for (const game of valid) winners.set(game.WinnerId, winners.get(game.WinnerId) + 1);
    const aWins = winners.get(scheduled.Team1);
    const winningSubmission = aWins === 2 ? ids.get(scheduled.Team1)
      : aWins === 0 ? ids.get(scheduled.Team2) : null;
    const matchIds = valid.map(game => game.MatchId);
    const playerRows = lads.prepare(`SELECT mp.MatchId, mp.PlayerId, mp.Kills, mp.Deaths,
      mp.Assists, mp.GPM, mp.XPM FROM MatchPlayer mp
      WHERE mp.MatchId IN (?, ?)`).all(...matchIds);
    const byPlayer = new Map();
    for (const row of playerRows) {
      if (!byPlayer.has(row.PlayerId)) byPlayer.set(row.PlayerId, []);
      byPlayer.get(row.PlayerId).push(row);
    }
    const results = [];
    for (const market of markets) {
      const choices = byMarket.get(market.id) || [];
      const suffix = market.market_key.slice(prefix.length);
      let status = 'FINAL';
      let outcomeKey;
      if (suffix === 'exact_score') {
        outcomeKey = winningSubmission === null ? 'draw:1-1'
          : `team_submission:${winningSubmission}:2-0`;
      } else {
        const match = /^player:(\d+):(kills_total|deaths_total|assists_total|gpm_avg|xpm_avg)$/.exec(suffix);
        if (!match) throw new Error(`Unsupported series market ${market.market_key}`);
        const rows = byPlayer.get(Number(match[1])) || [];
        const column = stats.get(match[2]);
        if (!rows.length || rows.some(row => !Number.isFinite(row[column]))) status = 'VOID';
        else {
          const value = rows.reduce((sum, row) => sum + row[column], 0) /
            (match[2].endsWith('_avg') ? rows.length : 1);
          const line = choices[0]?.line_value;
          if (!Number.isFinite(line) || choices.some(choice => choice.line_value !== line)) {
            throw new Error(`Invalid prop line for ${market.market_key}`);
          }
          if (value === line) status = 'VOID';
          else outcomeKey = value > line ? 'over' : 'under';
        }
      }
      if (status === 'FINAL' && !choices.some(choice => choice.outcome_key === outcomeKey)) {
        throw new Error(`Missing winning option for ${market.market_key}`);
      }
      results.push({ marketId: market.id, marketKey: market.market_key,
        status, winningOutcomeKey: outcomeKey || null,
        resultReference: `series_info:${completedSeriesId}`, matchIds });
    }
    return { seasonId: season.SeasonId, seriesUid, completedSeriesId,
      scheduledDate: scheduled.Date,
      playedDates: valid.map(game => game.DatePlayed), results };
  } finally { betting?.close(); lads.close(); }
}
