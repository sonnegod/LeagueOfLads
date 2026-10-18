import { openSync, closeSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeItemCatalogs, normalizeDotaItems, selectItemCatalog } from '../../config/dotaItemCatalog.js';

export const ITEM_SOURCE = 'https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json';
const snapshotDefault = fileURLToPath(new URL('../../client/src/data/dotaItems.json', import.meta.url));
const generatedDefault = fileURLToPath(new URL('../../client/src/data/dotaItems.generated.json', import.meta.url));
const MAX_BYTES = 8 * 1024 * 1024;

export async function refreshDotaItems({ snapshotPath = snapshotDefault, generatedPath = generatedDefault,
  fetchImpl = fetch, log = console.log, warn = console.warn, minItems = 250 } = {}) {
  const current = selectItemCatalog(snapshotPath, generatedPath, warn);
  const tempPath = `${generatedPath}.${process.pid}.tmp`;
  let tempWritten = false;
  try {
    const response = await fetchImpl(ITEM_SOURCE, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Item source returned HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Item source response is too large');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw new Error('Item source response is too large');
      chunks.push(chunk);
    }
    const skipped = [];
    const incoming = normalizeDotaItems(JSON.parse(Buffer.concat(chunks).toString('utf8')), { minItems, onSkip: key => skipped.push(key) });
    if (skipped.length) log(`Skipped ${skipped.length} unnamed internal item entries; existing mappings are preserved.`);
    const { catalog, conflicts } = mergeItemCatalogs(current.catalog, incoming);
    if (conflicts.length) warn(`Preserved ${conflicts.length} existing item IDs with conflicting upstream identities: ${conflicts.join(', ')}`);
    if (current.path === generatedPath && JSON.stringify(catalog) === JSON.stringify(current.catalog)) {
      log(`Dota item catalog unchanged: ${Object.keys(catalog).length} items.`);
      return { status: 'unchanged', count: Object.keys(catalog).length, conflicts };
    }
    // A failed download or interrupted write must not replace the last good file.
    const fd = openSync(tempPath, 'wx');
    tempWritten = true;
    try { writeFileSync(fd, JSON.stringify(catalog) + '\n'); } finally { closeSync(fd); }
    renameSync(tempPath, generatedPath);
    tempWritten = false;
    log(`Dota item catalog refreshed: ${Object.keys(catalog).length} items (${Object.keys(incoming).length} upstream; historical items preserved).`);
    return { status: 'updated', count: Object.keys(catalog).length, conflicts };
  } catch (error) {
    warn(`Dota item refresh skipped: ${error.message}. Keeping ${Object.keys(current.catalog).length} existing items; build can continue.`);
    return { status: 'fallback', count: Object.keys(current.catalog).length, error: error.message };
  } finally {
    if (tempWritten) { try { unlinkSync(tempPath); } catch {} }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshDotaItems().catch(error => { console.error(`No usable Dota item catalog: ${error.message}`); process.exitCode = 1; });
}
