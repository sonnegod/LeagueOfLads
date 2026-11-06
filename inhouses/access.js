const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const accountId = value => {
  if (!/^\d+$/.test(String(value ?? '')) || !Number.isSafeInteger(Number(value))
    || Number(value) < 1 || Number(value) > 4294967294) fail('Enter a valid Dota account ID');
  return Number(value);
};

export class InhouseAccess {
  constructor(store) { this.store = store; this.db = store.db; }
  hasTable(name) { return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
  playerName(playerId) {
    if (!playerId) return null;
    const player = this.hasTable('PlayerInfo')
      ? this.db.prepare('SELECT CAST(PlayerName AS TEXT) AS name FROM PlayerInfo WHERE PlayerId=?').get(playerId) : null;
    const inhouse = this.db.prepare('SELECT Name AS name FROM InhousePlayers WHERE PlayerId=?').get(playerId);
    const admin = this.hasTable('Admins')
      ? this.db.prepare('SELECT AdminPlayerName AS name FROM Admins WHERE AdminPlayerId=?').get(playerId) : null;
    return player?.name || inhouse?.name || admin?.name || `Account ${playerId}`;
  }
  admins() {
    return this.hasTable('Admins') ? this.db.prepare(`SELECT AdminPlayerId AS playerId,AdminPlayerName AS name
      FROM Admins ORDER BY AdminPlayerId`).all() : [];
  }
  isAdmin(playerId) {
    return Boolean(playerId && this.hasTable('Admins')
      && this.db.prepare('SELECT 1 FROM Admins WHERE AdminPlayerId=?').get(playerId));
  }
  permissions(playerId) {
    const administrator = this.isAdmin(playerId);
    const communityManager = administrator || Boolean(playerId
      && this.db.prepare('SELECT 1 FROM InhouseCommunityManagers WHERE PlayerId=?').get(playerId));
    const vouched = Boolean(playerId && this.db.prepare('SELECT 1 FROM InhouseVouches WHERE PlayerId=?').get(playerId));
    return {administrator, communityManager, vouched, canManage: communityManager,
      canQueue: Boolean(playerId && (communityManager || vouched))};
  }
  version() {
    // Admin roles are owned elsewhere. Include that live union without copying
    // admins into the community-manager table or writing on each polling tick.
    return JSON.stringify([this.db.prepare('SELECT Revision FROM InhouseAccessMeta WHERE Id=1').get().Revision, this.admins()]);
  }
  requireManager(actorId, administratorsOnly = false) {
    const id = accountId(actorId), permissions = this.permissions(id);
    if (administratorsOnly ? !permissions.administrator : !permissions.canManage)
      fail(administratorsOnly ? 'Only admins can manage community managers' : 'Community manager access required', 403);
    return id;
  }
  pruneQueue() {
    return this.db.prepare(`DELETE FROM InhouseQueue WHERE InhouseId IS NULL
      AND NOT EXISTS (SELECT 1 FROM InhouseVouches v WHERE v.PlayerId=InhouseQueue.PlayerId)
      AND NOT EXISTS (SELECT 1 FROM InhouseCommunityManagers c WHERE c.PlayerId=InhouseQueue.PlayerId)
      ${this.hasTable('Admins') ? 'AND NOT EXISTS (SELECT 1 FROM Admins a WHERE a.AdminPlayerId=InhouseQueue.PlayerId)' : ''}`)
      .run().changes;
  }
  change(kind, playerId, enabled, actorId) {
    const id = accountId(playerId);
    return this.store.mutate(() => {
      const actor = this.requireManager(actorId, kind === 'managers');
      const permissions = this.permissions(id);
      if (kind === 'managers' && permissions.administrator) fail('Admins already have community manager access automatically', 409);
      if (kind === 'vouches' && permissions.communityManager) fail('This account has automatic access through its role', 409);
      const table = kind === 'managers' ? 'InhouseCommunityManagers' : 'InhouseVouches';
      const changed = enabled
        ? this.db.prepare(`INSERT OR IGNORE INTO ${table} VALUES(?,?,?)`).run(id, this.store.clock(), actor).changes
        : this.db.prepare(`DELETE FROM ${table} WHERE PlayerId=?`).run(id).changes;
      if (changed) {
        const waitingRemoved = this.pruneQueue();
        this.db.prepare('UPDATE InhouseAccessMeta SET Revision=Revision+1 WHERE Id=1').run();
        this.store.audit(`${kind === 'managers' ? 'community-manager' : 'vouch'}-${enabled ? 'added' : 'removed'}`,
          actor, null, {playerId: id, waitingRemoved});
      }
      return {ok: true, changed: Boolean(changed), version: this.version()};
    });
  }
  list(kind, actorId, {list = 'members', search = '', page = '0'} = {}) {
    this.requireManager(actorId, kind === 'managers');
    if (!['members', 'candidates'].includes(list) || typeof search !== 'string' || search.length > 100
      || !/^\d+$/.test(String(page)) || Number(page) > 100000) fail('Invalid player search');
    const sources = ['SELECT PlayerId FROM InhousePlayers', 'SELECT PlayerId FROM InhouseCommunityManagers', 'SELECT PlayerId FROM InhouseVouches'];
    if (this.hasTable('PlayerInfo')) sources.push('SELECT PlayerId FROM PlayerInfo');
    const admins = this.hasTable('Admins');
    if (admins) sources.push('SELECT AdminPlayerId FROM Admins');
    const directory = `WITH ids AS (${sources.join(' UNION ')}), players AS (
      SELECT ids.PlayerId AS playerId,
        COALESCE(${this.hasTable('PlayerInfo') ? 'NULLIF(CAST(p.PlayerName AS TEXT),\'\'),' : ''}
          NULLIF(i.Name,''),${admins ? "NULLIF(a.AdminPlayerName,'')," : ''}'Account '||ids.PlayerId) AS name,
        ${admins ? 'a.AdminPlayerId IS NOT NULL' : '0'} AS administrator,
        c.PlayerId IS NOT NULL AS designatedManager,v.PlayerId IS NOT NULL AS vouched,
        c.AddedAt AS managerAddedAt,v.VouchedAt AS vouchedAt,
        c.AddedBy AS managerAddedBy,v.VouchedBy AS vouchedBy
      FROM ids LEFT JOIN InhousePlayers i ON i.PlayerId=ids.PlayerId
      LEFT JOIN InhouseCommunityManagers c ON c.PlayerId=ids.PlayerId
      LEFT JOIN InhouseVouches v ON v.PlayerId=ids.PlayerId
      ${this.hasTable('PlayerInfo') ? 'LEFT JOIN PlayerInfo p ON p.PlayerId=ids.PlayerId' : ''}
      ${admins ? 'LEFT JOIN Admins a ON a.AdminPlayerId=ids.PlayerId' : ''}
      WHERE ids.PlayerId BETWEEN 1 AND 4294967294
    )`;
    const membership = kind === 'managers' ? '(administrator OR designatedManager)' : '(administrator OR designatedManager OR vouched)';
    const where = `WHERE ${list === 'members' ? '' : 'NOT '}${membership}
      AND (instr(lower(name),lower(@search))>0 OR instr(CAST(playerId AS TEXT),@search)>0)`;
    const args = {search: search.trim()};
    const total = this.db.prepare(`${directory} SELECT COUNT(*) AS n FROM players ${where}`).get(args).n;
    const pageSize = 20, current = Math.min(Number(page), Math.max(0, Math.ceil(total / pageSize) - 1));
    const users = this.db.prepare(`${directory} SELECT * FROM players ${where}
      ORDER BY administrator DESC,name COLLATE NOCASE,playerId LIMIT @limit OFFSET @offset`)
      .all({...args, limit: pageSize, offset: current * pageSize}).map(row => ({...row,
        administrator: Boolean(row.administrator), communityManager: Boolean(row.administrator || row.designatedManager),
        vouched: Boolean(row.vouched), automaticAccess: Boolean(row.administrator || row.designatedManager)}));
    return {users, total, page: current, pageSize, version: this.version()};
  }
}
