import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { ensureWarehouseSchema, MATCH_PLAYER_ADDITIONS } from './warehouseSchema.js';
import { seedWarehousePatches } from './warehousePatches.js';
import { isSqliteBusy } from './warehouseConnection.js';

export const IMPORTER_VERSION = 1;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const integer = n => Number.isSafeInteger(n);
const positive = n => integer(n) && n > 0;
const scalar = n => finite(n) ? n : null;
const sideOf = n => integer(n) && n >= 0 && n <= 4 ? 0 : integer(n) && n >= 128 && n <= 132 ? 1 : null;
const hash = value => createHash('sha256').update(value).digest('hex');
export const PLAYER_FIELDS = {
  PlayerSlot: 'player_slot', Denies: 'denies', FinalLevel: 'level', LaneRole: 'lane_role', IsRoaming: 'is_roaming',
  ObserversPlaced: 'obs_placed', SentriesPlaced: 'sen_placed', ObserversKilled: 'observer_kills', SentriesKilled: 'sentry_kills',
  CampsStacked: 'camps_stacked', StunSeconds: 'stuns', NeutralKills: 'neutral_kills', AncientKills: 'ancient_kills',
  TowerKills: 'tower_kills', RoshanKills: 'roshan_kills', CourierKills: 'courier_kills'
};
const PLAYER_ARCHIVE_FIELDS = ['account_id', 'hero_id', ...Object.values(PLAYER_FIELDS), 'times', 'gold_t', 'xp_t', 'lh_t',
  'kills', 'deaths', 'assists', 'net_worth', 'last_hits', 'gold_per_min', 'xp_per_min', 'hero_damage', 'hero_healing',
  'tower_damage', 'gold', 'gold_spent', 'total_gold', 'total_xp', 'item_0', 'item_1', 'item_2', 'item_3', 'item_4',
  'item_5', 'backpack_0', 'backpack_1', 'backpack_2', 'item_neutral',
  'kills_log', 'deaths_log', 'purchase_log', 'buyback_log', 'obs_log', 'sen_log', 'obs_left_log', 'sen_left_log',
  'runes_log', 'ability_upgrades_arr', 'item_uses', 'ability_uses', 'damage_inflictor', 'damage_inflictor_received',
  'damage', 'damage_taken', 'killed', 'killed_by', 'neutral_item_history'];
const MATCH_ARCHIVE_FIELDS = ['match_id', 'start_time', 'duration', 'version', 'radiant_win', 'radiant_team_id',
  'dire_team_id', 'radiant_score', 'dire_score', 'first_blood_time', 'radiant_gold_adv', 'radiant_xp_adv',
  'objectives', 'teamfights', 'picks_bans', 'draft_timings', 'tower_status_radiant', 'tower_status_dire',
  'barracks_status_radiant', 'barracks_status_dire'];
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined && obj[k] !== null).map(k => [k, obj[k]]));
const initialized = new WeakSet();

export function initializeWarehouse(db) {
  if (!initialized.has(db)) {
    ensureWarehouseSchema(db);
    seedWarehousePatches(db);
    initialized.add(db);
  }
}

// Explicit allowlist: no chat, profiles, public-match scouting, ranks or MMR.
export function gameplaySnapshot(data) {
  const result = { ...pick(data, MATCH_ARCHIVE_FIELDS), players: data.players.map(p => pick(p, PLAYER_ARCHIVE_FIELDS)) };
  for (const key of ['start_time', 'duration', 'version', 'radiant_score', 'dire_score', 'first_blood_time']) {
    if (!integer(result[key]) || (key !== 'first_blood_time' && result[key] < 0)) delete result[key];
  }
  for (const player of result.players) {
    for (const [column, field] of Object.entries(PLAYER_FIELDS)) {
      if (column === 'IsRoaming') {
        if (typeof player[field] !== 'boolean') delete player[field];
      } else if (!finite(player[field]) || player[field] < 0 || (column !== 'StunSeconds' && !integer(player[field]))) delete player[field];
    }
  }
  return result;
}

export function readGameplaySnapshot(db, matchId) {
  const row = db.prepare('SELECT GameplayData FROM MatchSourceResponses WHERE MatchId=?').get(matchId);
  return row ? JSON.parse(gunzipSync(row.GameplayData).toString('utf8')) : null;
}

