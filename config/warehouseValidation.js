import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { MATCH_TEAM_ADDITIONS, MATCH_PLAYER_ADDITIONS, WAREHOUSE_CHILDREN } from './warehouseSchema.js';
import { PLAYER_FIELDS } from './warehouseIngestion.js';
import { warehouseResultNotes } from './warehouseCollection.js';
import { repairOverlay } from './warehouseRepairJournal.js';

const identifier = value => `"${value.replaceAll('"', '""')}"`;
const expansionTables = new Set([...WAREHOUSE_CHILDREN, 'WarehouseMigrations', 'Patches']);
const additions = { MatchTeam: new Set(Object.keys(MATCH_TEAM_ADDITIONS)), MatchPlayer: new Set(Object.keys(MATCH_PLAYER_ADDITIONS)) };

function fingerprint(db, table, columns, repairs = []) {
  const digest = createHash('sha256');
  let count = 0;
  const changes = repairOverlay(table, columns, repairs);
  const original = [...changes.entries()].filter(([, change]) => change.before !== null).sort((a, b) => a[0] - b[0]);
  const seen = new Set(), errors = [];
  let index = 0;
  // Stream records, including screenshot blobs, rather than loading an entire warehouse into RAM.
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;
  const order = /WITHOUT\s+ROWID/i.test(definition) ? columns.map(identifier).join(',') : 'rowid';
  if (changes.size && /WITHOUT\s+ROWID/i.test(definition)) throw new Error('Repair journal requires rowid tables');
  const sql = `SELECT ${changes.size ? 'rowid,' : ''}${columns.map(identifier).join(',')} FROM ${identifier(table)} ORDER BY ${order}`;
  const add = row => {
    for (const value of row) {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
      digest.update(`${Buffer.isBuffer(value) ? 'blob' : typeof value}:${bytes.length}:`);
      digest.update(bytes);
    }
    digest.update('\n'); count++;
  };
  for (const raw of db.prepare(sql).raw().iterate()) {
    if (!changes.size) { add(raw); continue; }
    const [id, ...row] = raw;
    while (index < original.length && original[index][0] <= id) add(original[index++][1].before);
    const change = changes.get(id);
    if (!change) add(row);
    else {
      seen.add(id);
      if (JSON.stringify(change.after) !== JSON.stringify(row)) errors.push(id);
    }
  }
  while (index < original.length) add(original[index++][1].before);
  for (const [id, change] of changes) if (change.after !== null && !seen.has(id)) errors.push(id);
  return { columns, count, sha256: digest.digest('hex'), ...(errors.length ? { unexpectedRepairRows: errors } : {}) };
}

export function captureWarehouseBaseline(db) {
  return db.transaction(() => {
    const tables = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all()) {
      if (expansionTables.has(name)) continue;
      const columns = db.prepare(`PRAGMA table_info(${identifier(name)})`).all().map(c => c.name).filter(c => !additions[name]?.has(c));
      tables[name] = fingerprint(db, name, columns);
    }
    return { format: 1, capturedAt: new Date().toISOString(), tables };
  })();
}

export function compareWarehouseBaseline(db, baseline, { repairs = [] } = {}) {
  if (baseline?.format !== 1 || !baseline.tables) throw new Error('Unsupported warehouse baseline');
  return db.transaction(() => {
    const differences = [];
    for (const [name, before] of Object.entries(baseline.tables)) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      if (!exists) { differences.push({ table: name, error: 'Table removed' }); continue; }
      const after = fingerprint(db, name, before.columns, repairs);
      if (after.unexpectedRepairRows || before.count !== after.count || before.sha256 !== after.sha256) differences.push({ table: name, before, after });
    }
    return { unchanged: differences.length === 0, checkedTables: Object.keys(baseline.tables).length, differences,
      ...(repairs.length ? { authorizedRepairs: repairs.length } : {}) };
  })();
}

