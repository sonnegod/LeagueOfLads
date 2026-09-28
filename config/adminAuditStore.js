import { getAuditActor } from './adminAuditContext.js';

export default class AdminAuditStore {
  constructor(db) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS AdminAuditLog (
      AuditLogId INTEGER PRIMARY KEY AUTOINCREMENT,
      Type TEXT,
      Message TEXT,
      ActorAdminId INTEGER,
      ActorAdminName TEXT,
      CreatedAt TEXT
    )`);
    const columns = this.db.prepare('PRAGMA table_info(AdminAuditLog)').all().map((column) => column.name);
    if (!columns.includes('ActorAdminId')) this.db.exec('ALTER TABLE AdminAuditLog ADD COLUMN ActorAdminId INTEGER');
    if (!columns.includes('ActorAdminName')) this.db.exec('ALTER TABLE AdminAuditLog ADD COLUMN ActorAdminName TEXT');
    if (!columns.includes('CreatedAt')) this.db.exec('ALTER TABLE AdminAuditLog ADD COLUMN CreatedAt TEXT');
  }

  record(type, message, fallbackActorId = null) {
    const actor = getAuditActor() || (fallbackActorId
      ? this.db.prepare('SELECT AdminPlayerId, AdminPlayerName FROM Admins WHERE AdminPlayerId = ?').get(fallbackActorId)
      : null);
    this.db.prepare(`INSERT INTO AdminAuditLog (Type, Message, ActorAdminId, ActorAdminName, CreatedAt)
      VALUES (?, ?, ?, ?, ?)`).run(type, message, actor?.AdminPlayerId ?? fallbackActorId,
      actor?.AdminPlayerName ?? null, new Date().toISOString());
  }

  list(beforeId = null, search = '') {
    const select = `SELECT AuditLogId, Type, Message, ActorAdminId, ActorAdminName, CreatedAt
      FROM AdminAuditLog`;
    const filters = [];
    const params = [];
    if (beforeId !== null) {
      filters.push('AuditLogId < ?');
      params.push(beforeId);
    }
    if (search) {
      const pattern = `%${search.replace(/[!%_]/g, '!$&')}%`;
      filters.push(`(ActorAdminName LIKE ? ESCAPE '!' OR CAST(ActorAdminId AS TEXT) LIKE ? ESCAPE '!'
        OR Type LIKE ? ESCAPE '!' OR Message LIKE ? ESCAPE '!')`);
      params.push(pattern, pattern, pattern, pattern);
    }
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    const rows = this.db.prepare(`${select}${where} ORDER BY AuditLogId DESC LIMIT 51`).all(...params);
    const entries = rows.slice(0, 50);
    return { entries, nextBeforeId: rows.length > 50 ? entries.at(-1).AuditLogId : null };
  }
}