function validEventArray(value, kind) {
  if (!Array.isArray(value)) return false;
  if (kind === 'purchase_log') return value.every(e => integer(e?.time) && typeof e.key === 'string' && e.key.length > 0);
  if (kind === 'objectives') return value.every(e => integer(e?.time) && typeof e.type === 'string');
  if (kind === 'teamfights') return value.every(e => integer(e?.start) && integer(e?.end) && e.end >= e.start
    && Array.isArray(e.players) && e.players.length === 10 && e.players.every(p => p && typeof p === 'object'));
  return true;
}

function mergeSamples(oldTimes, oldValues, newTimes, newValues) {
  const rows = new Map();
  const add = (times, values) => {
    if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length) return;
    times.forEach((t, i) => { if (integer(t) && finite(values[i])) rows.set(t, values[i]); });
  };
  add(oldTimes, oldValues); add(newTimes, newValues);
  return rows;
}

function mergeGameplay(previous, incoming, issues) {
  const merged = { ...previous, ...incoming };
  const parsed = finite(incoming.version) && (!finite(previous?.version) || incoming.version >= previous.version);
  if (finite(previous?.version) && !parsed) merged.version = previous.version;
  for (const key of ['radiant_gold_adv', 'radiant_xp_adv']) {
    const next = incoming[key];
    const valid = Array.isArray(next) && next.every(v => v === null || finite(v));
    if (next !== undefined && !valid) issues.push(`Invalid ${key}; retained prior samples`);
    const samples = mergeSamples(previous?.[key]?.map((_, i) => i), previous?.[key],
      valid ? next.map((_, i) => i) : null, next);
    if (samples.size) merged[key] = Array.from({ length: Math.max(...samples.keys()) + 1 }, (_, i) => samples.get(i) ?? null);
    else delete merged[key];
  }
  for (const key of ['objectives', 'teamfights']) {
    if (validEventArray(incoming[key], key) && (parsed || !Array.isArray(previous?.[key]))) merged[key] = incoming[key];
    else {
      if (incoming[key] !== undefined && !validEventArray(incoming[key], key)) issues.push(`Invalid ${key}; retained prior section`);
      if (Array.isArray(previous?.[key])) merged[key] = previous[key]; else delete merged[key];
    }
  }
  const oldPlayers = new Map((previous?.players || []).map(p => [p.account_id, p]));
  merged.players = incoming.players.map(next => {
    const old = oldPlayers.get(next.account_id) || {}, player = { ...old, ...next };
    const metrics = ['gold_t', 'xp_t', 'lh_t'].map(key => {
      if (next[key] !== undefined && (!Array.isArray(next.times) || !Array.isArray(next[key])
        || next.times.length !== next[key].length || !next.times.every(integer) || !next[key].every(v => v === null || finite(v)))) {
        issues.push(`Invalid ${key} for ${next.account_id}; retained prior samples`);
        return [key, mergeSamples(old.times, old[key], null, null)];
      }
      return [key, mergeSamples(old.times, old[key], next.times, next[key])];
    });
    const times = [...new Set(metrics.flatMap(([, rows]) => [...rows.keys()]))].sort((a, b) => a - b);
    if (times.length) player.times = times; else delete player.times;
    for (const [key, rows] of metrics) {
      if (rows.size) player[key] = times.map(t => rows.get(t) ?? null); else delete player[key];
    }
    if (validEventArray(next.purchase_log, 'purchase_log') && (parsed || !Array.isArray(old.purchase_log))) player.purchase_log = next.purchase_log;
    else {
      if (next.purchase_log !== undefined && !validEventArray(next.purchase_log, 'purchase_log')) issues.push(`Invalid purchase_log for ${next.account_id}; retained prior section`);
      if (Array.isArray(old.purchase_log)) player.purchase_log = old.purchase_log; else delete player.purchase_log;
    }
    for (const key of ['kills_log','deaths_log','buyback_log','obs_log','sen_log','obs_left_log','sen_left_log',
      'runes_log','ability_upgrades_arr','neutral_item_history']) {
      if (Array.isArray(next[key]) && (parsed || !Array.isArray(old[key]))) player[key] = next[key];
      else if (Array.isArray(old[key])) player[key] = old[key];
      else delete player[key];
    }
    return player;
  });
  // Fights use source array positions; retain their original ordering when retaining a previous fight section.
  if (merged.teamfights === previous?.teamfights && previous?.players) {
    const order = new Map(previous.players.map((p, i) => [p.account_id, i]));
    merged.players.sort((a, b) => order.get(a.account_id) - order.get(b.account_id));
  }
  return merged;
}

