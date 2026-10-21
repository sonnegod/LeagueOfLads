import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const positive = value => Number.isSafeInteger(value) && value > 0;
export const validAbilityUpgrades = value => Array.isArray(value) && value.every(positive);

// The array records order, not necessarily hero level or an upgrade timestamp.
// Call inside the importing match's transaction, after participant validation.
export function writeAbilityUpgrades(db, data) {
  const read = db.prepare(`SELECT UpgradeIndex,AbilityId FROM MatchPlayerAbilityUpgrades
    WHERE MatchId=? AND PlayerId=? ORDER BY UpgradeIndex`);
  const remove = db.prepare('DELETE FROM MatchPlayerAbilityUpgrades WHERE MatchId=? AND PlayerId=?');
  const insert = db.prepare('INSERT INTO MatchPlayerAbilityUpgrades (MatchId,PlayerId,UpgradeIndex,AbilityId) VALUES (?,?,?,?)');
  let players = 0, upgrades = 0, changedPlayers = 0;
  for (const player of data.players) {
    if (!validAbilityUpgrades(player.ability_upgrades_arr)) continue;
    const order = player.ability_upgrades_arr;
    players++; upgrades += order.length;
    const old = read.all(data.match_id, player.account_id);
    if (old.length === order.length && old.every((row, i) => row.UpgradeIndex === i && row.AbilityId === order[i])) continue;
    remove.run(data.match_id, player.account_id);
    order.forEach((abilityId, index) => insert.run(data.match_id, player.account_id, index, abilityId));
    changedPlayers++;
  }
  return { players, upgrades, changedPlayers };
}

// Bounded, resumable local extraction. No network, analytics build, or raw archive changes.
export function backfillAbilityUpgrades(db, { apply = false, afterMatchId = 0, limit = 1000 } = {}) {
  if (!Number.isSafeInteger(afterMatchId) || afterMatchId < 0 || !positive(limit)) throw new Error('Invalid backfill range');
  const hasTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='MatchPlayerAbilityUpgrades'").get());
  if (apply && !hasTable) throw new Error('Initialize the warehouse schema before applying ability upgrades');
  const next = db.prepare(`SELECT a.MatchId FROM MatchSourceResponses a JOIN MatchTeam m ON m.MatchId=a.MatchId
    WHERE a.MatchId>? ORDER BY a.MatchId LIMIT 1`);
  const read = db.prepare('SELECT * FROM MatchSourceResponses WHERE MatchId=?');
  const participants = db.prepare('SELECT DISTINCT PlayerId,HeroId FROM MatchPlayer WHERE MatchId=?');
  const existing = hasTable ? db.prepare(`SELECT PlayerId,UpgradeIndex,AbilityId FROM MatchPlayerAbilityUpgrades
    WHERE MatchId=? ORDER BY PlayerId,UpgradeIndex`) : null;
  const stats = { checked: 0, players: 0, upgrades: 0, changedMatches: 0, invalidPlayers: 0, failedMatches: 0,
    errors: [], lastMatchId: afterMatchId, more: false };
  while (stats.checked < limit) {
    const row = next.get(stats.lastMatchId);
    if (!row) break;
    stats.lastMatchId = row.MatchId; stats.checked++;
    try {
      const inspect = db.transaction(() => {
        // Read and validate the current archive under the same transaction as writes.
        const archive = read.get(row.MatchId);
        if (!archive) throw new Error('Archive was removed');
        const raw = gunzipSync(archive.GameplayData);
        if (createHash('sha256').update(raw).digest('hex') !== archive.SourceHash) throw new Error('Archive hash mismatch');
        const data = JSON.parse(raw.toString('utf8'));
        const roster = participants.all(row.MatchId);
        if (data.match_id !== row.MatchId || !Array.isArray(data.players) || data.players.length !== roster.length
          || new Set(data.players.map(p => p?.account_id)).size !== roster.length
          || data.players.some(p => !positive(p?.account_id) || !positive(p?.hero_id)
            || !roster.some(r => r.PlayerId === p.account_id && r.HeroId === p.hero_id))) {
          throw new Error('Archive conflicts with curated match participants');
        }
        const players = data.players.filter(p => validAbilityUpgrades(p.ability_upgrades_arr));
        const invalid = data.players.filter(p => p.ability_upgrades_arr != null && !validAbilityUpgrades(p.ability_upgrades_arr)).length;
        const wanted = players.flatMap(p => p.ability_upgrades_arr.map((id, index) => [p.account_id, index, id]))
          .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const ids = new Set(players.map(p => p.account_id));
        const actual = (existing?.all(row.MatchId) || []).filter(r => ids.has(r.PlayerId))
          .map(r => [r.PlayerId, r.UpgradeIndex, r.AbilityId]);
        const changed = JSON.stringify(wanted) !== JSON.stringify(actual);
        if (apply) {
          if (changed) writeAbilityUpgrades(db, data);
          // Mark this section as normalized without changing ingestion results or source provenance.
          const coverage = JSON.stringify({ players: players.length, events: wanted.length });
          db.prepare(`UPDATE MatchIngestionState SET SectionsJson=json_set(SectionsJson,'$.abilityUpgrades',json(?))
            WHERE MatchId=? AND json_extract(SectionsJson,'$.abilityUpgrades') IS NOT json(?)`)
            .run(coverage, row.MatchId, coverage);
        }
        return { players: players.length, upgrades: wanted.length, invalid, changed };
      });
      const result = apply ? inspect.immediate() : inspect();
      stats.players += result.players; stats.upgrades += result.upgrades;
      stats.invalidPlayers += result.invalid; stats.changedMatches += Number(result.changed);
    } catch (error) {
      stats.failedMatches++;
      if (stats.errors.length < 20) stats.errors.push({ matchId: row.MatchId, message: error.message });
    }
  }
  stats.more = Boolean(next.get(stats.lastMatchId));
  return stats;
}