export function reconcileWarehouseSources(db, { leagueId = null } = {}) {
  let checkedMatches = 0, mismatchCount = 0;
  const mismatches = [];
  const issue = (matchId, section) => {
    mismatchCount++;
    if (mismatches.length < 100) mismatches.push({ matchId, section });
  };
  const same = (matchId, section, expected, actual) => {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) issue(matchId, section);
  };
  const value = n => typeof n === 'number' && Number.isFinite(n) ? n : null;
  const query = db.prepare(`SELECT a.* FROM MatchSourceResponses a JOIN MatchLeague l ON l.MatchId=a.MatchId
    WHERE (? IS NULL OR l.LeagueId=?) ORDER BY a.MatchId`);
  for (const row of query.iterate(leagueId, leagueId)) {
    checkedMatches++;
    try {
      const raw = gunzipSync(row.GameplayData), data = JSON.parse(raw.toString('utf8')), id = row.MatchId;
      const digest = createHash('sha256').update(raw).digest('hex');
      same(id, 'archive.matchId', id, data.match_id);
      same(id, 'archive.hash', row.SourceHash, digest);
      const state = db.prepare('SELECT SourceHash,SectionsJson FROM MatchIngestionState WHERE MatchId=?').get(id);
      same(id, 'state.hash', row.SourceHash, state?.SourceHash);
      // Older archives are normalized explicitly, rather than during migration/validation.
      const upgradesNormalized = Boolean(state && Object.hasOwn(JSON.parse(state.SectionsJson), 'abilityUpgrades'));
      const match = db.prepare('SELECT * FROM MatchTeam WHERE MatchId=?').get(id);
      for (const [column, field] of [['StartTimeUtc','start_time'],['RadiantScore','radiant_score'],['DireScore','dire_score'],['FirstBloodTime','first_blood_time']]) {
        if (value(data[field]) !== null) same(id, column, data[field], match[column]);
      }
      const patch = match.StartTimeUtc ? db.prepare('SELECT PatchId FROM Patches WHERE StartsAt<=? ORDER BY StartsAt DESC,PatchId DESC LIMIT 1')
        .get(new Date(match.StartTimeUtc * 1000).toISOString())?.PatchId ?? null : null;
      same(id, 'patch.assignment', patch, match.PatchId);
      for (const p of data.players) {
        const stored = db.prepare('SELECT * FROM MatchPlayer WHERE MatchId=? AND PlayerId=?').get(id, p.account_id);
        if (!stored) { issue(id, `player.${p.account_id}.missing`); continue; }
        for (const [column, field] of Object.entries(PLAYER_FIELDS)) {
          const expected = column === 'IsRoaming' ? typeof p[field] === 'boolean' ? Number(p[field]) : null : value(p[field]);
          if (expected !== null) same(id, `player.${p.account_id}.${column}`, expected, stored[column]);
        }
        const expected = (p.times || []).map((t, i) => [t, value(p.gold_t?.[i]), value(p.xp_t?.[i]), value(p.lh_t?.[i])]);
        const actual = db.prepare('SELECT TimeSeconds,Gold,Experience,LastHits FROM MatchPlayerTimeline WHERE MatchId=? AND PlayerId=? ORDER BY TimeSeconds')
          .raw().all(id, p.account_id);
        same(id, `player.${p.account_id}.timeline`, expected, actual);
        if (Array.isArray(p.purchase_log)) same(id, `player.${p.account_id}.purchases`,
          p.purchase_log.map((e, i) => [i, e.time, e.key]),
          db.prepare('SELECT EventIndex,TimeSeconds,ItemKey FROM MatchPlayerPurchases WHERE MatchId=? AND PlayerId=? ORDER BY EventIndex').raw().all(id, p.account_id));
        if (upgradesNormalized && Array.isArray(p.ability_upgrades_arr) && p.ability_upgrades_arr.every(n => Number.isSafeInteger(n) && n > 0)) {
          same(id, `player.${p.account_id}.abilityUpgrades`, p.ability_upgrades_arr.map((abilityId, index) => [index, abilityId]),
            db.prepare('SELECT UpgradeIndex,AbilityId FROM MatchPlayerAbilityUpgrades WHERE MatchId=? AND PlayerId=? ORDER BY UpgradeIndex').raw().all(id, p.account_id));
        }
      }
      const expectedTeam = Array.from({ length: Math.max(data.radiant_gold_adv?.length || 0, data.radiant_xp_adv?.length || 0) },
        (_, i) => [i * 60, value(data.radiant_gold_adv?.[i]), value(data.radiant_xp_adv?.[i])]);
      same(id, 'team.timeline', expectedTeam,
        db.prepare('SELECT TimeSeconds,RadiantGoldAdvantage,RadiantXpAdvantage FROM MatchTeamTimeline WHERE MatchId=? ORDER BY TimeSeconds').raw().all(id));
      if (Array.isArray(data.objectives)) same(id, 'objectives', data.objectives.map((e, i) => [i, e.time, e.type, JSON.stringify(e)]),
        db.prepare('SELECT EventIndex,TimeSeconds,Type,SourceJson FROM MatchObjectives WHERE MatchId=? ORDER BY EventIndex').raw().all(id));
      if (Array.isArray(data.teamfights)) {
        same(id, 'fight.count', data.teamfights.length, db.prepare('SELECT COUNT(*) n FROM MatchTeamfights WHERE MatchId=?').get(id).n);
        data.teamfights.forEach((f, i) => {
          const { players, ...details } = f;
          same(id, `fight.${i}`, [f.start, f.end, JSON.stringify(details)],
            db.prepare('SELECT StartSeconds,EndSeconds,SourceJson FROM MatchTeamfights WHERE MatchId=? AND FightIndex=?').raw().get(id, i));
          const expectedPlayers = players.map((p, j) => [data.players[j].account_id, data.players[j].player_slot,
            value(p.deaths), value(p.damage), value(p.gold_delta), value(p.xp_delta), JSON.stringify(p)]).sort((a, b) => a[0] - b[0]);
          same(id, `fight.${i}.players`, expectedPlayers,
            db.prepare('SELECT PlayerId,PlayerSlot,Deaths,Damage,GoldDelta,XpDelta,SourceJson FROM MatchTeamfightPlayers WHERE MatchId=? AND FightIndex=? ORDER BY PlayerId').raw().all(id, i));
        });
      }
    } catch (error) { issue(row.MatchId, `unreadable source: ${error.message}`); }
  }
  return { checkedMatches, mismatchCount, mismatches };
}