function validateIdentity(db, data, expectedMatchId) {
  if (!positive(expectedMatchId) || data?.match_id !== expectedMatchId) throw new Error('Mismatched or invalid match ID');
  const match = db.prepare('SELECT * FROM MatchTeam WHERE MatchId=?').get(expectedMatchId);
  if (!match || !db.prepare('SELECT 1 FROM MatchLeague WHERE MatchId=?').get(expectedMatchId)) {
    throw new Error('Match is not in the curated warehouse');
  }
  if (!Array.isArray(data.players) || data.players.length !== 10 || typeof data.radiant_win !== 'boolean') {
    throw new Error('Expected a completed match with ten identifiable players');
  }
  const accounts = new Set(), slots = new Set(), problems = [];
  for (const p of data.players) {
    if (!positive(p?.account_id) || !positive(p.hero_id) || sideOf(p.player_slot) === null
      || accounts.has(p.account_id) || slots.has(p.player_slot)) throw new Error('Missing or duplicate account, hero or player slot');
    accounts.add(p.account_id); slots.add(p.player_slot);
    const rows = db.prepare('SELECT DISTINCT HeroId FROM MatchPlayer WHERE MatchId=? AND PlayerId=?').all(expectedMatchId, p.account_id);
    if (rows.length !== 1 || rows[0].HeroId !== p.hero_id) problems.push(`Player/hero mismatch: ${p.account_id}`);
    // Teams can play under substitute IDs, and historic memberships can retain
    // those IDs after an admin correction. Match/player identity is sufficient
    // for additive enrichment; never rewrite curated teams or memberships here.
  }
  const stored = db.prepare('SELECT DISTINCT PlayerId FROM MatchPlayer WHERE MatchId=?').all(expectedMatchId);
  if (stored.length !== 10 || stored.some(p => !accounts.has(p.PlayerId))) problems.push('Existing roster of match participants differs');
  if (problems.length) throw Object.assign(new Error('Source conflicts with curated match participants'), { issues: problems, conflict: true });
  return match;
}

function sectionsFor(data) {
  const metricPlayers = key => data.players.filter(p => Array.isArray(p[key]) && p[key].some(finite)).length;
  return {
    players: data.players.length,
    playerTimeline: { gold: metricPlayers('gold_t'), xp: metricPlayers('xp_t'), lastHits: metricPlayers('lh_t') },
    teamTimeline: { gold: data.radiant_gold_adv?.filter(finite).length || 0, xp: data.radiant_xp_adv?.filter(finite).length || 0 },
    purchases: { players: data.players.filter(p => Array.isArray(p.purchase_log)).length,
      events: data.players.reduce((n, p) => n + (p.purchase_log?.length || 0), 0) },
    objectives: { available: Array.isArray(data.objectives), events: data.objectives?.length || 0 },
    fights: { available: Array.isArray(data.teamfights), events: data.teamfights?.length || 0 }
  };
}

function reportCuratedDifferences(db, data, match, issues) {
  // Raw team IDs are retained in the gameplay snapshot as provenance. Differences
  // from curated IDs are expected when a league team used a substitute team ID.
  for (const [field, column] of [['duration','Duration']]) {
    if (finite(data[field]) && match[column] !== null && data[field] !== match[column]) {
      issues.push(`Source ${field}=${data[field]} differs from curated ${column}=${match[column]}`);
    }
  }
  if ([match.TeamRad,match.TeamDire].includes(match.WinnerId) && data.radiant_win !== (match.WinnerId === match.TeamRad)) {
    issues.push('Source winner differs from the curated winner; preserved the curated result');
  }
  const fields = { Kills:'kills', Deaths:'deaths', Assists:'assists', Networth:'net_worth', Lasthits:'last_hits',
    HeroDamage:'hero_damage', GPM:'gold_per_min', XPM:'xp_per_min', Healing:'hero_healing', TowerDamage:'tower_damage' };
  for (const p of data.players) {
    const stored = db.prepare('SELECT * FROM MatchPlayer WHERE MatchId=? AND PlayerId=?').get(data.match_id,p.account_id);
    for (const [column, field] of Object.entries(fields)) {
      if (finite(p[field]) && stored[column] !== null && p[field] !== stored[column]) {
        issues.push(`Player ${p.account_id}: source ${field}=${p[field]} differs from curated ${column}=${stored[column]}`);
      }
    }
  }
}

