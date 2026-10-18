const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const minuteSample = (player, key, minute) => {
  if (!Array.isArray(player.times) || !Array.isArray(player[key])) return null;
  const index = player.times.findIndex(t => t === minute * 60);
  return index >= 0 ? number(player[key][index]) : null;
};
const sideOf = slot => Number.isInteger(slot) && slot >= 0 && slot <= 4 ? 0
  : Number.isInteger(slot) && slot >= 128 && slot <= 132 ? 1 : null;
const ITEMS = new Set(['blink', 'black_king_bar', 'manta', 'ultimate_scepter', 'aghanims_shard', 'pipe', 'guardian_greaves',
  'mekansm', 'crimson_guard', 'glimmer_cape', 'force_staff', 'hurricane_pike', 'orchid', 'bloodthorn', 'sheepstick',
  'satanic', 'butterfly', 'assault', 'shivas_guard', 'radiance', 'bfury', 'maelstrom', 'mjollnir', 'desolator',
  'silver_edge', 'heart', 'refresher', 'sphere', 'cyclone', 'wind_waker', 'aeon_disk', 'travel_boots']);

export function ensureDraftIntelSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS DraftGodPatches (
    PatchKey TEXT PRIMARY KEY, StartsAt TEXT NOT NULL, Major INTEGER NOT NULL,
    NotesKnown INTEGER NOT NULL DEFAULT 0, ChangesJson TEXT NOT NULL DEFAULT '{}',
    Source TEXT NOT NULL, SyncedAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_DraftGodPatches_Start ON DraftGodPatches(StartsAt);
    CREATE TABLE IF NOT EXISTS DraftGodMetaOverrides (
      PatchKey TEXT NOT NULL REFERENCES DraftGodPatches(PatchKey), HeroId INTEGER NOT NULL DEFAULT 0,
      Transfer REAL NOT NULL CHECK (Transfer BETWEEN 0 AND 1), Note TEXT NOT NULL, UpdatedAt TEXT NOT NULL,
      PRIMARY KEY(PatchKey,HeroId));
    CREATE TABLE IF NOT EXISTS DraftGodHeroProfileVersions (
      HeroId INTEGER NOT NULL, PatchKey TEXT NOT NULL REFERENCES DraftGodPatches(PatchKey),
      RolesJson TEXT NOT NULL, TagsJson TEXT NOT NULL, UpdatedAt TEXT NOT NULL, PRIMARY KEY(HeroId,PatchKey));
    CREATE TABLE IF NOT EXISTS DraftGodMatchTelemetry (
      MatchId INTEGER PRIMARY KEY, StartAt TEXT, PatchId INTEGER, ParseVersion INTEGER,
      SummaryJson TEXT, Status TEXT NOT NULL, CheckedAt TEXT NOT NULL, LastSuccessAt TEXT);
    CREATE INDEX IF NOT EXISTS idx_DraftGodTelemetry_Status ON DraftGodMatchTelemetry(Status,CheckedAt);`);
}

export function normalizeTelemetry(data) {
  if (!Number.isSafeInteger(data?.match_id) || !Array.isArray(data.players) || typeof data.radiant_win !== 'boolean') throw new Error('Invalid OpenDota match payload');
  const startAt = number(data.start_time) === null ? null : new Date(data.start_time * 1000).toISOString();
  const duration = number(data.duration), version = number(data.version);
  const players = data.players.filter(p => Number.isSafeInteger(p.account_id) && p.account_id > 0 && sideOf(p.player_slot) !== null).map(p => {
    const purchases = {};
    for (const row of p.purchase_log || []) if (ITEMS.has(row.key) && number(row.time) !== null && row.time >= 0 && row.time <= duration) {
      purchases[row.key] = purchases[row.key] === undefined ? row.time : Math.min(purchases[row.key], row.time);
    }
    return { id: p.account_id, heroId: p.hero_id, side: sideOf(p.player_slot), lane: number(p.lane_role),
      gold10: duration>=600 ? minuteSample(p, 'gold_t', 10) : null, gold20: duration>=1200 ? minuteSample(p, 'gold_t', 20) : null, xp10: duration>=600 ? minuteSample(p, 'xp_t', 10) : null,
      lh10: duration>=600 ? minuteSample(p, 'lh_t', 10) : null, wards: number(p.obs_placed), sentries: number(p.sen_placed),
      stacks: number(p.camps_stacked), stuns: number(p.stuns), purchases };
  });
  const adv = (key, minute) => duration >= minute * 60 ? number(data[key]?.[minute]) : null;
  const objectives = [];
  for (const row of data.objectives || []) {
    if (number(row.time) === null || row.time < 0 || row.time > duration) continue;
    if (row.type === 'building_kill' && /tower/.test(row.key || '')) {
      const lost = /goodguys/.test(row.key) ? 0 : /badguys/.test(row.key) ? 1 : null;
      let side = sideOf(row.player_slot);
      if (side === null && /npc_dota_creep_goodguys/.test(row.unit || '')) side = 0;
      if (side === null && /npc_dota_creep_badguys/.test(row.unit || '')) side = 1;
      if (side !== null && lost !== null && side !== lost) objectives.push({ type: 'tower', side, time: row.time });
    } else if (row.type === 'CHAT_MESSAGE_ROSHAN_KILL' && [2, 3].includes(row.team)) {
      objectives.push({ type: 'roshan', side: row.team - 2, time: row.time });
    } else if (row.type === 'CHAT_MESSAGE_FIRSTBLOOD' && sideOf(row.player_slot) !== null) {
      objectives.push({ type: 'firstBlood', side: sideOf(row.player_slot), time: row.time });
    }
  }
  const fights = [];
  for (const fight of data.teamfights || []) {
    if (number(fight.end) === null || !Array.isArray(fight.players) || fight.players.length !== data.players.length) continue;
    const deaths = [0, 0];
    fight.players.forEach((p, i) => { const side = sideOf(data.players[i]?.player_slot); if (side !== null) deaths[side] += number(p.deaths) || 0; });
    if (deaths[0] + deaths[1] < 2 || deaths[0] === deaths[1]) continue;
    const winner = deaths[0] < deaths[1] ? 0 : 1;
    fights.push({ time: fight.end, winner, objectiveFollowup: objectives.some(o => o.side === winner && o.type !== 'firstBlood' && o.time >= fight.end && o.time <= fight.end + 120) });
  }
  const timeline = Array.isArray(data.radiant_gold_adv) && data.radiant_gold_adv.some(v => number(v) !== null);
  return { matchId: data.match_id, startAt, patchId: number(data.patch), version, duration,
    radiantWin: data.radiant_win, parsed: version !== null, timeline,
    gold10: adv('radiant_gold_adv', 10), gold20: adv('radiant_gold_adv', 20), xp10: adv('radiant_xp_adv', 10),
    players, objectives, fights };
}

export function ingestDraftTelemetry(db, data) {
  ensureDraftIntelSchema(db);
  const summary = normalizeTelemetry(data), now = new Date().toISOString();
  // The warehouse winner/team corrections remain authoritative. Do not import chat, rank or public MMR.
  db.prepare(`INSERT INTO DraftGodMatchTelemetry (MatchId,StartAt,PatchId,ParseVersion,SummaryJson,Status,CheckedAt,LastSuccessAt)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(MatchId) DO UPDATE SET StartAt=COALESCE(excluded.StartAt,DraftGodMatchTelemetry.StartAt),
    PatchId=COALESCE(excluded.PatchId,DraftGodMatchTelemetry.PatchId),
    ParseVersion=CASE WHEN excluded.Status='partial' AND DraftGodMatchTelemetry.Status='ready' THEN DraftGodMatchTelemetry.ParseVersion ELSE excluded.ParseVersion END,
    SummaryJson=CASE WHEN excluded.Status='partial' AND DraftGodMatchTelemetry.Status='ready'
      THEN DraftGodMatchTelemetry.SummaryJson ELSE excluded.SummaryJson END,
    Status=CASE WHEN excluded.Status='partial' AND DraftGodMatchTelemetry.Status='ready' THEN 'ready' ELSE excluded.Status END,
    CheckedAt=excluded.CheckedAt,LastSuccessAt=excluded.LastSuccessAt`)
    .run(summary.matchId, summary.startAt, summary.patchId, summary.version, JSON.stringify(summary), summary.timeline ? 'ready' : 'partial', now, now);
  return summary;
}
