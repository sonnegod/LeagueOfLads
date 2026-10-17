import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { patchReportingStart } from '../shared/patchCalendar.js';
import { seedWarehousePatches } from '../config/warehousePatches.js';

test('EDW patch reporting starts at 1am New York across winter, summer and DST transitions', () => {
  for (const [release, expected] of [
    ['2026-01-15T08:00:00Z', '2026-01-15T06:00:00.000Z'],
    ['2026-07-15T07:00:00Z', '2026-07-15T05:00:00.000Z'],
    ['2026-03-08T08:00:00Z', '2026-03-08T06:00:00.000Z'],
    ['2026-11-01T07:00:00Z', '2026-11-01T05:00:00.000Z'],
  ]) {
    assert.equal(patchReportingStart(release), expected);
    assert.equal(patchReportingStart(Date.parse(release)), expected);
  }
});

test('EDW patch calendar seeds 1am cutoffs with stable independent IDs on repeated initialization', () => {
  const db = new Database(':memory:');
  try {
    seedWarehousePatches(db);
    const before = db.prepare('SELECT * FROM Patches ORDER BY PatchId').all();
    const patch = before.find(row => row.PatchKey === '7.39');
    assert.equal(patch.StartsAt,'2025-05-22T05:00:00.000Z');
    assert.ok(Number.isSafeInteger(patch.PatchId));
    seedWarehousePatches(db);
    assert.deepEqual(db.prepare('SELECT * FROM Patches ORDER BY PatchId').all(),before);
  } finally { db.close(); }
});
