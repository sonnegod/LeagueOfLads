import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { configureWarehouseConnection, checkpointWarehouse, withSqliteBusyRetry,
  sqliteSupportsConcurrentWal, isSqliteBusy } from '../config/warehouseConnection.js';

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'lads-wal-test-')), path = join(folder, 'test.db');
  const site = new Database(path);
  configureWarehouseConnection(site);
  site.exec('CREATE TABLE Records (Id INTEGER PRIMARY KEY,Value TEXT); INSERT INTO Records VALUES (1,\'original\')');
  const background = new Database(path);
  configureWarehouseConnection(background, {role:'background'});
  return { site, background, path, close() {
    for (const db of [site,background]) {
      if (db.inTransaction) db.exec('ROLLBACK');
      if (db.open) db.close();
    }
    const target = resolve(folder), root = resolve(tmpdir());
    if (!target.startsWith(root + sep) || !target.split(sep).at(-1).startsWith('lads-wal-test-')) throw new Error('Unsafe temp path');
    rmSync(target, {recursive:true,force:true});
  } };
}

test('warehouse WAL configuration retains durability and applies per-connection lock timeouts', () => {
  const f = fixture();
  try {
    assert.equal(sqliteSupportsConcurrentWal(f.site.prepare('SELECT sqlite_version() version').get().version),true);
    assert.equal(sqliteSupportsConcurrentWal('3.49.2'),false);
    assert.equal(sqliteSupportsConcurrentWal('3.51.2'),false);
    assert.equal(f.site.pragma('journal_mode',{simple:true}),'wal');
    assert.equal(f.site.pragma('synchronous',{simple:true}),2);
    assert.equal(f.background.pragma('synchronous',{simple:true}),2);
    assert.equal(f.site.pragma('busy_timeout',{simple:true}),500);
    assert.equal(f.background.pragma('busy_timeout',{simple:true}),100);
    assert.equal(f.background.pragma('wal_autocheckpoint',{simple:true}),1000);
    f.site.exec('BEGIN');
    assert.throws(()=>configureWarehouseConnection(f.site),/before starting a transaction/);
    f.site.exec('ROLLBACK');
  } finally { f.close(); }
});

test('site reads continue while background writes are uncommitted, then observe committed data', () => {
  const f = fixture();
  try {
    f.background.exec("BEGIN IMMEDIATE; UPDATE Records SET Value='updated' WHERE Id=1");
    assert.equal(f.site.prepare('SELECT Value FROM Records').get().Value,'original');
    f.background.exec('COMMIT');
    assert.equal(f.site.prepare('SELECT Value FROM Records').get().Value,'updated');
  } finally { f.close(); }
});

test('background commits continue during a site read snapshot and passive checkpoints yield to readers', () => {
  const f = fixture();
  try {
    f.site.exec('BEGIN');
    assert.equal(f.site.prepare('SELECT Value FROM Records').get().Value,'original');
    f.background.exec("UPDATE Records SET Value='updated' WHERE Id=1");
    assert.equal(f.site.prepare('SELECT Value FROM Records').get().Value,'original');
    const checkpoint = checkpointWarehouse(f.background);
    assert.ok(checkpoint.log > checkpoint.checkpointed);
    f.site.exec('COMMIT');
    assert.equal(f.site.prepare('SELECT Value FROM Records').get().Value,'updated');
    const finished = checkpointWarehouse(f.background);
    assert.equal(finished.log,finished.checkpointed);
    assert.equal(f.site.pragma('integrity_check',{simple:true}),'ok');
  } finally { f.close(); }
});

test('background lock retries yield to the event loop and finish after the site releases its write lock', async () => {
  const f = fixture(); let timer;
  try {
    f.site.exec("BEGIN IMMEDIATE; UPDATE Records SET Value='site edit' WHERE Id=1");
    let attempts = 0;
    timer = setTimeout(()=>f.site.exec('COMMIT'),1);
    await withSqliteBusyRetry(()=>{
      attempts++;
      f.background.prepare("INSERT INTO Records VALUES (2,'background import')").run();
    },{attempts:3,delayMs:10});
    assert.equal(attempts,2);
    assert.deepEqual(f.site.prepare('SELECT Value FROM Records ORDER BY Id').all().map(r=>r.Value),['site edit','background import']);
  } finally { clearTimeout(timer); f.close(); }
});

test('retries stop after their limit and do not retry data errors', async () => {
  const f = fixture();
  try {
    f.site.exec('BEGIN IMMEDIATE');
    let attempts = 0;
    await assert.rejects(withSqliteBusyRetry(()=>{
      attempts++;
      f.background.prepare("INSERT INTO Records VALUES (2,'blocked')").run();
    },{attempts:2,delayMs:1}),isSqliteBusy);
    assert.equal(attempts,2);
    f.site.exec('ROLLBACK');
    attempts=0;
    await assert.rejects(withSqliteBusyRetry(()=>{
      attempts++;
      f.background.prepare("INSERT INTO Records VALUES (1,'duplicate')").run();
    },{attempts:3,delayMs:1}),/UNIQUE/);
    assert.equal(attempts,1);
    assert.equal(f.site.prepare('SELECT COUNT(*) n FROM Records').get().n,1);
  } finally { f.close(); }
});

test('readonly configuration does not change the database journal mode', () => {
  const folder = mkdtempSync(join(tmpdir(),'lads-wal-test-')), path = join(folder,'readonly.db');
  const writer = new Database(path); writer.exec('CREATE TABLE Records (Id INTEGER)');
  const reader = new Database(path,{readonly:true,fileMustExist:true});
  try {
    assert.equal(writer.pragma('journal_mode',{simple:true}),'delete');
    const result = configureWarehouseConnection(reader,{role:'readonly'});
    assert.equal(result.journalMode,'delete');
    assert.equal(writer.pragma('journal_mode',{simple:true}),'delete');
    assert.equal(checkpointWarehouse(reader),null);
  } finally {
    reader.close(); writer.close();
    const target=resolve(folder), root=resolve(tmpdir());
    if (!target.startsWith(root+sep) || !target.split(sep).at(-1).startsWith('lads-wal-test-')) throw new Error('Unsafe temp path');
    rmSync(target,{recursive:true,force:true});
  }
});
