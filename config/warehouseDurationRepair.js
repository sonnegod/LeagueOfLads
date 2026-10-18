import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const validDuration = value => Number.isSafeInteger(value) && value > 0;

// Read saved responses one at a time. No API calls or changes to existing valid durations.
export function planWarehouseDurationRepair(db, { leagueId = null } = {}) {
  if (leagueId !== null && (!Number.isSafeInteger(leagueId) || leagueId <= 0)) throw new Error('Invalid league ID');
  const rows = db.prepare(`SELECT m.MatchId,m.Duration,r.Encoding,r.SourceHash,r.GameplayData
    FROM MatchTeam m LEFT JOIN MatchSourceResponses r ON r.MatchId=m.MatchId
    WHERE (m.Duration IS NULL OR m.Duration<=0) AND m.Rehost=0 AND m.TeamRad<>m.TeamDire
      AND EXISTS(SELECT 1 FROM MatchLeague l WHERE l.MatchId=m.MatchId AND (? IS NULL OR l.LeagueId=?))
    ORDER BY m.MatchId`).iterate(leagueId, leagueId);
  const candidates = [], problems = [];
  let missing = 0, withoutSource = 0;
  for (const row of rows) {
    missing++;
    if (!row.GameplayData) { withoutSource++; continue; }
    try {
      if (row.Encoding !== 'gzip') throw new Error('Unsupported source encoding');
      const bytes = gunzipSync(row.GameplayData, { maxOutputLength: 64 * 1024 * 1024 });
      if (createHash('sha256').update(bytes).digest('hex') !== row.SourceHash) throw new Error('Source hash mismatch');
      const source = JSON.parse(bytes.toString('utf8'));
      if (source.match_id !== row.MatchId) throw new Error('Source match ID mismatch');
      if (!validDuration(source.duration)) throw new Error('Source has no valid duration');
      candidates.push({ matchId: row.MatchId, previousDuration: row.Duration, duration: source.duration, sourceHash: row.SourceHash });
    } catch (error) { problems.push({ matchId: row.MatchId, error: error.message }); }
  }
  return { leagueId, missing, repairable: candidates.length, withoutSource, problems, candidates };
}

export function applyWarehouseDurationRepair(db, plan) {
  const get = db.prepare(`SELECT m.Duration,r.SourceHash FROM MatchTeam m
    LEFT JOIN MatchSourceResponses r ON r.MatchId=m.MatchId WHERE m.MatchId=?`);
  const update = db.prepare('UPDATE MatchTeam SET Duration=? WHERE MatchId=? AND Duration IS ?');
  return db.transaction(() => {
    const repaired = [], skipped = [];
    for (const candidate of plan.candidates) {
      const current = get.get(candidate.matchId);
      if (!current || current.Duration !== candidate.previousDuration || current.SourceHash !== candidate.sourceHash) {
        skipped.push({ matchId: candidate.matchId, reason: 'Match or saved response changed since preview' });
        continue;
      }
      if (!validDuration(candidate.duration) || validDuration(current.Duration)) throw new Error('Invalid duration repair candidate');
      update.run(candidate.duration, candidate.matchId, candidate.previousDuration);
      repaired.push({ matchId: candidate.matchId, before: candidate.previousDuration, after: candidate.duration });
    }
    return { repaired, skipped };
  }).immediate();
}