function writeDetails(db, data) {
  const id = data.match_id;
  const updates = Object.keys(MATCH_PLAYER_ADDITIONS);
  const update = db.prepare(`UPDATE MatchPlayer SET ${updates.map(k => `${k}=COALESCE(@${k},${k})`).join(',')}
    WHERE MatchId=@MatchId AND PlayerId=@PlayerId`);
  const timeline = db.prepare(`INSERT INTO MatchPlayerTimeline VALUES (@MatchId,@PlayerId,@TimeSeconds,@Gold,@Experience,@LastHits)
    ON CONFLICT(MatchId,PlayerId,TimeSeconds) DO UPDATE SET Gold=COALESCE(excluded.Gold,Gold),
    Experience=COALESCE(excluded.Experience,Experience),LastHits=COALESCE(excluded.LastHits,LastHits)`);
  const purchase = db.prepare('INSERT INTO MatchPlayerPurchases VALUES (?,?,?,?,?)');
  for (const p of data.players) {
    update.run({ MatchId: id, PlayerId: p.account_id, ...Object.fromEntries(updates.map(k => [k,
      k === 'IsRoaming' ? typeof p.is_roaming === 'boolean' ? Number(p.is_roaming) : null : scalar(p[PLAYER_FIELDS[k]])])) });
    (p.times || []).forEach((t, i) => timeline.run({ MatchId: id, PlayerId: p.account_id, TimeSeconds: t,
      Gold: scalar(p.gold_t?.[i]), Experience: scalar(p.xp_t?.[i]), LastHits: scalar(p.lh_t?.[i]) }));
    if (Array.isArray(p.purchase_log)) {
      db.prepare('DELETE FROM MatchPlayerPurchases WHERE MatchId=? AND PlayerId=?').run(id, p.account_id);
      p.purchase_log.forEach((e, i) => purchase.run(id, p.account_id, i, e.time, e.key));
    }
  }
  const team = db.prepare(`INSERT INTO MatchTeamTimeline VALUES (?,?,?,?) ON CONFLICT(MatchId,TimeSeconds)
    DO UPDATE SET RadiantGoldAdvantage=COALESCE(excluded.RadiantGoldAdvantage,RadiantGoldAdvantage),
    RadiantXpAdvantage=COALESCE(excluded.RadiantXpAdvantage,RadiantXpAdvantage)`);
  const count = Math.max(data.radiant_gold_adv?.length || 0, data.radiant_xp_adv?.length || 0);
  for (let i = 0; i < count; i++) team.run(id, i * 60, scalar(data.radiant_gold_adv?.[i]), scalar(data.radiant_xp_adv?.[i]));
  const bySlot = new Map(data.players.map(p => [p.player_slot, p.account_id]));
  if (Array.isArray(data.objectives)) {
    db.prepare('DELETE FROM MatchObjectives WHERE MatchId=?').run(id);
    const insert = db.prepare('INSERT INTO MatchObjectives VALUES (?,?,?,?,?,?,?,?,?)');
    data.objectives.forEach((e, i) => insert.run(id, i, e.time, e.type, bySlot.get(e.player_slot) ?? null,
      scalar(e.player_slot), sideOf(e.player_slot) ?? ([2, 3].includes(e.team) ? e.team - 2 : null),
      typeof e.key === 'string' ? e.key : null, JSON.stringify(e)));
  }
  if (Array.isArray(data.teamfights)) {
    db.prepare('DELETE FROM MatchTeamfightPlayers WHERE MatchId=?').run(id);
    db.prepare('DELETE FROM MatchTeamfights WHERE MatchId=?').run(id);
    const fight = db.prepare('INSERT INTO MatchTeamfights VALUES (?,?,?,?,?)');
    const player = db.prepare('INSERT INTO MatchTeamfightPlayers VALUES (?,?,?,?,?,?,?,?,?)');
    data.teamfights.forEach((f, i) => {
      const { players, ...details } = f;
      fight.run(id, i, scalar(f.start), scalar(f.end), JSON.stringify(details));
      players.forEach((p, j) => player.run(id, i, data.players[j].account_id, data.players[j].player_slot,
        scalar(p.deaths), scalar(p.damage), scalar(p.gold_delta), scalar(p.xp_delta), JSON.stringify(p)));
    });
  }
}

