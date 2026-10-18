import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateItemCatalog, normalizeDotaItems, mergeItemCatalogs, selectItemCatalog } from '../config/dotaItemCatalog.js';
import { refreshDotaItems } from '../scripts/assets/refreshDotaItems.js';

const item = (key, name = key) => ({ key, name, image: `/apps/dota2/images/dota_react/items/${key}.png` });
const sourceItem = (id, key, name = key) => ({ id, dname: name, img: item(key).image, unused: { abilities: 'not bundled' } });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lads-item-catalog-'));
  const snapshotPath = join(dir, 'snapshot.json'), generatedPath = join(dir, 'generated.json');
  const snapshot = { 1: item('blink', 'Blink Dagger'), 2: item('retired_item') };
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  return { dir, snapshot, snapshotPath, generatedPath, minItems: 1, log: () => {}, warn: () => {} };
}

test('upstream catalogs normalize to the frontend contract and reject corrupt or unsafe metadata', () => {
  const data = normalizeDotaItems({ blink: sourceItem(1, 'blink') }, { minItems: 1 });
  assert.deepEqual(data, { 1: item('blink') });
  const skipped = [];
  assert.deepEqual(normalizeDotaItems({ blink: sourceItem(1, 'blink'), internal: { id: 99, img: item('internal').image } },
    { minItems: 1, onSkip: key => skipped.push(key) }), data);
  assert.deepEqual(skipped, ['internal']);
  assert.throws(() => normalizeDotaItems({ blink: sourceItem(1, 'blink') }), /size/);
  assert.throws(() => normalizeDotaItems({ blink: sourceItem(1, 'blink'), other: sourceItem(1, 'other') }, { minItems: 1 }), /duplicate/);
  assert.throws(() => normalizeDotaItems({ blink: { id: 1, dname: 'Blink', img: 'https://example.com/image.png' } }, { minItems: 1 }), /Invalid/);
  assert.throws(() => normalizeDotaItems({ blink: { ...sourceItem(1, 'blink'), dname: null } }, { minItems: 1 }), /Invalid/);
  assert.throws(() => validateItemCatalog([]));
  assert.doesNotThrow(() => validateItemCatalog(JSON.parse(readFileSync(new URL('../client/src/data/dotaItems.json', import.meta.url), 'utf8'))));
});

test('refresh preserves retired items, stable identities and the tracked snapshot, and publishes valid additions', async () => {
  const f = fixture();
  try {
    const original = readFileSync(f.snapshotPath, 'utf8');
    writeFileSync(f.generatedPath, JSON.stringify({ ...f.snapshot, 3: item('older_neutral') }));
    const fetchImpl = async () => Response.json({ blink: sourceItem(1, 'blink', 'Updated Blink'), new_item: sourceItem(4, 'new_item') });
    const report = await refreshDotaItems({ ...f, fetchImpl });
    assert.equal(report.status, 'updated');
    const catalog = JSON.parse(readFileSync(f.generatedPath, 'utf8'));
    assert.equal(catalog[1].name, 'Updated Blink');assert.equal(catalog[2].key, 'retired_item');
    assert.equal(catalog[3].key, 'older_neutral');assert.equal(catalog[4].key, 'new_item');
    assert.equal(readFileSync(f.snapshotPath, 'utf8'), original);
    assert.equal(selectItemCatalog(f.snapshotPath, f.generatedPath).path, f.generatedPath);
    assert.equal((await refreshDotaItems({ ...f, fetchImpl })).status, 'unchanged');
    const conflict = mergeItemCatalogs(catalog, { 1: item('different_identity'), 5: item('addition') });
    assert.deepEqual(conflict.conflicts, ['1']);assert.equal(conflict.catalog[1].key, 'blink');
    assert.equal(conflict.catalog[5].key, 'addition');
    assert.ok(!readdirSync(f.dir).some(name => name.endsWith('.tmp')));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('source outages, bad JSON and changed schemas retain the last usable catalog byte for byte', async () => {
  const f = fixture();
  try {
    const saved = JSON.stringify({ ...f.snapshot, 3: item('previous_new_item') });
    writeFileSync(f.generatedPath, saved);
    for (const fetchImpl of [
      async () => { throw new Error('Network unavailable'); },
      async () => new Response('Server error', { status: 500 }),
      async () => new Response('{invalid'),
      async () => Response.json({ changed: { value: 1 } }),
      async () => new Response('', { headers: { 'content-length': String(9 * 1024 * 1024) } }),
    ]) {
      const result = await refreshDotaItems({ ...f, fetchImpl });
      assert.equal(result.status, 'fallback');assert.equal(readFileSync(f.generatedPath, 'utf8'), saved);
      assert.equal(selectItemCatalog(f.snapshotPath, f.generatedPath).path, f.generatedPath);
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('build selects the bundled fallback when generated data is absent, corrupt or remaps historical IDs', async () => {
  const f = fixture();
  try {
    assert.equal(selectItemCatalog(f.snapshotPath, f.generatedPath).path, f.snapshotPath);
    assert.equal((await refreshDotaItems({ ...f, fetchImpl: async () => { throw new Error('offline'); } })).status, 'fallback');
    for (const invalid of ['broken', JSON.stringify({ 1: item('new_identity') }), JSON.stringify({ 1: item('blink') })]) {
      writeFileSync(f.generatedPath, invalid);
      assert.equal(selectItemCatalog(f.snapshotPath, f.generatedPath).path, f.snapshotPath);
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
