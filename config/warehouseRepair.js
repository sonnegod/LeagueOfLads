import { captureRepairRows, quoteIdentifier } from './warehouseRepairJournal.js';
import { buildGroupResults } from './groupResults.js';

export const CORE_PLAYER_FIELDS = {
  Kills: 'kills', Deaths: 'deaths', Assists: 'assists', Networth: 'net_worth', Lasthits: 'last_hits',
  HeroDamage: 'hero_damage', GPM: 'gold_per_min', XPM: 'xp_per_min', Healing: 'hero_healing', TowerDamage: 'tower_damage'
};
const required = ['kills', 'deaths', 'assists', 'last_hits', 'gold_per_min', 'xp_per_min'];
const valid = value => Number.isSafeInteger(value) && value >= 0;

export function planMatchRepair(db, data, match) {
  const stored = db.prepare('SELECT * FROM MatchPlayer WHERE MatchId=?').all(match.MatchId);
  const byPlayer = new Map();
  for (const row of stored) {
    const previous = byPlayer.get(row.PlayerId);
    if (!previous || Object.keys(CORE_PLAYER_FIELDS).filter(k => valid(row[k])).length
      > Object.keys(CORE_PLAYER_FIELDS).filter(k => valid(previous[k])).length) byPlayer.set(row.PlayerId, row);
  }
  const beforeCells = [...byPlayer.values()].reduce((n, row) => n + Object.keys(CORE_PLAYER_FIELDS).filter(k => valid(row[k])).length, 0);
  const afterCells = data.players.reduce((n, p) => n + Object.values(CORE_PLAYER_FIELDS).filter(k => valid(p[k])).length, 0);
  // A different result or hero alone is not proof of a more complete response.
  const richer = byPlayer.size < 10 || afterCells > beforeCells;
  if (!richer || !valid(data.duration) || data.duration === 0
    || !data.players.every(p => required.every(k => valid(p[k])))) return null;
  if (match.TeamRad === match.TeamDire || match.Rehost) throw new Error('Cannot repair a remake or a match with identical teams');
  for (const p of data.players) {
    if (!db.prepare('SELECT 1 FROM HeroInfo WHERE HeroId=?').get(p.hero_id)) throw new Error(`Unknown source hero ${p.hero_id}`);
  }
  return { beforePlayers: byPlayer.size, beforeCells, afterCells, byPlayer };
}

function rebuildStandings(db, leagueId) {
  const groups = db.prepare('SELECT GroupId FROM GroupNames WHERE LeagueId=?').all(leagueId);
  if (!groups.length) return;
  const matches = db.prepare(`SELECT m.TeamRad,m.TeamDire,m.WinnerId FROM MatchLeague l
    JOIN MatchTeam m ON m.MatchId=l.MatchId LEFT JOIN LeagueStageBoundaries b ON b.LeagueId=l.LeagueId
    WHERE l.LeagueId=? AND m.WinnerId IN (m.TeamRad,m.TeamDire)
    AND (b.GroupEndMatchId IS NULL OR m.MatchId<=b.GroupEndMatchId)`).all(leagueId);
  db.prepare('UPDATE LeagueStandings SET Wins=0,Losses=0 WHERE LeagueId=?').run(leagueId);
  db.prepare('UPDATE Neustadtl SET Score=0 WHERE LeagueId=?').run(leagueId);
  for (const group of groups) {
    const teams = db.prepare('SELECT TeamId FROM LeagueGroups WHERE LeagueId=? AND GroupId=?').all(leagueId, group.GroupId);
    const overrides = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='GroupResultOverrides'").get()
      ? db.prepare(`SELECT TeamA,TeamB,WinsA,WinsB,BaseWinsA,BaseWinsB
        FROM GroupResultOverrides WHERE LeagueId=? AND GroupId=?`).all(leagueId, group.GroupId) : [];
    for (const row of buildGroupResults(teams, matches, overrides).teams) {
      db.prepare(`INSERT INTO LeagueStandings(LeagueId,TeamId,Wins,Losses) VALUES(?,?,?,?)
        ON CONFLICT(LeagueId,TeamId) DO UPDATE SET Wins=excluded.Wins,Losses=excluded.Losses`)
        .run(leagueId, row.TeamId, row.Wins, row.Losses);
      db.prepare(`INSERT INTO Neustadtl(LeagueId,TeamId,Score) VALUES(?,?,?)
        ON CONFLICT(TeamId,LeagueId) DO UPDATE SET Score=excluded.Score`).run(leagueId, row.TeamId, row.Score);
    }
  }
}