export function recordWarehouseFailure(db, matchId, error, now = new Date().toISOString()) {
  if (!positive(matchId) || !db.prepare('SELECT 1 FROM MatchTeam WHERE MatchId=?').get(matchId)) return;
  db.prepare(`INSERT INTO MatchIngestionState (MatchId,Status,ImporterVersion,AttemptedAt,IssuesJson,Error)
    VALUES (?,?,?,?,?,?) ON CONFLICT(MatchId) DO UPDATE SET Status=excluded.Status,
    ImporterVersion=excluded.ImporterVersion,AttemptedAt=excluded.AttemptedAt,IssuesJson=excluded.IssuesJson,Error=excluded.Error`)
    .run(matchId, error.conflict ? 'conflict' : 'error', IMPORTER_VERSION, now, JSON.stringify(error.issues || []), error.message);
}

export function ingestWarehouseMatch(db, data, { expectedMatchId = data?.match_id, now = new Date().toISOString() } = {}) {
  initializeWarehouse(db);
  try {
    const match = validateIdentity(db, data, expectedMatchId);
    const incoming = gameplaySnapshot(data), issues = [];
    reportCuratedDifferences(db, data, match, issues);
    const merged = mergeGameplay(readGameplaySnapshot(db, expectedMatchId), incoming, issues);
    const sections = sectionsFor(merged);
    const ready = finite(merged.version) && positive(merged.start_time) && Object.values(sections.playerTimeline).every(n => n === 10)
      && sections.teamTimeline.gold > 0 && sections.teamTimeline.xp > 0 && sections.purchases.players === 10
      && sections.objectives.available && sections.fights.available;
    const payload = JSON.stringify(merged), sourceHash = hash(payload), compressed = gzipSync(payload);
    return db.transaction(() => {
      // Recheck inside the write transaction: an admin may have changed/deleted it during normalization.
      validateIdentity(db, data, expectedMatchId);
      const start = positive(merged.start_time) ? merged.start_time : null;
      const patch = start === null ? null : db.prepare('SELECT PatchId FROM Patches WHERE StartsAt<=? ORDER BY StartsAt DESC,PatchId DESC LIMIT 1')
        .get(new Date(start * 1000).toISOString())?.PatchId ?? null;
      db.prepare(`UPDATE MatchTeam SET StartTimeUtc=COALESCE(?,StartTimeUtc),PatchId=COALESCE(?,PatchId),
        RadiantScore=COALESCE(?,RadiantScore),DireScore=COALESCE(?,DireScore),FirstBloodTime=COALESCE(?,FirstBloodTime) WHERE MatchId=?`)
        .run(start, patch, scalar(merged.radiant_score), scalar(merged.dire_score), scalar(merged.first_blood_time), expectedMatchId);
      writeDetails(db, merged);
      db.prepare(`INSERT INTO MatchSourceResponses VALUES (?,'gzip',?,?,?) ON CONFLICT(MatchId) DO UPDATE SET
        SourceHash=excluded.SourceHash,GameplayData=excluded.GameplayData,CollectedAt=excluded.CollectedAt`)
        .run(expectedMatchId, sourceHash, compressed, now);
      db.prepare(`INSERT INTO MatchIngestionState (MatchId,Status,ImporterVersion,ParseVersion,SourceHash,SectionsJson,IssuesJson,AttemptedAt,LastSuccessAt,Error)
        VALUES (?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(MatchId) DO UPDATE SET Status=excluded.Status,
        ImporterVersion=excluded.ImporterVersion,ParseVersion=excluded.ParseVersion,SourceHash=excluded.SourceHash,
        SectionsJson=excluded.SectionsJson,IssuesJson=excluded.IssuesJson,AttemptedAt=excluded.AttemptedAt,LastSuccessAt=excluded.LastSuccessAt,Error=NULL`)
        .run(expectedMatchId, ready ? 'ready' : 'partial', IMPORTER_VERSION, scalar(merged.version), sourceHash,
          JSON.stringify(sections), JSON.stringify(issues), now, now);
      return { matchId: expectedMatchId, status: ready ? 'ready' : 'partial', sections, issues };
    }).immediate();
  } catch (error) {
    try { if (!isSqliteBusy(error)) recordWarehouseFailure(db, expectedMatchId, error, now); }
    catch (recordError) { error.recordError = recordError.message; }
    throw error;
  }
}
