import { readFileSync } from 'node:fs';
import { ensurePatchSchema } from './warehouseSchema.js';
import { patchReportingStart } from '../shared/patchCalendar.js';

export function seedWarehousePatches(db) {
  const rows = JSON.parse(readFileSync(new URL('../data/patchCalendar.json', import.meta.url), 'utf8'));
  db.transaction(() => {
    ensurePatchSchema(db);
    const insert = db.prepare(`INSERT INTO Patches (PatchKey,StartsAt,Major,Source,SyncedAt) VALUES (?,?,?,?,?)
      ON CONFLICT(PatchKey) DO NOTHING`);
    for (const row of rows) insert.run(row.key, patchReportingStart(row.startsAt), row.major, row.source, new Date().toISOString());
  })();
}

export async function syncWarehousePatches(db, { fetcher = fetch, now = new Date().toISOString() } = {}) {
  const response = await fetcher('https://www.dota2.com/datafeed/patchnoteslist?language=english', { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Valve patch feed returned ${response.status}`);
  const feed = await response.json();
  if (!Array.isArray(feed.patches) || !feed.patches.length) throw new Error('Invalid Valve patch calendar');
  return db.transaction(() => {
    ensurePatchSchema(db);
    const insert = db.prepare(`INSERT INTO Patches (PatchKey,StartsAt,Major,Source,SyncedAt) VALUES (?,?,?,?,?)
      ON CONFLICT(PatchKey) DO UPDATE SET StartsAt=excluded.StartsAt,Major=excluded.Major,Source=excluded.Source,SyncedAt=excluded.SyncedAt`);
    let count = 0;
    for (const row of feed.patches) {
      if (!/^\d+\.\d+[a-z]?$/.test(row.patch_number) || !Number.isFinite(row.patch_timestamp)) continue;
      insert.run(row.patch_number, patchReportingStart(row.patch_timestamp * 1000), Number(!/[a-z]$/.test(row.patch_number)),
        `https://www.dota2.com/patches/${row.patch_number}`, now);
      count++;
    }
    if (!count) throw new Error('No valid patches in Valve calendar');
    // A newly discovered/corrected boundary also updates matches already in the warehouse.
    const hasMatches = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='MatchTeam'").get();
    if (hasMatches && db.pragma('table_info(MatchTeam)').some(c => c.name === 'PatchId')) {
      db.exec(`UPDATE MatchTeam SET PatchId=(SELECT p.PatchId FROM Patches p
        WHERE p.StartsAt<=strftime('%Y-%m-%dT%H:%M:%fZ',MatchTeam.StartTimeUtc,'unixepoch') ORDER BY p.StartsAt DESC,p.PatchId DESC LIMIT 1)
        WHERE StartTimeUtc IS NOT NULL`);
    }
    return { patches: count };
  }).immediate();
}
