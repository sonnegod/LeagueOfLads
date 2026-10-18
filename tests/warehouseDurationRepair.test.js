import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { planWarehouseDurationRepair, applyWarehouseDurationRepair } from '../config/warehouseDurationRepair.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,Duration INTEGER,Rehost INTEGER,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER);
    CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER);
    CREATE TABLE MatchSourceResponses(MatchId INTEGER PRIMARY KEY,Encoding TEXT,SourceHash TEXT,GameplayData BLOB);`);
  for (let id = 1; id <= 10; id++) {
    db.prepare('INSERT INTO MatchTeam VALUES(?,?,0,100,200,200)').run(id, id === 2 ? 0 : id === 3 ? 1800 : null);
    db.prepare('INSERT INTO MatchLeague VALUES(?,?)').run(id, id === 4 ? 21 : 20);
  }
  const save = (id, data) => {
    const bytes = Buffer.from(JSON.stringify(data));
    db.prepare('INSERT OR REPLACE INTO MatchSourceResponses VALUES(?,\'gzip\',?,?)')
      .run(id, createHash('sha256').update(bytes).digest('hex'), gzipSync(bytes));
  };
  for (const id of [1,2,3,4,6,7,8,9,10]) save(id, { match_id: id, duration: 2400 });
  save(6, { match_id: 600, duration: 2400 });
  save(7, { match_id: 7, duration: 0 });
  db.exec("UPDATE MatchSourceResponses SET SourceHash='wrong' WHERE MatchId=8; UPDATE MatchTeam SET Rehost=1 WHERE MatchId=9; UPDATE MatchTeam SET TeamDire=100 WHERE MatchId=10;");
  return { db, save };
}

test('duration recovery previews verified saved responses, preserves valid durations and scopes seasons', () => {
  const { db } = fixture();
  try {
    const before = db.prepare('SELECT * FROM MatchTeam').all();
    const plan = planWarehouseDurationRepair(db);
    assert.equal(plan.missing, 7);
    assert.equal(plan.repairable, 3);
    assert.equal(plan.withoutSource, 1);
    assert.deepEqual(plan.problems.map(p => p.matchId), [6,7,8]);
    assert.deepEqual(plan.candidates.map(c => c.matchId), [1,2,4]);
    assert.deepEqual(planWarehouseDurationRepair(db, { leagueId: 21 }).candidates.map(c => c.matchId), [4]);
    assert.deepEqual(db.prepare('SELECT * FROM MatchTeam').all(), before, 'preview performs no writes');
    assert.throws(() => planWarehouseDurationRepair(db, { leagueId: 0 }), /Invalid league/);
  } finally { db.close(); }
});

test('duration recovery changes only missing durations and is safe to rerun', () => {
  const { db } = fixture();
  try {
    const before = db.prepare('SELECT * FROM MatchTeam').all(), sources = db.prepare('SELECT * FROM MatchSourceResponses').all();
    const result = applyWarehouseDurationRepair(db, planWarehouseDurationRepair(db));
    assert.deepEqual(result.repaired.map(r => r.matchId), [1,2,4]);
    assert.deepEqual(db.prepare('SELECT * FROM MatchTeam').all(), before.map(row => [1,2,4].includes(row.MatchId) ? { ...row, Duration: 2400 } : row));
    assert.deepEqual(db.prepare('SELECT * FROM MatchSourceResponses').all(), sources);
    assert.equal(planWarehouseDurationRepair(db).repairable, 0);
  } finally { db.close(); }
});

test('duration recovery respects concurrent admin edits and source updates', () => {
  const { db, save } = fixture();
  try {
    const plan = planWarehouseDurationRepair(db);
    db.exec('UPDATE MatchTeam SET Duration=1200 WHERE MatchId=1');
    save(2, { match_id: 2, duration: 2500 });
    const result = applyWarehouseDurationRepair(db, plan);
    assert.deepEqual(result.skipped.map(r => r.matchId), [1,2]);
    assert.deepEqual(result.repaired.map(r => r.matchId), [4]);
    assert.equal(db.prepare('SELECT Duration FROM MatchTeam WHERE MatchId=1').get().Duration, 1200);
  } finally { db.close(); }
});

test('duration repair CLI previews without writes and backs up before applying', async () => {
  const { db } = fixture(), folder = mkdtempSync(join(tmpdir(), 'lads-duration-test-'));
  const filename = join(folder, 'warehouse.db');
  try {
    await db.backup(filename);
    const script = fileURLToPath(new URL('../scripts/db/repairWarehouseDurations.js', import.meta.url));
    const preview = spawnSync(process.execPath, [script, filename], { encoding: 'utf8' });
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /"repairable": 3/);
    assert.equal(readdirSync(folder).some(name => name.endsWith('.bak')), false);
    const applied = spawnSync(process.execPath, [script, filename, '--apply'], { encoding: 'utf8' });
    assert.equal(applied.status, 0, applied.stderr);
    const files = readdirSync(folder), backup = files.find(name => name.endsWith('.bak'));
    assert.ok(backup);
    const original = new Database(join(folder, backup), { readonly: true, fileMustExist: true });
    const repaired = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      assert.equal(original.prepare('SELECT Duration FROM MatchTeam WHERE MatchId=1').get().Duration, null);
      assert.equal(repaired.prepare('SELECT Duration FROM MatchTeam WHERE MatchId=1').get().Duration, 2400);
    } finally { original.close(); repaired.close(); }
    const report = JSON.parse(readFileSync(join(folder, files.find(name => name.endsWith('.json'))), 'utf8'));
    assert.equal(report.status, 'complete');
    assert.equal(report.repaired.length, 3);
  } finally {
    db.close();
    const tempRoot = resolve(tmpdir()) + sep, target = resolve(folder);
    if (!target.startsWith(tempRoot) || !target.split(sep).at(-1).startsWith('lads-duration-test-')) throw new Error('Unexpected cleanup path');
    rmSync(target, { recursive: true, force: true });
  }
});
