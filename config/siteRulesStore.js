export default class SiteRulesStore {
  constructor(db) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS SiteRules (
      RuleId INTEGER PRIMARY KEY AUTOINCREMENT,
      RuleHeader TEXT NOT NULL DEFAULT '',
      RuleText TEXT NOT NULL,
      ItemType TEXT NOT NULL DEFAULT 'rule',
      SortOrder INTEGER NOT NULL
    )`);
    const columns = this.db.prepare('PRAGMA table_info(SiteRules)').all().map((column) => column.name);
    if (!columns.includes('RuleHeader')) {
      this.db.exec("ALTER TABLE SiteRules ADD COLUMN RuleHeader TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.includes('ItemType')) {
      this.db.exec("ALTER TABLE SiteRules ADD COLUMN ItemType TEXT NOT NULL DEFAULT 'rule'");
    }
    // Older entries stored a heading on one rule. Make each heading its own ordered item.
    const oldHeadings = this.db.prepare("SELECT 1 FROM SiteRules WHERE RuleHeader <> '' LIMIT 1").get();
    if (oldHeadings) {
      this.db.transaction(() => {
        const rows = this.list();
        const insertHeading = this.db.prepare(`INSERT INTO SiteRules (RuleHeader, RuleText, ItemType, SortOrder)
          VALUES ('', ?, 'header', ?)`);
        const updateRule = this.db.prepare("UPDATE SiteRules SET RuleHeader = '', SortOrder = ? WHERE RuleId = ?");
        let order = 1;
        for (const row of rows) {
          if (row.RuleHeader) insertHeading.run(row.RuleHeader, order++);
          updateRule.run(order++, row.RuleId);
        }
      })();
    }
  }

  list() {
    return this.db.prepare(`SELECT RuleId, RuleHeader, RuleText, ItemType, SortOrder FROM SiteRules
      ORDER BY SortOrder, RuleId`).all();
  }

  add(text, itemType = 'rule') {
    return this.db.transaction(() => {
      const nextOrder = this.db.prepare('SELECT COALESCE(MAX(SortOrder), 0) + 1 AS NextOrder FROM SiteRules').get().NextOrder;
      const result = this.db.prepare('INSERT INTO SiteRules (RuleText, ItemType, SortOrder) VALUES (?, ?, ?)').run(text, itemType, nextOrder);
      return this.db.prepare('SELECT RuleId, RuleHeader, RuleText, ItemType, SortOrder FROM SiteRules WHERE RuleId = ?').get(result.lastInsertRowid);
    })();
  }

  update(ruleId, text) {
    const result = this.db.prepare('UPDATE SiteRules SET RuleText = ? WHERE RuleId = ?').run(text, ruleId);
    return result.changes ? this.db.prepare('SELECT RuleId, RuleHeader, RuleText, ItemType, SortOrder FROM SiteRules WHERE RuleId = ?').get(ruleId) : null;
  }

  delete(ruleId) {
    return this.db.prepare('DELETE FROM SiteRules WHERE RuleId = ?').run(ruleId).changes > 0;
  }

  move(ruleId, direction) {
    return this.db.transaction(() => {
      const current = this.db.prepare('SELECT RuleId, SortOrder FROM SiteRules WHERE RuleId = ?').get(ruleId);
      if (!current) return null;
      const adjacent = direction === 'up'
        ? this.db.prepare(`SELECT RuleId, SortOrder FROM SiteRules
            WHERE SortOrder < ? OR (SortOrder = ? AND RuleId < ?)
            ORDER BY SortOrder DESC, RuleId DESC LIMIT 1`).get(current.SortOrder, current.SortOrder, ruleId)
        : this.db.prepare(`SELECT RuleId, SortOrder FROM SiteRules
            WHERE SortOrder > ? OR (SortOrder = ? AND RuleId > ?)
            ORDER BY SortOrder, RuleId LIMIT 1`).get(current.SortOrder, current.SortOrder, ruleId);
      if (!adjacent) return false;
      this.db.prepare('UPDATE SiteRules SET SortOrder = ? WHERE RuleId = ?').run(adjacent.SortOrder, ruleId);
      this.db.prepare('UPDATE SiteRules SET SortOrder = ? WHERE RuleId = ?').run(current.SortOrder, adjacent.RuleId);
      return true;
    })();
  }

  reorder(ruleIds) {
    return this.db.transaction(() => {
      const current = this.list();
      const currentIds = new Set(current.map((rule) => rule.RuleId));
      if (!Array.isArray(ruleIds) || ruleIds.length !== current.length ||
        ruleIds.some((id) => !Number.isSafeInteger(id) || !currentIds.has(id)) ||
        new Set(ruleIds).size !== ruleIds.length) {
        const error = new Error('Rule order is out of date');
        error.code = 'RULE_ORDER_CONFLICT';
        throw error;
      }
      const update = this.db.prepare('UPDATE SiteRules SET SortOrder = ? WHERE RuleId = ?');
      ruleIds.forEach((id, index) => update.run(index + 1, id));
      return this.list();
    })();
  }
}
