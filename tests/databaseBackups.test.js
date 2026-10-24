import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const execute = promisify(execFile);
let bash = process.platform === 'win32' ? null : '/bin/bash';
if (!bash) {
  try {
    const gitRoot = resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).trim(), '../../..');
    const candidate = join(gitRoot, 'bin', 'bash.exe');
    if (existsSync(candidate)) bash = candidate;
  } catch {}
}
const hasFlock = bash && (() => {
  try { execFileSync(bash, ['-c', 'command -v flock'], { windowsHide: true }); return true; }
  catch { return false; }
})();
const names = ['LadsData', 'Betting', 'public', 'Analytics', 'SiteAnalytics'];
const slash = value => value.replaceAll('\\', '/');

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'lads-backups-'));
  try {
    mkdirSync(join(root, 'scripts', 'db'), { recursive: true });
    mkdirSync(join(root, 'db'));
    mkdirSync(join(root, 'bin'));
    const script = join(root, 'scripts', 'db', 'backupDatabases.sh');
    copyFileSync(resolve('scripts/db/backupDatabases.sh'), script);
    for (const name of names) writeFileSync(join(root, 'db', `${name}.db`), `snapshot of ${name}`);
    const shim = (name, content) => writeFileSync(join(root, 'bin', name), content, { mode: 0o755 });
    shim('date', '#!/bin/bash\nprintf "%s_120000\\n" "$BACKUP_TEST_DAY"\n');
    // Exercise shell policy without requiring the SQLite CLI or real site data.
    shim('sqlite3', String.raw`#!/bin/bash
set -eu
destination="$(printf '%s' "$2" | sed "s/^\.backup '//; s/'$//")"
if [ "$BACKUP_TEST_DELAY" = yes ]; then sleep 0.1; fi
if [ "$BACKUP_TEST_FAIL" = "$(basename "$1" .db)" ]; then
    printf partial > "$destination"
    exit 1
fi
cp -- "$1" "$destination"
`);
    // Git Bash has no flock. Sequential policy tests still run there; the
    // overlap test below requires the real Linux command and never uses this shim.
    if (!hasFlock) shim('flock', '#!/bin/bash\nexit 0\n');
    const invoke = (target = 'all', overrides = {}) => execute(bash, [
      '-c', 'export PATH="$(cd "$BACKUP_TEST_BIN" && pwd):$PATH"; exec bash "$@"', 'backup-test', slash(script), target,
    ], {
      windowsHide: true,
      env: { ...process.env, BACKUP_TEST_BIN: slash(join(root, 'bin')), BACKUP_RETENTION_DAYS: '3', BACKUP_TEST_DAY: '20261023', BACKUP_TEST_DELAY: '', BACKUP_TEST_FAIL: '', ...overrides },
    });
    const backups = name => {
      const directory = join(root, 'backups', name);
      return existsSync(directory) ? readdirSync(directory).filter(file => file.endsWith('.db')) : [];
    };
    const seed = (name, file, content = 'existing backup') => {
      const directory = join(root, 'backups', name);
      mkdirSync(directory, { recursive: true });
      const path = join(directory, file);
      writeFileSync(path, content);
      return path;
    };
    await run({ root, invoke, backups, seed });
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw Error('Unexpected cleanup target');
    rmSync(root, { recursive: true, force: true });
  }
}

test('all databases keep one snapshot per day across deployment and nightly calls', { skip: !bash }, async () => {
  await fixture(async ({ root, invoke, backups }) => {
    await invoke();
    for (const name of names) writeFileSync(join(root, 'db', `${name}.db`), 'changed after first backup');
    const second = await invoke();
    for (const name of names) {
      assert.deepEqual(backups(name), [`${name}_20261023.db`]);
      assert.equal(readFileSync(join(root, 'backups', name, `${name}_20261023.db`), 'utf8'), `snapshot of ${name}`);
      assert.match(second.stdout, new RegExp(`Skipping ${name}: today's backup already exists`));
    }
    await invoke('Betting');
    const tomorrow = await invoke('all', { BACKUP_TEST_DAY: '20261024' });
    for (const name of names) assert.deepEqual(backups(name), [`${name}_20261023.db`, `${name}_20261024.db`], tomorrow.stdout);
  });
});

test('legacy timestamped backups count for today while empty or older files do not', { skip: !bash }, async () => {
  await fixture(async ({ invoke, backups, seed }) => {
    seed('Betting', 'Betting_20261023_050000.db');
    seed('public', 'public_20261022_050000.db');
    seed('Analytics', 'Analytics_20261023.db', '');
    await invoke();
    assert.deepEqual(backups('Betting'), ['Betting_20261023_050000.db']);
    assert.deepEqual(backups('public'), ['public_20261022_050000.db', 'public_20261023.db']);
    assert.deepEqual(backups('Analytics'), ['Analytics_20261023.db']);
  });
});

test('failed backup removes its partial file and can retry; expired files are pruned first', { skip: !bash }, async () => {
  await fixture(async ({ root, invoke, backups, seed }) => {
    const expired = seed('LadsData', 'LadsData_20261001_050000.db');
    const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    utimesSync(expired, old, old);
    await assert.rejects(invoke('Betting', { BACKUP_TEST_FAIL: 'Betting' }));
    assert.equal(existsSync(expired), false);
    assert.deepEqual(readdirSync(join(root, 'backups', 'Betting')), []);
    await invoke('Betting');
    assert.deepEqual(backups('Betting'), ['Betting_20261023.db']);
    await assert.rejects(invoke('Analytics', { BACKUP_RETENTION_DAYS: '0' }));
    assert.deepEqual(backups('Analytics'), []);
  });
});

test('prune applies a one-time override without creating backups or changing the default', { skip: !bash }, async () => {
  await fixture(async ({ invoke, backups, seed }) => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    for (const name of names) utimesSync(seed(name, `${name}_20261021.db`), old, old);
    await invoke('prune');
    for (const name of names) assert.deepEqual(backups(name), [`${name}_20261021.db`]);
    await invoke('prune', { BACKUP_RETENTION_DAYS: '1' });
    for (const name of names) assert.deepEqual(backups(name), []);
    await invoke();
    for (const name of names) assert.deepEqual(backups(name), [`${name}_20261023.db`]);
  });
});

test('overlapping backup processes create only one completed snapshot per database', { skip: !hasFlock }, async () => {
  await fixture(async ({ invoke, backups }) => {
    const results = await Promise.all([invoke('all', { BACKUP_TEST_DELAY: 'yes' }), invoke('all', { BACKUP_TEST_DELAY: 'yes' })]);
    const output = results.map(result => result.stdout).join('\n');
    assert.equal((output.match(/^Created /gm) || []).length, names.length);
    for (const name of names) assert.deepEqual(backups(name), [`${name}_20261023.db`]);
  });
});
