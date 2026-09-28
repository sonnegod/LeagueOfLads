import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import SiteRulesStore from '../../config/siteRulesStore.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(scriptDir, 'lads-rulebook-2024.txt');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const paths = args.filter((arg) => !arg.startsWith('--'));
if (paths.length > 1 || args.some((arg) => arg.startsWith('--') && arg !== '--apply')) {
  console.error('Usage: node scripts/db/importRulebook2024.js [existing-LadsData.db] [--apply]');
  process.exit(1);
}
const dbPath = path.resolve(paths[0] ?? path.join(scriptDir, '../../db/LadsData.db'));

function clean(text) {
  return text.replace(/\u00a0/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function comparable(text) {
  return clean(text).toLocaleLowerCase().replace(/[–—-]\s*$/u, '')
    .replace(/[.]\s*$/u, '').replace(/\s+/g, ' ').trim();
}

function parseRulebook(source) {
  const entries = [];
  const sectionPattern = /^(Players\/Team\/Standins|Format\/Groups\/Playoffs|Lobby\/Game Info|Tardiness\/Penalties|Casting|Changelog)\s*[–-]\s*$/u;
  const lines = source.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const section = line.match(sectionPattern);
    if (section) {
      entries.push({ itemType: 'header', text: section[1] });
    } else if (line === 'Lads Rulebook') {
      entries.push({ itemType: 'header', text: line });
    } else if (line === '- Playoffs Promotional Program:') {
      entries.push({ itemType: 'header', text: 'Playoffs Promotional Program' });
    } else if (/^\d+\.\s/u.test(line)) {
      const previous = entries.at(-1);
      if (!previous || previous.itemType !== 'rule') throw new Error(`Unexpected numbered item: ${line}`);
      previous.text += `\n${clean(line)}`;
    } else if (/^-\s/u.test(line)) {
      entries.push({ itemType: 'rule', text: clean(line.replace(/^-\s*/u, '')) });
    } else if (line.startsWith('your neustadtl score')) {
      entries.at(-1).text += ` ${clean(line)}`;
    } else {
      entries.push({ itemType: 'rule', text: clean(line.replace(/^\*/, '')) });
    }
  }
  if (entries.some(({ text }) => !text || text.length > 2000)) throw new Error('A parsed rule is empty or too long');
  return entries;
}

const entries = parseRulebook(fs.readFileSync(sourcePath, 'utf8'));
const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
try {
  const backupPath = apply
    ? `${dbPath}.rules-before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
    : null;
  if (backupPath) await db.backup(backupPath);
  const store = apply ? new SiteRulesStore(db) : null;
  const hasSiteRules = db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', 'SiteRules');
  let unmatched = store?.list() ?? [];
  if (!store && hasSiteRules) {
    const columns = db.prepare('PRAGMA table_info(SiteRules)').all().map((column) => column.name);
    const itemType = columns.includes('ItemType') ? 'ItemType' : "'rule' AS ItemType";
    const ruleHeader = columns.includes('RuleHeader') ? 'RuleHeader' : "'' AS RuleHeader";
    const rows = db.prepare(`SELECT RuleId, RuleText, ${itemType}, ${ruleHeader}, SortOrder
      FROM SiteRules ORDER BY SortOrder, RuleId`).all();
    unmatched = rows.flatMap((row) => row.RuleHeader
      ? [{ RuleId: -row.RuleId, ItemType: 'header', RuleText: row.RuleHeader }, row]
      : [row]);
  }
  const plan = entries.map((entry) => {
    const index = unmatched.findIndex((row) => row.ItemType === entry.itemType &&
      comparable(row.RuleText) === comparable(entry.text));
    const existing = index < 0 ? null : unmatched.splice(index, 1)[0];
    return { ...entry, existingId: existing?.RuleId ?? null };
  });
  const additions = plan.filter((entry) => entry.existingId === null);
  console.log(JSON.stringify({ database: dbPath, total: plan.length,
    existing: plan.length - additions.length, add: additions.length,
    unmatchedExisting: unmatched.length,
    ...(!apply && { additions: additions.map(({ itemType, text }) => ({ itemType, text })) }) }, null, 2));
  if (apply) {
    db.transaction(() => {
      const orderedIds = plan.map((entry) => entry.existingId ?? store.add(entry.text, entry.itemType).RuleId);
      orderedIds.push(...unmatched.map((row) => row.RuleId));
      store.reorder(orderedIds);
    })();
    console.log(`Imported ${additions.length} items into ${dbPath}. Backup: ${backupPath}`);
  }
} finally {
  db.close();
}
