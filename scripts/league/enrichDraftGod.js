import Database from 'better-sqlite3';
import { ensureDraftIntelSchema, ingestDraftTelemetry } from '../../config/draftTelemetry.js';
const db = new Database(process.argv[2] || 'db/LadsData.db');
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const limit = Math.min(200, Math.max(1, Number(arg('limit') || 20)));
const league = Number(arg('league') || 0), force = process.argv.includes('--force');
const before=arg('before') || '9999-12-31',team=Number(arg('team') || 0);
if (!Number.isInteger(limit) || !Number.isSafeInteger(league) || league < 0) throw new Error('Invalid league / limit');
if(!Number.isFinite(Date.parse(before)) || !Number.isSafeInteger(team) || team<0) throw new Error('Invalid cutoff / team');
try {
  ensureDraftIntelSchema(db);
  const rows = db.prepare(`SELECT DISTINCT ml.MatchId FROM MatchLeague ml JOIN MatchTeam m ON m.MatchId=ml.MatchId
    LEFT JOIN DraftGodMatchTelemetry t ON t.MatchId=ml.MatchId
    WHERE (?=0 OR ml.LeagueId=?) AND (?=0 OR ? IN (m.TeamRad,m.TeamDire)) AND datetime(ml.DatePlayed)<datetime(?)
    AND COALESCE(m.Rehost,0)=0 AND m.WinnerId IN (m.TeamRad,m.TeamDire)
    AND (? OR t.MatchId IS NULL OR (t.Status<>'ready' AND datetime(t.CheckedAt)<datetime('now','-7 days')))
    ORDER BY ml.MatchId DESC LIMIT ?`).all(league, league,team,team,before, Number(force), limit);
  let ready = 0, partial = 0, failed = 0;
  for (const row of rows) {
    try {
      const r = await fetch(`https://api.opendota.com/api/matches/${row.MatchId}`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`OpenDota returned ${r.status}`);
      const data = await r.json();
      if (data.match_id !== row.MatchId) throw new Error('Mismatched match ID');
      const result = ingestDraftTelemetry(db, data); if (result.timeline) ready++; else partial++;
    } catch (e) {
      failed++; console.warn(`Draft telemetry ${row.MatchId}: ${e.message}`);
      db.prepare(`INSERT INTO DraftGodMatchTelemetry(MatchId,Status,CheckedAt) VALUES (?,'error',?)
        ON CONFLICT(MatchId) DO UPDATE SET CheckedAt=excluded.CheckedAt`).run(row.MatchId, new Date().toISOString());
    }
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  console.log(JSON.stringify({ attempted: rows.length, ready, partial, failed }));
} finally { db.close(); }
