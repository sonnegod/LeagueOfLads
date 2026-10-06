import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { PLAYER_STATS, REGULAR_PLAYER_MARKETS, averageEligible,
  regularSchedule } from './marketCatalog.js';

// Tied leader markets are voided. This avoids paying multiple full-price
// winning futures or inventing an unannounced dead-heat payout rule.
export function resolveRegularPlayerMarkets({ seasonId, ladsPath, bettingPath } = {}) {
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
    const boundary = lads.prepare(`SELECT GroupEndMatchId FROM LeagueStageBoundaries
      WHERE LeagueId = ?`).get(season.ExternalLeagueId)?.GroupEndMatchId;
    if (!Number.isSafeInteger(boundary) || boundary <= 0) {
      throw new Error('Regular-season group boundary is not final');
    }
    const teams = lads.prepare(`SELECT TeamSubmissionId, GroupId, ExternalTeamId
      FROM SeasonTeams WHERE SeasonId = ?`).all(seasonId);
    if (!teams.length || teams.some(team => !team.GroupId || !team.ExternalTeamId)) {
      throw new Error('Season team mapping is incomplete');
    }
    const byExternal = new Map(teams.map(team => [team.ExternalTeamId, team]));
    if (byExternal.size !== teams.length) throw new Error('Duplicate external team mapping');
    const groups = new Map();
    for (const team of teams) {
      if (!groups.has(team.GroupId)) groups.set(team.GroupId, []);
      groups.get(team.GroupId).push(team);
    }
    const maps = lads.prepare(`SELECT mt.MatchId, mt.TeamRad, mt.TeamDire
      FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
      WHERE ml.LeagueId = ? AND mt.MatchId <= ? AND mt.Rehost = 0`)
      .all(season.ExternalLeagueId, boundary);
    const pairCounts = new Map();
    for (const map of maps) {
      const a = byExternal.get(map.TeamRad);
      const b = byExternal.get(map.TeamDire);
      if (!a || !b || a.GroupId !== b.GroupId || a.TeamSubmissionId === b.TeamSubmissionId) {
        throw new Error(`Unmapped or cross-group regular map ${map.MatchId}`);
      }
      const key = [a.TeamSubmissionId, b.TeamSubmissionId].sort((x, y) => x - y).join(':');
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
    for (const groupTeams of groups.values()) {
      regularSchedule(groupTeams.length);
      for (let i = 0; i < groupTeams.length; i += 1) {
        for (let j = i + 1; j < groupTeams.length; j += 1) {
          const key = [groupTeams[i].TeamSubmissionId, groupTeams[j].TeamSubmissionId]
            .sort((x, y) => x - y).join(':');
          if (pairCounts.get(key) !== 2) throw new Error(`Group pairing ${key} is not complete`);
        }
      }
    }
    const roster = lads.prepare(`SELECT stp.PlayerId, stp.TeamSubmissionId
      FROM SeasonTeamPlayers stp JOIN SeasonTeams st
        ON st.TeamSubmissionId = stp.TeamSubmissionId
      WHERE st.SeasonId = ?`).all(seasonId);
    if (!roster.length || new Set(roster.map(player => player.PlayerId)).size !== roster.length) {
      throw new Error('Season roster is missing or has duplicate players');
    }
    const matches = lads.prepare(`SELECT mp.MatchId, mp.PlayerId, mp.Kills, mp.Deaths,
      mp.Assists, mp.GPM, mp.XPM, mtp.TeamId FROM MatchPlayer mp
      JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
      JOIN MatchTeam mt ON mt.MatchId = mp.MatchId
      LEFT JOIN MatchTeamPlayer mtp ON mtp.MatchId = mp.MatchId AND mtp.PlayerId = mp.PlayerId
      WHERE ml.LeagueId = ? AND mp.MatchId <= ? AND mt.Rehost = 0`)
      .all(season.ExternalLeagueId, boundary);
    const byPlayer = new Map(roster.map(player => [player.PlayerId, []]));
    const externalTeamByPlayer = new Map(roster.map(player => [player.PlayerId,
      teams.find(team => team.TeamSubmissionId === player.TeamSubmissionId).ExternalTeamId]));
    for (const match of matches) {
      if (!byPlayer.has(match.PlayerId)) continue;
      if (!match.TeamId) throw new Error(`Missing team assignment for player ${match.PlayerId}`);
      if (match.TeamId !== externalTeamByPlayer.get(match.PlayerId)) continue;
      if (byPlayer.get(match.PlayerId).some(row => row.MatchId === match.MatchId)) {
        throw new Error(`Duplicate player appearance ${match.PlayerId}/${match.MatchId}`);
      }
      byPlayer.get(match.PlayerId).push(match);
    }
    const teamById = new Map(teams.map(team => [team.TeamSubmissionId, team]));
    const results = [];
    for (const marketDef of REGULAR_PLAYER_MARKETS) {
      const market = betting.prepare(`SELECT id FROM Markets WHERE market_key = ?`)
        .get(`${seasonId}:${marketDef.key}`);
      if (!market) throw new Error(`Missing market ${marketDef.key}`);
      const column = PLAYER_STATS.find(stat => stat.key === marketDef.stat).column;
      const scores = [];
      for (const player of roster) {
        const samples = byPlayer.get(player.PlayerId);
        const team = teamById.get(player.TeamSubmissionId);
        const scheduledMaps = regularSchedule(groups.get(team.GroupId).length).maps;
        if (!samples.length || (marketDef.aggregate === 'average' &&
          !averageEligible(samples.length, scheduledMaps))) continue;
        const values = samples.map(row => row[column]);
        if (values.some(value => !Number.isFinite(value))) {
          throw new Error(`Missing ${column} statistic for player ${player.PlayerId}`);
        }
        const total = values.reduce((sum, value) => sum + value, 0);
        const score = marketDef.aggregate === 'total' ? total
          : marketDef.aggregate === 'average' ? total / samples.length : Math.max(...values);
        scores.push({ playerId: player.PlayerId, score });
      }
      const highest = scores.length ? Math.max(...scores.map(score => score.score)) : null;
      const winners = scores.filter(score => Math.abs(score.score - highest) < 1e-9);
      const winningOutcomeKey = winners.length === 1 ? `player:${winners[0].playerId}` : null;
      if (winningOutcomeKey && !betting.prepare(`SELECT 1 FROM BettingOptions
        WHERE market_id = ? AND outcome_key = ?`).get(market.id, winningOutcomeKey)) {
        throw new Error(`Winning player is missing from market ${marketDef.key}`);
      }
      results.push({ marketId: market.id, marketKey: marketDef.key,
        status: winningOutcomeKey ? 'FINAL' : 'VOID', winningOutcomeKey,
        tiedPlayerIds: winners.length > 1 ? winners.map(winner => winner.playerId) : [],
        resultReference: `league:${season.ExternalLeagueId}:group_end:${boundary}` });
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ seasonId,
      leagueId: season.ExternalLeagueId, boundary, teams, maps, roster, matches }))
      .digest('hex');
    return { seasonId, leagueId: season.ExternalLeagueId, groupEndMatchId: boundary,
      fingerprint, results };
  } finally { betting?.close(); lads.close(); }
}
