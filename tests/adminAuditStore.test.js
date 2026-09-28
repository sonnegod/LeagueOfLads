import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import AdminAuditStore from '../config/adminAuditStore.js';
import { runWithAuditActor } from '../config/adminAuditContext.js';

test('audit log migration preserves old entries and dates new admin changes', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE Admins (AdminPlayerId INTEGER PRIMARY KEY, AdminPlayerName TEXT);
      CREATE TABLE AdminAuditLog (AuditLogId INTEGER PRIMARY KEY AUTOINCREMENT, Type TEXT, Message TEXT);
      INSERT INTO Admins VALUES (42, 'Example Admin');
      INSERT INTO AdminAuditLog (Type, Message) VALUES ('Old action', 'Existing entry');`);
    const auditLog = new AdminAuditStore(db);

    await runWithAuditActor({ AdminPlayerId: 42, AdminPlayerName: 'Example Admin' }, async () => {
      await Promise.resolve();
      auditLog.record('Rule Edit', 'Changed a rule');
    });
    auditLog.record('Admin Edit', 'Changed a role', 42);
    auditLog.record('System task', 'No signed-in admin');

    const entries = db.prepare(`SELECT Type, Message, ActorAdminId, ActorAdminName, CreatedAt
      FROM AdminAuditLog ORDER BY AuditLogId`).all();
    assert.deepEqual(entries.map(({ CreatedAt, ...entry }) => entry), [
      { Type: 'Old action', Message: 'Existing entry', ActorAdminId: null, ActorAdminName: null },
      { Type: 'Rule Edit', Message: 'Changed a rule', ActorAdminId: 42, ActorAdminName: 'Example Admin' },
      { Type: 'Admin Edit', Message: 'Changed a role', ActorAdminId: 42, ActorAdminName: 'Example Admin' },
      { Type: 'System task', Message: 'No signed-in admin', ActorAdminId: null, ActorAdminName: null },
    ]);
    assert.equal(entries[0].CreatedAt, null);
    for (const entry of entries.slice(1)) {
      assert.match(entry.CreatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.ok(Number.isFinite(Date.parse(entry.CreatedAt)));
    }
    assert.deepEqual(auditLog.list().entries.map((entry) => entry.Type),
      ['System task', 'Admin Edit', 'Rule Edit', 'Old action']);
  } finally {
    db.close();
  }
});

test('audit log returns only the 50 newest entries', () => {
  const db = new Database(':memory:');
  try {
    const auditLog = new AdminAuditStore(db);
    for (let index = 1; index <= 55; index += 1) {
      auditLog.record('Change', `Action ${index}`);
    }
    const firstPage = auditLog.list();
    assert.equal(firstPage.entries.length, 50);
    assert.equal(firstPage.entries[0].Message, 'Action 55');
    assert.equal(firstPage.entries.at(-1).Message, 'Action 6');
    assert.equal(firstPage.nextBeforeId, firstPage.entries.at(-1).AuditLogId);
    const secondPage = auditLog.list(firstPage.nextBeforeId);
    assert.equal(secondPage.entries.length, 5);
    assert.equal(secondPage.entries[0].Message, 'Action 5');
    assert.equal(secondPage.entries.at(-1).Message, 'Action 1');
    assert.equal(secondPage.nextBeforeId, null);
  } finally {
    db.close();
  }
});

test('audit log searches admin name, account ID, action type, and action text', () => {
  const db = new Database(':memory:');
  try {
    const auditLog = new AdminAuditStore(db);
    db.prepare(`INSERT INTO AdminAuditLog (Type, Message, ActorAdminId, ActorAdminName)
      VALUES (?, ?, ?, ?)`).run('Rule Edit', 'Updated playoff rule', 4242, 'Example Admin');
    db.prepare(`INSERT INTO AdminAuditLog (Type, Message, ActorAdminId, ActorAdminName)
      VALUES (?, ?, ?, ?)`).run('Match Delete', 'Removed a result', 9876, 'Other Admin');

    for (const term of ['example', '424', 'rule edit', 'playoff']) {
      assert.deepEqual(auditLog.list(null, term).entries.map((entry) => entry.ActorAdminId), [4242]);
    }
    assert.deepEqual(auditLog.list(null, 'result').entries.map((entry) => entry.ActorAdminId), [9876]);
    assert.equal(auditLog.list(null, '%').entries.length, 0);
    assert.equal(auditLog.list(null, '_').entries.length, 0);
  } finally {
    db.close();
  }
});

test('audit log paginates matching entries after filtering', () => {
  const db = new Database(':memory:');
  try {
    const auditLog = new AdminAuditStore(db);
    for (let index = 1; index <= 110; index += 1) {
      auditLog.record(index % 2 === 0 ? 'Rule Edit' : 'Match Edit', `Action ${index}`);
    }
    const firstPage = auditLog.list(null, 'Rule Edit');
    assert.equal(firstPage.entries.length, 50);
    assert.equal(firstPage.entries[0].Message, 'Action 110');
    assert.equal(firstPage.entries.at(-1).Message, 'Action 12');
    const secondPage = auditLog.list(firstPage.nextBeforeId, 'Rule Edit');
    assert.equal(secondPage.entries.length, 5);
    assert.equal(secondPage.entries[0].Message, 'Action 10');
    assert.equal(secondPage.entries.at(-1).Message, 'Action 2');
    assert.equal(secondPage.nextBeforeId, null);
  } finally {
    db.close();
  }
});
