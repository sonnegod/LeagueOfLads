import { readFileSync } from 'node:fs';

const record = value => value != null && typeof value === 'object' && !Array.isArray(value);
const imagePath = /^\/apps\/dota2\/images\/(?:dota_react\/items|items)\/[a-z0-9_]+\.(?:png|webp|jpg)(?:\?[^\s#]*)?$/;

export function validateItemCatalog(catalog, { minItems = 1 } = {}) {
  if (!record(catalog) || Object.keys(catalog).length < minItems || Object.keys(catalog).length > 10000) {
    throw new Error('Item catalog has an unexpected size or format');
  }
  for (const [id, item] of Object.entries(catalog)) {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !record(item)
      || typeof item.key !== 'string' || !/^[a-z0-9_]{1,120}$/.test(item.key)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 || /[\x00-\x1f]/.test(item.name)
      || typeof item.image !== 'string' || !imagePath.test(item.image)) {
      throw new Error(`Invalid item catalog entry ${id}`);
    }
  }
  return catalog;
}

export function normalizeDotaItems(source, { minItems = 250, onSkip = () => {} } = {}) {
  if (!record(source)) throw new Error('Upstream item data is not an object');
  const catalog = {}, seenIds = new Set();
  for (const [key, item] of Object.entries(source)) {
    if (!record(item) || !Number.isSafeInteger(item.id) || item.id <= 0 || seenIds.has(item.id)) {
      throw new Error(`Missing or duplicate item ID for ${key}`);
    }
    seenIds.add(item.id);
    // The source also contains unnamed internal/unused entries, not UI items.
    if (!Object.hasOwn(item, 'dname')) { onSkip(key); continue; }
    catalog[item.id] = { key, name: item.dname, image: item.img };
  }
  return validateItemCatalog(catalog, { minItems });
}

export function mergeItemCatalogs(existing, incoming) {
  validateItemCatalog(existing); validateItemCatalog(incoming);
  const catalog = { ...existing }, conflicts = [];
  for (const [id, item] of Object.entries(incoming)) {
    // Never silently relabel an old match's item if an ID changes identity.
    if (catalog[id] && catalog[id].key !== item.key) { conflicts.push(id); continue; }
    catalog[id] = { key: item.key, name: item.name, image: item.image };
  }
  return { catalog, conflicts };
}

export function selectItemCatalog(snapshotPath, generatedPath, warn = () => {}) {
  const snapshot = validateItemCatalog(JSON.parse(readFileSync(snapshotPath, 'utf8')));
  try {
    const generated = validateItemCatalog(JSON.parse(readFileSync(generatedPath, 'utf8')));
    if (Object.entries(snapshot).some(([id, item]) => generated[id]?.key !== item.key)) {
      throw new Error('Generated catalog is missing or remapping bundled item IDs');
    }
    return { path: generatedPath, catalog: generated };
  } catch (error) {
    if (error.code !== 'ENOENT') warn(`Using bundled item catalog: ${error.message}`);
    return { path: snapshotPath, catalog: snapshot };
  }
}