// Called within the ingestion transaction. Metadata and curated team IDs are never replaced.
export function repairMatchCore(db, data, match, plan) {
  const id = match.MatchId, winner = data.radiant_win ? match.TeamRad : match.TeamDire;
  const scopes = ['MatchTeam', 'MatchPlayer', 'MatchTeamPlayer', 'PickInfo'].map(table => ({ table, where: 'MatchId=?', params: [id] }));
  const missingPlayers = data.players.filter(p => !db.prepare('SELECT 1 FROM PlayerInfo WHERE PlayerId=?').get(p.account_id));
  for (const p of missingPlayers) scopes.push({ table: 'PlayerInfo', where: 'PlayerId=?', params: [p.account_id] });
  const leagueIds = db.prepare('SELECT LeagueId FROM MatchLeague WHERE MatchId=?').all(id).map(row => row.LeagueId);
  if (winner !== match.WinnerId) for (const leagueId of leagueIds) {
    for (const table of ['LeagueStandings', 'Neustadtl']) scopes.push({ table, where: 'LeagueId=?', params: [leagueId] });
  }
  const before = scopes.map(s => captureRepairRows(db, s.table, s.where, s.params));
  for (const p of missingPlayers) db.prepare('INSERT INTO PlayerInfo(PlayerId,PlayerName) VALUES(?,?)')
    .run(p.account_id, typeof p.personaname === 'string' && p.personaname.trim() ? p.personaname : `Player ${p.account_id}`);
  db.prepare('UPDATE MatchTeam SET Duration=?,WinnerId=? WHERE MatchId=?').run(data.duration, winner, id);
  db.prepare('DELETE FROM MatchPlayer WHERE MatchId=?').run(id);
  db.prepare('DELETE FROM MatchTeamPlayer WHERE MatchId=?').run(id);
  const columns = db.prepare('PRAGMA table_info(MatchPlayer)').all().map(c => c.name);
  const insert = db.prepare(`INSERT INTO MatchPlayer(${columns.map(quoteIdentifier).join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
  for (const p of data.players) {
    const old = plan.byPlayer.get(p.account_id);
    const row = old?.HeroId === p.hero_id ? { ...old } : {};
    Object.assign(row, { MatchId: id, PlayerId: p.account_id, HeroId: p.hero_id,
      Winner: Number((p.player_slot < 128) === data.radiant_win) });
    for (const [column, field] of Object.entries(CORE_PLAYER_FIELDS)) if (valid(p[field])) row[column] = p[field];
    insert.run(...columns.map(c => row[c] ?? null));
    db.prepare('INSERT INTO MatchTeamPlayer(MatchId,PlayerId,TeamId) VALUES(?,?,?)')
      .run(id, p.account_id, p.player_slot < 128 ? match.TeamRad : match.TeamDire);
  }
  const draft = data.picks_bans;
  const oldDraft = db.prepare('SELECT DISTINCT IsPick,Hero_Id,OrderNum,Team FROM PickInfo WHERE MatchId=?').all(id);
  const validDraft = Array.isArray(draft) && draft.length > 0 && draft.every(p => typeof p.is_pick === 'boolean'
    && Number.isSafeInteger(p.hero_id) && p.hero_id > 0 && valid(p.order) && [0, 1].includes(p.team))
    && new Set(draft.map(p => p.order)).size === draft.length;
  if (validDraft && draft.length >= oldDraft.length) {
    db.prepare('DELETE FROM PickInfo WHERE MatchId=?').run(id);
    const pick = db.prepare('INSERT INTO PickInfo(MatchId,IsPick,Hero_Id,OrderNum,Team) VALUES(?,?,?,?,?)');
    for (const p of draft) pick.run(id, Number(p.is_pick), p.hero_id, p.order, p.team);
  }
  if (winner !== match.WinnerId) for (const leagueId of leagueIds) rebuildStandings(db, leagueId);
  return { matchId: id, beforePlayers: plan.beforePlayers, afterPlayers: 10,
    beforeCells: plan.beforeCells, afterCells: plan.afterCells, previousWinner: match.WinnerId, winner,
    changes: before.map((b, i) => ({ table: b.table, columns: b.columns, before: b.rows,
      after: captureRepairRows(db, scopes[i].table, scopes[i].where, scopes[i].params).rows })) };
}
