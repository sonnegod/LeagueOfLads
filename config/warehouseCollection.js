import { IMPORTER_VERSION } from './warehouseIngestion.js';

// A stale curated result needs review, but does not prevent additive enrichment.
export function warehouseResultNotes(db, { leagueId=null }={}) {
  return db.prepare(`SELECT DISTINCT m.MatchId,m.WinnerId,m.TeamRad,m.TeamDire
    FROM MatchTeam m JOIN MatchLeague l ON l.MatchId=m.MatchId
    WHERE (? IS NULL OR l.LeagueId=?) AND (m.WinnerId IS NULL OR m.WinnerId NOT IN (m.TeamRad,m.TeamDire))
    ORDER BY m.MatchId`).all(leagueId,leagueId).map(row=>({
      matchId:row.MatchId,code:'winner_not_recorded_team',winnerId:row.WinnerId,
      teamRad:row.TeamRad,teamDire:row.TeamDire,
      message:'Stored winner is not a recorded team; enrichment is allowed and the stored result is preserved'
    }));
}

// Planning only: IDs come exclusively from curated warehouse membership, including undated games.
export function planWarehouseCollection(db, { leagueId, limit = 25, force = false, repairIncomplete = false, now = Date.now() }) {
  if (!Number.isSafeInteger(leagueId) || leagueId <= 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Choose a league and a batch size between 1 and 500');
  }
  const league = db.prepare('SELECT LeagueId,LeagueName FROM LeagueInfo WHERE LeagueId=?').get(leagueId);
  if (!league) throw new Error('League not found');
  const hasState = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='MatchIngestionState'").get());
  const rows = db.prepare(`SELECT DISTINCT m.MatchId,m.Rehost,m.TeamRad,m.TeamDire,m.WinnerId ${hasState ? ',s.Status,s.ImporterVersion,s.AttemptedAt' : ''}
    ${repairIncomplete ? `,((SELECT COUNT(DISTINCT p.PlayerId) FROM MatchPlayer p WHERE p.MatchId=m.MatchId)<>10
      OR EXISTS(SELECT 1 FROM MatchPlayer p WHERE p.MatchId=m.MatchId AND
        (p.Kills IS NULL OR p.Deaths IS NULL OR p.Assists IS NULL OR p.Networth IS NULL OR p.Lasthits IS NULL
        OR p.HeroDamage IS NULL OR p.GPM IS NULL OR p.XPM IS NULL OR p.Healing IS NULL OR p.TowerDamage IS NULL))) NeedsRepair` : ''}
    FROM MatchLeague l JOIN MatchTeam m ON m.MatchId=l.MatchId
    ${hasState ? 'LEFT JOIN MatchIngestionState s ON s.MatchId=m.MatchId' : ''}
    WHERE l.LeagueId=?
    ORDER BY m.MatchId`).all(leagueId);
  const excludedMatches = rows.flatMap(row => {
    const reason = row.Rehost ? 'remake/rehost' : row.TeamRad === row.TeamDire ? 'identical teams' : null;
    return reason ? [{ matchId: row.MatchId, reason }] : [];
  });
  const excluded = new Set(excludedMatches.map(row => row.matchId));
  const eligible = rows.filter(row => !excluded.has(row.MatchId)).filter(row => force || !row.Status || row.ImporterVersion < IMPORTER_VERSION
    || (repairIncomplete && (row.Status === 'conflict' || row.NeedsRepair))
    || (row.Status !== 'ready' && Date.parse(row.AttemptedAt) < now - 7 * 86400000));
  const ids = eligible.slice(0, limit).map(row => row.MatchId);
  return { league, curatedMatches: rows.length, eligibleMatches: eligible.length,
    excludedMatches, dataQualityNotes:warehouseResultNotes(db,{leagueId}),
    ...(repairIncomplete ? { repairMatchIds: eligible.filter(row => row.NeedsRepair).map(row => row.MatchId) } : {}),
    selectedMatchIds: ids, maximumRequestsThisRun: ids.length, remainingAfterBatch: Math.max(0, eligible.length - ids.length) };
}
