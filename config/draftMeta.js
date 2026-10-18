import { readFileSync } from 'node:fs';
import { ensureDraftIntelSchema } from './draftTelemetry.js';
import { patchAt, META_POLICY_VERSION } from '../shared/metaPolicy.js';

export function seedDraftPatches(db) {
  ensureDraftIntelSchema(db);
  let rows = [];
  try { rows = JSON.parse(readFileSync(new URL('../data/draftPatches.json', import.meta.url), 'utf8')); } catch { /* A missing calendar stays unknown. */ }
  const insert = db.prepare(`INSERT INTO DraftGodPatches VALUES (@key,@startsAt,@major,@notesKnown,@changes,@source,@syncedAt)
    ON CONFLICT(PatchKey) DO UPDATE SET NotesKnown=excluded.NotesKnown,ChangesJson=excluded.ChangesJson,SyncedAt=excluded.SyncedAt
    WHERE DraftGodPatches.NotesKnown=0 AND excluded.NotesKnown=1`);
  db.transaction(() => { for (const r of rows) insert.run(r); })();
}

export function readDraftMeta(db, asOf) {
  const patches = db.prepare('SELECT * FROM DraftGodPatches WHERE StartsAt <= ? ORDER BY StartsAt').all(asOf)
    .map(r => ({ key: r.PatchKey, startsAt: r.StartsAt, major: Boolean(r.Major), notesKnown: Boolean(r.NotesKnown), heroes: JSON.parse(r.ChangesJson), source: r.Source }));
  const overrides = Object.fromEntries(db.prepare('SELECT * FROM DraftGodMetaOverrides').all()
    .filter(r => patches.some(p => p.key === r.PatchKey)).map(r => [`${r.PatchKey}:${r.HeroId}`, { transfer: r.Transfer, note: r.Note }]));
  const checkedAt=db.prepare('SELECT MAX(SyncedAt) checkedAt FROM DraftGodPatches').get().checkedAt;
  return { policy: META_POLICY_VERSION, asOf, patches, current: patchAt(patches, asOf), overrides, checkedAt };
}

export async function syncDraftPatches(db, { limit = 8, fetcher = fetch } = {}) {
  ensureDraftIntelSchema(db);
  const get = async url => {
    const r = await fetcher(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Patch source returned ${r.status}`);
    return r.json();
  };
  const feed = await get('https://www.dota2.com/datafeed/patchnoteslist?language=english');
  if (!Array.isArray(feed.patches) || !feed.patches.length) throw new Error('Invalid Valve patch calendar');
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO DraftGodPatches VALUES (?,?,?,0,'{}',?,?) ON CONFLICT(PatchKey) DO UPDATE SET StartsAt=excluded.StartsAt,Major=excluded.Major,SyncedAt=excluded.SyncedAt`);
  db.transaction(() => {
    for (const p of feed.patches) if (/^\d+\.\d+[a-z]?$/.test(p.patch_number) && Number.isFinite(p.patch_timestamp)) {
      insert.run(p.patch_number, new Date(p.patch_timestamp * 1000).toISOString(), Number(!/[a-z]$/.test(p.patch_number)),
        `https://www.dota2.com/patches/${p.patch_number}`, now);
    }
  })();
  // Resume a bounded backlog. Keep the notes out of the app; retain only change markers.
  const pending = db.prepare(`SELECT PatchKey FROM DraftGodPatches WHERE NotesKnown=0 AND StartsAt >= '2022-01-01' ORDER BY StartsAt DESC LIMIT ?`).all(limit);
  let enriched = 0;
  for (const row of pending) {
    const details = await get(`https://www.dota2.com/datafeed/patchnotes?version=${encodeURIComponent(row.PatchKey)}&language=english`);
    if (details.success === false || !Array.isArray(details.heroes)) continue;
    const changes = {};
    for (const h of details.heroes) if (Number.isSafeInteger(h.hero_id)) {
      // Text markers are conservative flags, not an automatic measurement of balance impact.
      changes[h.hero_id] = /rework|replaced|new ability|removed ability/i.test(JSON.stringify(h)) ? 'reset' : 'changed';
    }
    db.prepare('UPDATE DraftGodPatches SET NotesKnown=1,ChangesJson=?,SyncedAt=? WHERE PatchKey=?').run(JSON.stringify(changes), now, row.PatchKey);
    enriched++;
  }
  return { patches: feed.patches.length, enriched };
}
