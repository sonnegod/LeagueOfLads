import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRuleItems } from '../client/src/utils/ruleSearch.js';

const items = [
  { RuleId: 1, ItemType: 'rule', RuleText: 'General rule' },
  { RuleId: 2, ItemType: 'header', RuleText: 'Match conduct' },
  { RuleId: 3, ItemType: 'rule', RuleText: 'Play fairly' },
  { RuleId: 4, ItemType: 'rule', RuleText: 'Report match issues' },
  { RuleId: 5, ItemType: 'header', RuleText: 'Accounts' },
  { RuleId: 6, ItemType: 'rule', RuleText: 'One account per player' },
];

test('rule search keeps the parent header with matching rules', () => {
  assert.deepEqual(filterRuleItems(items, 'fair').map((item) => item.RuleId), [2, 3]);
  assert.deepEqual(filterRuleItems(items, 'general').map((item) => item.RuleId), [1]);
});

test('matching a header shows all of its rules', () => {
  assert.deepEqual(filterRuleItems(items, 'MATCH CONDUCT').map((item) => item.RuleId), [2, 3, 4]);
  assert.deepEqual(filterRuleItems(items, ' account ').map((item) => item.RuleId), [5, 6]);
  assert.deepEqual(filterRuleItems(items, '').map((item) => item.RuleId), [1, 2, 3, 4, 5, 6]);
});
