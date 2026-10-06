import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { PLAYER_STATS, PLAYOFF_PLAYER_MARKETS, averageEligible } from './marketCatalog.js';

function keyFor(a, b) { return [a, b].sort((x, y) => x - y).join(':'); }

export function resolvePlayoffPlayerMarkets({ seasonId, ladsPath, bettingPath } = {}) {
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
    const season = lads.prepare(`SELECT Status, ExternalLeagueId, ChampionTeamId
      FROM LeagueSeasons WHERE SeasonId = ?`).get(seasonId);
    if (season?.Status !== 'ended' || !season.ExternalLeagueId || !season.ChampionTeamId) {
      throw new Error('Playoff player markets require a final season champion');
    }
    const end = lads.prepare(`SELECT TieBreakerEndMatchId FROM LeagueStageBoundaries
      WHERE LeagueId = ?`).get(season.ExternalLeagueId)?.TieBreakerEndMatchId;
    if (!Number.isSafeInteger(end) || end <= 0) throw new Error('Playoff boundary is missing');
    const bracketJson = lads.prepare(`SELECT PlayoffStructure FROM PlayoffBracket
      WHERE LeagueId = ?`).get(season.ExternalLeagueId)?.PlayoffStructure;
    let bracket;
    try { bracket = JSON.parse(bracketJson); }
    catch { throw new Error('Final playoff bracket is missing or invalid'); }
    const nodes = [...(bracket.upperBracket || []).flatMap(round => round.matches || []),
      ...(bracket.lowerBracket || []).flatMap(round => round.matches || []),
      ...(bracket.grandFinals || [])];
    if (!nodes.length || bracket.grandFinals?.length !== 1) {
      throw new Error('Final playoff bracket is incomplete');
    }
    const byNodeId = new Map(nodes.map(node => [node.id, node]));
    if (byNodeId.size !== nodes.length) throw new Error('Final playoff bracket has duplicate match IDs');
    const expected = new Map();
    const teamMaps = new Map();
    for (const node of nodes) {
      const a = Number(node.team1Id);
      const b = Number(node.team2Id);
      const aWins = Number(node.team1Score);
      const bWins = Number(node.team2Score);
      const required = node.bracket === 'grand' ? 3 : 2;
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a === b ||
        !Number.isSafeInteger(aWins) || !Number.isSafeInteger(bWins) ||
        Math.max(aWins, bWins) !== required || Math.min(aWins, bWins) >= required) {
        throw new Error(`Final bracket match ${node.id || '?'} has no valid result`);
      }
      const pair = keyFor(a, b);
      if (!expected.has(pair)) expected.set(pair, { maps: 0, wins: new Map() });
      const entry = expected.get(pair);
      entry.maps += aWins + bWins;
      entry.wins.set(a, (entry.wins.get(a) || 0) + aWins);
      entry.wins.set(b, (entry.wins.get(b) || 0) + bWins);
      teamMaps.set(a, (teamMaps.get(a) || 0) + aWins + bWins);
      teamMaps.set(b, (teamMaps.get(b) || 0) + aWins + bWins);
      const winner = aWins > bWins ? a : b;
      const loser = winner === a ? b : a;
      if (node.bracket !== 'grand') {
        const next = byNodeId.get(node.winnerTo);
        if (!next || ![1, 2].includes(node.winnerToSlot) ||
          Number(next[`team${node.winnerToSlot}Id`]) !== winner) {
          throw new Error(`Winner route in final bracket ${node.id} is inconsistent`);
        }
        if (node.loserTo && Number(byNodeId.get(node.loserTo)?.team2Id) !== loser) {
          throw new Error(`Loser route in final bracket ${node.id} is inconsistent`);
        }
      }
    }
    const final = bracket.grandFinals[0];
    const bracketChampion = Number(final.team1Score) > Number(final.team2Score)
      ? Number(final.team1Id) : Number(final.team2Id);
    if (bracketChampion !== season.ChampionTeamId) {
      throw new Error('Saved playoff bracket champion disagrees with final season champion');
    }
    const maps = lads.prepare(`SELECT mt.MatchId, mt.TeamRad, mt.TeamDire, mt.WinnerId
      FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
      WHERE ml.LeagueId = ? AND mt.MatchId > ? AND mt.Rehost = 0
      ORDER BY mt.MatchId`).all(season.ExternalLeagueId, end);
    const observed = new Map();
    for (const map of maps) {
      const pair = keyFor(map.TeamRad, map.TeamDire);
      if (!expected.has(pair) || ![map.TeamRad, map.TeamDire].includes(map.WinnerId)) {
        throw new Error(`Unexpected playoff map ${map.MatchId}`);
      }
      if (!observed.has(pair)) observed.set(pair, { maps: 0, wins: new Map() });
      const entry = observed.get(pair);
      entry.maps += 1;
      entry.wins.set(map.WinnerId, (entry.wins.get(map.WinnerId) || 0) + 1);
    }
    for (const [pair, want] of expected) {
      const actual = observed.get(pair);
      if (!actual || actual.maps !== want.maps || [...want.wins]
        .some(([team, n]) => (actual.wins.get(team) || 0) !== n)) {
        throw new Error(`Playoff maps for pairing ${pair} do not match final bracket`);
      }
    }
    const teams = lads.prepare(`SELECT TeamSubmissionId, ExternalTeamId FROM SeasonTeams
      WHERE SeasonId = ?`).all(seasonId).filter(team => teamMaps.has(team.ExternalTeamId));
    if (teams.length !== teamMaps.size) throw new Error('Playoff teams do not map to season rosters');
    const players = lads.prepare(`SELECT p.PlayerId, p.TeamSubmissionId FROM SeasonTeamPlayers p
      JOIN SeasonTeams st ON st.TeamSubmissionId = p.TeamSubmissionId
      WHERE st.SeasonId = ?`).all(seasonId).filter(player =>
      teams.some(team => team.TeamSubmissionId === player.TeamSubmissionId));
    if (!players.length || new Set(players.map(player => player.PlayerId)).size !== players.length) {
      throw new Error('Playoff season roster is missing or duplicated');
    }
    const teamBySubmission = new Map(teams.map(team => [team.TeamSubmissionId, team]));
    const playerTeam = new Map(players.map(player => [player.PlayerId,
      teamBySubmission.get(player.TeamSubmissionId).ExternalTeamId]));
    const rows = lads.prepare(`SELECT mp.MatchId, mp.PlayerId, mp.Kills, mp.Deaths,
      mp.Assists, mp.GPM, mp.XPM, mtp.TeamId FROM MatchPlayer mp
      JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
      JOIN MatchTeam mt ON mt.MatchId = mp.MatchId
      LEFT JOIN MatchTeamPlayer mtp ON mtp.MatchId = mp.MatchId AND mtp.PlayerId = mp.PlayerId
      WHERE ml.LeagueId = ? AND mp.MatchId > ? AND mt.Rehost = 0`)
      .all(season.ExternalLeagueId, end);
    const byPlayer = new Map(players.map(player => [player.PlayerId, []]));
    for (const row of rows) {
      if (!byPlayer.has(row.PlayerId)) continue;
      if (!row.TeamId) throw new Error(`Missing team assignment for player ${row.PlayerId}`);
      if (row.TeamId !== playerTeam.get(row.PlayerId)) continue;
      if (byPlayer.get(row.PlayerId).some(sample => sample.MatchId === row.MatchId)) {
        throw new Error(`Duplicate playoff appearance for player ${row.PlayerId}`);
      }
      byPlayer.get(row.PlayerId).push(row);
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ seasonId,
      leagueId: season.ExternalLeagueId, end, nodes, maps, rows, teams, players }))
      .digest('hex');
    const results = [];
    for (const def of PLAYOFF_PLAYER_MARKETS) {
      const market = betting.prepare('SELECT id FROM Markets WHERE market_key = ?')
        .get(`${seasonId}:${def.key}`);
      if (!market) throw new Error(`Missing playoff market ${def.key}`);
      const column = PLAYER_STATS.find(stat => stat.key === def.stat).column;
      const scores = [];
      for (const player of players) {
        const samples = byPlayer.get(player.PlayerId);
        const scheduled = teamMaps.get(playerTeam.get(player.PlayerId));
        if (!samples.length || (def.aggregate === 'average' &&
          !averageEligible(samples.length, scheduled))) continue;
        const values = samples.map(row => row[column]);
        if (values.some(value => !Number.isFinite(value))) {
          throw new Error(`Missing playoff ${column} for player ${player.PlayerId}`);
        }
        const total = values.reduce((sum, value) => sum + value, 0);
        scores.push({ playerId: player.PlayerId, score: def.aggregate === 'total' ? total
          : def.aggregate === 'average' ? total / samples.length : Math.max(...values) });
      }
      const highest = scores.length ? Math.max(...scores.map(score => score.score)) : null;
      const tied = scores.filter(score => Math.abs(score.score - highest) < 1e-9);
      const winningOutcomeKey = tied.length === 1 ? `player:${tied[0].playerId}` : null;
      if (winningOutcomeKey && !betting.prepare(`SELECT 1 FROM BettingOptions
        WHERE market_id = ? AND outcome_key = ?`).get(market.id, winningOutcomeKey)) {
        throw new Error(`Playoff winner is missing from market ${def.key}`);
      }
      results.push({ marketId: market.id, marketKey: def.key,
        status: winningOutcomeKey ? 'FINAL' : 'VOID', winningOutcomeKey,
        tiedPlayerIds: tied.length > 1 ? tied.map(player => player.playerId) : [],
        resultReference: `league:${season.ExternalLeagueId}:playoffs:${fingerprint}` });
    }
    return { seasonId, leagueId: season.ExternalLeagueId, fingerprint,
      playoffMaps: maps.length, results };
  } finally { betting?.close(); lads.close(); }
}
