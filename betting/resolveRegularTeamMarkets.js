import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

// PlayoffSeeding is the league's authoritative post-tiebreaker decision. It can
// be regenerated, so the CLI requires a fingerprint of this exact preview.
export function resolveRegularTeamMarkets({ seasonId, ladsPath, bettingPath } = {}) {
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
    const season = lads.prepare(`SELECT Status, ExternalLeagueId FROM LeagueSeasons
      WHERE SeasonId = ?`).get(seasonId);
    if (!season || !['active', 'ended'].includes(season.Status) || !season.ExternalLeagueId) {
      throw new Error('Season has not started');
    }
    const boundary = lads.prepare(`SELECT GroupEndMatchId, TieBreakerEndMatchId
      FROM LeagueStageBoundaries WHERE LeagueId = ?`).get(season.ExternalLeagueId);
    if (!Number.isSafeInteger(boundary?.GroupEndMatchId) ||
      !Number.isSafeInteger(boundary?.TieBreakerEndMatchId) ||
      boundary.TieBreakerEndMatchId < boundary.GroupEndMatchId) {
      throw new Error('Regular-season and tiebreaker boundaries must be final');
    }
    const teams = lads.prepare(`SELECT TeamSubmissionId, GroupId, ExternalTeamId
      FROM SeasonTeams WHERE SeasonId = ? ORDER BY TeamSubmissionId`).all(seasonId);
    if (!teams.length || teams.some(team => !team.GroupId || !team.ExternalTeamId)) {
      throw new Error('Season team mapping is incomplete');
    }
    const byExternal = new Map(teams.map(team => [team.ExternalTeamId, team]));
    if (byExternal.size !== teams.length) throw new Error('Duplicate external team mapping');
    const rawSeeds = lads.prepare(`SELECT TeamId, Seed, Bracket FROM PlayoffSeeding
      WHERE LeagueId = ? ORDER BY TeamId, Seed, Bracket`).all(season.ExternalLeagueId);
    if (!rawSeeds.length) throw new Error('Playoff seeding has not been recorded');
    const seeded = new Map();
    for (const seed of rawSeeds) {
      if (!byExternal.has(seed.TeamId) || !Number.isSafeInteger(seed.Seed) || seed.Seed < 1 ||
        !['upper', 'lower'].includes(seed.Bracket)) {
        throw new Error('Playoff seeding includes an unknown team or invalid seed');
      }
      const old = seeded.get(seed.TeamId);
      if (old && (old.Seed !== seed.Seed || old.Bracket !== seed.Bracket)) {
        throw new Error(`Conflicting playoff seeds for team ${seed.TeamId}`);
      }
      seeded.set(seed.TeamId, seed);
    }
    const groups = new Map();
    for (const team of teams) {
      if (!groups.has(team.GroupId)) groups.set(team.GroupId, []);
      groups.get(team.GroupId).push(team);
    }
    const results = [];
    const findMarket = key => {
      const row = betting.prepare('SELECT id FROM Markets WHERE market_key = ?')
        .get(`${seasonId}:${key}`);
      if (!row) throw new Error(`Missing market ${key}`);
      return row.id;
    };
    const checkOption = (marketId, outcomeKey) => {
      if (!betting.prepare(`SELECT 1 FROM BettingOptions WHERE market_id = ? AND outcome_key = ?`)
        .get(marketId, outcomeKey)) throw new Error(`Missing outcome ${outcomeKey}`);
    };
    for (const [groupId, groupTeams] of groups) {
      const first = groupTeams.filter(team => seeded.get(team.ExternalTeamId)?.Seed === 1);
      if (first.length !== 1) throw new Error(`Group ${groupId} has no unique first seed`);
      const key = `regular:group_winner:${groupId}`;
      const marketId = findMarket(key);
      const winningOutcomeKey = `team_submission:${first[0].TeamSubmissionId}`;
      checkOption(marketId, winningOutcomeKey);
      results.push({ marketId, marketKey: key, status: 'FINAL', winningOutcomeKey,
        resultReference: `league:${season.ExternalLeagueId}:final_seeding` });
    }
    for (const team of teams) {
      const key = `regular:playoffs_vs_eliminated:${team.TeamSubmissionId}`;
      const marketId = findMarket(key);
      const winningOutcomeKey = seeded.has(team.ExternalTeamId) ? 'qualify' : 'eliminated';
      checkOption(marketId, winningOutcomeKey);
      results.push({ marketId, marketKey: key, status: 'FINAL', winningOutcomeKey,
        resultReference: `league:${season.ExternalLeagueId}:final_seeding` });
    }
    const finalSeeding = [...seeded.values()].sort((a, b) => a.TeamId - b.TeamId);
    const fingerprint = createHash('sha256').update(JSON.stringify({ seasonId,
      leagueId: season.ExternalLeagueId, boundary, teams, finalSeeding })).digest('hex');
    return { seasonId, leagueId: season.ExternalLeagueId, boundary, finalSeeding,
      fingerprint, results };
  } finally { betting?.close(); lads.close(); }
}
