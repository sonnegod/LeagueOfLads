import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import SiteRulesStore from '../config/siteRulesStore.js';

test('headers and rules are separate items that can be edited, removed, and reordered', () => {
  const db = new Database(':memory:');
  try {
    const store = new SiteRulesStore(db);
    const heading = store.add('Introduction', 'header');
    const first = store.add('First rule');
    const second = store.add('Second rule');
    const nextHeading = store.add('Fair play', 'header');

    assert.deepEqual(store.list().map((item) => [item.ItemType, item.RuleText]), [
      ['header', 'Introduction'], ['rule', 'First rule'], ['rule', 'Second rule'], ['header', 'Fair play'],
    ]);
    assert.equal(store.update(first.RuleId, 'Revised first rule').RuleText, 'Revised first rule');
    assert.equal(store.update(heading.RuleId, 'Getting started').RuleText, 'Getting started');
    assert.equal(store.move(nextHeading.RuleId, 'up'), true);
    assert.deepEqual(store.list().map((item) => item.RuleId),
      [heading.RuleId, first.RuleId, nextHeading.RuleId, second.RuleId]);
    assert.equal(store.move(heading.RuleId, 'up'), false);
    assert.equal(store.delete(nextHeading.RuleId), true);
    assert.equal(store.delete(nextHeading.RuleId), false);
    assert.equal(store.move(999, 'up'), null);
    assert.equal(store.update(999, 'Missing'), null);

    const last = store.add('Last rule');
    assert.deepEqual(store.reorder([last.RuleId, heading.RuleId, first.RuleId, second.RuleId])
      .map((item) => item.RuleId), [last.RuleId, heading.RuleId, first.RuleId, second.RuleId]);
    assert.throws(() => store.reorder([first.RuleId, first.RuleId, heading.RuleId, last.RuleId]),
      { code: 'RULE_ORDER_CONFLICT' });
    assert.deepEqual(new SiteRulesStore(db).list().map((item) => item.RuleId),
      [last.RuleId, heading.RuleId, first.RuleId, second.RuleId]);
  } finally {
    db.close();
  }
});

test('embedded headers become standalone items before their former rules', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE SiteRules (
      RuleId INTEGER PRIMARY KEY AUTOINCREMENT,
      RuleHeader TEXT NOT NULL DEFAULT '',
      RuleText TEXT NOT NULL,
      SortOrder INTEGER NOT NULL
    );
    INSERT INTO SiteRules (RuleHeader, RuleText, SortOrder) VALUES ('First section', 'First rule', 1);
    INSERT INTO SiteRules (RuleText, SortOrder) VALUES ('Second rule', 2);
    INSERT INTO SiteRules (RuleHeader, RuleText, SortOrder) VALUES ('Next section', 'Third rule', 3);`);
    const store = new SiteRulesStore(db);
    assert.deepEqual(store.list().map((item) => [item.ItemType, item.RuleText]), [
      ['header', 'First section'], ['rule', 'First rule'], ['rule', 'Second rule'],
      ['header', 'Next section'], ['rule', 'Third rule'],
    ]);
    assert.deepEqual(new SiteRulesStore(db).list().map((item) => item.RuleText),
      ['First section', 'First rule', 'Second rule', 'Next section', 'Third rule']);
  } finally {
    db.close();
  }
});

test('rules in the original schema receive the new type', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE SiteRules (RuleId INTEGER PRIMARY KEY AUTOINCREMENT, RuleText TEXT NOT NULL, SortOrder INTEGER NOT NULL);
      INSERT INTO SiteRules (RuleText, SortOrder) VALUES ('Existing rule', 1);`);
    const store = new SiteRulesStore(db);
    assert.deepEqual(store.list().map((item) => [item.ItemType, item.RuleText]), [['rule', 'Existing rule']]);
  } finally {
    db.close();
  }
});