export function validateWarehouse(db, { leagueId = null, deep = false } = {}) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  const checks = {};
  for (const name of WAREHOUSE_CHILDREN) {
    if (!tables.has(name)) { checks[`${name}:missing`] = 1; continue; }
    checks[`${name}:orphans`] = db.prepare(`SELECT COUNT(*) n FROM ${name} c WHERE NOT EXISTS
      (SELECT 1 FROM MatchTeam m WHERE m.MatchId=c.MatchId)`).get().n;
  }
  if (tables.has('MatchTeamfightPlayers')) checks.fightPlayerOrphans = db.prepare(`SELECT COUNT(*) n FROM MatchTeamfightPlayers p
    WHERE NOT EXISTS (SELECT 1 FROM MatchTeamfights f WHERE f.MatchId=p.MatchId AND f.FightIndex=p.FightIndex)`).get().n;
  for (const name of ['MatchPlayerTimeline', 'MatchPlayerPurchases', 'MatchPlayerAbilityUpgrades', 'MatchTeamfightPlayers']) {
    if (tables.has(name)) checks[`${name}:unknownPlayers`] = db.prepare(`SELECT COUNT(*) n FROM ${name} c WHERE NOT EXISTS
      (SELECT 1 FROM MatchPlayer p WHERE p.MatchId=c.MatchId AND p.PlayerId=c.PlayerId)`).get().n;
  }
  if (tables.has('Patches')) checks.unknownPatches = db.prepare(`SELECT COUNT(*) n FROM MatchTeam m
    WHERE m.PatchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Patches p WHERE p.PatchId=m.PatchId)`).get().n;
  const coverage = tables.has('MatchIngestionState') ? db.prepare(`SELECT COALESCE(s.Status,'not_imported') status,COUNT(*) matches
    FROM MatchTeam m JOIN MatchLeague l ON l.MatchId=m.MatchId LEFT JOIN MatchIngestionState s ON s.MatchId=m.MatchId
    WHERE (? IS NULL OR l.LeagueId=?) GROUP BY COALESCE(s.Status,'not_imported') ORDER BY status`).all(leagueId, leagueId) : [];
  const problems = tables.has('MatchIngestionState') ? db.prepare(`SELECT s.MatchId,s.Status,s.Error,s.IssuesJson
    FROM MatchIngestionState s JOIN MatchLeague l ON l.MatchId=s.MatchId
    WHERE (? IS NULL OR l.LeagueId=?) AND (s.Error IS NOT NULL OR s.IssuesJson<>'[]') ORDER BY s.MatchId`).all(leagueId, leagueId) : [];
  const sourceReconciliation = deep && tables.has('MatchSourceResponses') ? reconcileWarehouseSources(db, { leagueId }) : null;
  return { valid: Object.values(checks).every(n => n === 0) && !sourceReconciliation?.mismatchCount,
    checks, coverage, problems, dataQualityNotes:warehouseResultNotes(db,{leagueId}), sourceReconciliation };
}
