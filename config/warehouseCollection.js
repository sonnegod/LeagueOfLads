import { IMPORTER_VERSION } from './warehouseIngestion.js';

// Planning only: IDs come exclusively from curated warehouse membership, including undated games.
export function planWarehouseCollection(db, { leagueId, limit = 25, force = false, now = Date.now() }) {
  if (!Number.isSafeInteger(leagueId) || leagueId <= 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Choose a league and a batch size between 1 and 500');
  }
  const league = db.prepare('SELECT LeagueId,LeagueName FROM LeagueInfo WHERE LeagueId=?').get(leagueId);
  if (!league) throw new Error('League not found');
  const hasState = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='MatchIngestionState'").get());
  const rows = db.prepare(`SELECT DISTINCT m.MatchId,m.Rehost,m.TeamRad,m.TeamDire,m.WinnerId ${hasState ? ',s.Status,s.ImporterVersion,s.AttemptedAt' : ''}
    FROM MatchLeague l JOIN MatchTeam m ON m.MatchId=l.MatchId
    ${hasState ? 'LEFT JOIN MatchIngestionState s ON s.MatchId=m.MatchId' : ''}
    WHERE l.LeagueId=?
    ORDER BY m.MatchId`).all(leagueId);
  const excludedMatches = rows.flatMap(row => {
    const reason = row.Rehost ? 'remake/rehost' : row.TeamRad === row.TeamDire ? 'identical teams'
      : ![row.TeamRad,row.TeamDire].includes(row.WinnerId) ? 'winner is not one of the recorded teams' : null;
    return reason ? [{ matchId: row.MatchId, reason }] : [];
  });
  const excluded = new Set(excludedMatches.map(row => row.matchId));
  const eligible = rows.filter(row => !excluded.has(row.MatchId)).filter(row => force || !row.Status || row.ImporterVersion < IMPORTER_VERSION
    || (row.Status !== 'ready' && Date.parse(row.AttemptedAt) < now - 7 * 86400000));
  const ids = eligible.slice(0, limit).map(row => row.MatchId);
  return { league, curatedMatches: rows.length, eligibleMatches: eligible.length,
    excludedMatches, selectedMatchIds: ids, maximumRequestsThisRun: ids.length, remainingAfterBatch: Math.max(0, eligible.length - ids.length) };
}
