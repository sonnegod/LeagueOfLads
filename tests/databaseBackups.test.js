import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

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
const sqliteCli = process.env.BACKUP_TEST_SQLITE_CLI || 'sqlite3';
const hasSqliteCli = (() => {
  try {execFileSync(sqliteCli, ['-version'], {windowsHide:true}); return true;} catch {return false;}
})();

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
source="$4"
sql="$(cat)"
destination="$(printf '%s\n' "$sql" | sed -n "s/^\.backup '\(.*\)'$/\1/p")"
if [ -n "$BACKUP_TEST_REAL_SQLITE" ]; then
    if command -v cygpath >/dev/null; then
        native_dest="$(cygpath -m "$destination")"
        sql="$(printf '%s\n' "$sql" | sed "s@^\.backup .*@.backup '$native_dest'@")"
        source="$(cygpath -m "$source")"
    fi
    printf '%s\n' "$sql" | "$BACKUP_TEST_REAL_SQLITE" -readonly -batch -bail "$source"
    exit $?
fi
if [ "$BACKUP_TEST_DELAY" = yes ]; then sleep 0.1; fi
if [ "$BACKUP_TEST_FAIL" = "$(basename "$source" .db)" ]; then
    printf partial > "$destination"
    printf journal > "$destination-journal"
    exit 1
fi
if [ "$BACKUP_TEST_HANG" = yes ]; then
    printf partial > "$destination"
    printf journal > "$destination-journal"
    sleep 30
fi
cp -- "$source" "$destination"
`);
    // Git Bash has no flock. Sequential policy tests still run there; the
    // overlap test below requires the real Linux command and never uses this shim.
    if (!hasFlock) shim('flock', '#!/bin/bash\nexit 0\n');
    const invoke = (target = 'all', overrides = {}) => execute(bash, [
      '-c', 'export PATH="$(cd "$BACKUP_TEST_BIN" && pwd):$PATH"; exec bash "$@"', 'backup-test', slash(script), target,
    ], {
      windowsHide: true,
      env: { ...process.env, BACKUP_TEST_BIN: slash(join(root, 'bin')), BACKUP_RETENTION_DAYS: '3', BACKUP_TIMEOUT_SECONDS: '120', BACKUP_TEST_DAY: '20261023', BACKUP_TEST_DELAY: '', BACKUP_TEST_FAIL: '', BACKUP_TEST_HANG: '', BACKUP_TEST_REAL_SQLITE: '', ...overrides },
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

test('all databases keep one snapshot per day across manual and nightly calls', { skip: !bash }, async () => {
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

test('a timed-out backup fails, cleans all partial files, preserves prior backups and can retry', {skip: !bash}, async () => {
  await fixture(async ({root, invoke, seed, backups}) => {
    const previous=seed('LadsData', 'LadsData_20261022.db', 'last good backup');
    await assert.rejects(invoke('LadsData', {BACKUP_TIMEOUT_SECONDS: '1', BACKUP_TEST_HANG: 'yes'}), error => {
      assert.equal(error.code, 124);
      assert.match(error.stderr, /timed out after 1s/);
      return true;
    });
    assert.deepEqual(readdirSync(join(root, 'backups', 'LadsData')), ['LadsData_20261022.db']);
    assert.equal(readFileSync(previous, 'utf8'), 'last good backup');
    await invoke('LadsData');
    assert.deepEqual(backups('LadsData'), ['LadsData_20261022.db', 'LadsData_20261023.db']);
  });
});

test('invalid timeout settings fail before copying or pruning', {skip: !bash}, async () => {
  await fixture(async ({invoke, seed, backups}) => {
    const previous=seed('LadsData', 'LadsData_20261001.db');
    const old=new Date(Date.now()-4*24*60*60*1000); utimesSync(previous, old, old);
    for(const value of ['0', '-1', 'bad', '1.5']) await assert.rejects(invoke('LadsData', {BACKUP_TIMEOUT_SECONDS: value}), /positive whole number/);
    assert.deepEqual(backups('LadsData'), ['LadsData_20261001.db']);
  });
});

test('real SQLite backup completes and remains consistent while a WAL writer is active', {skip: !bash || !hasSqliteCli, timeout: 15000}, async () => {
  await fixture(async ({root, invoke, backups}) => {
    const source=join(root, 'db', 'LadsData.db');
    rmSync(source);
    const writer=new Database(source);
    let timer, writes=0;
    try {
      writer.pragma('journal_mode = WAL');
      writer.exec('CREATE TABLE Payload(Id INTEGER PRIMARY KEY, Data BLOB); CREATE TABLE Heartbeat(Value INTEGER); INSERT INTO Heartbeat VALUES(0)');
      const insert=writer.prepare('INSERT INTO Payload(Data) VALUES(zeroblob(8192))');
      writer.transaction(()=>{for(let i=0;i<4096;i++)insert.run();})();
      const update=writer.prepare('UPDATE Heartbeat SET Value=?');
      timer=setInterval(()=>{update.run(++writes);}, 1);
      await invoke('LadsData', {BACKUP_TEST_REAL_SQLITE: slash(sqliteCli), BACKUP_TIMEOUT_SECONDS:'10'});
      clearInterval(timer);timer=null;
      assert.ok(writes>0, 'Writer remains active while the backup runs');
      assert.deepEqual(backups('LadsData'), ['LadsData_20261023.db']);
      const copy=new Database(join(root, 'backups', 'LadsData', backups('LadsData')[0]), {readonly:true});
      try {
        assert.equal(copy.pragma('integrity_check', {simple:true}), 'ok');
        assert.equal(copy.prepare('SELECT count(*) count FROM Payload').get().count, 4096);
        const version=copy.prepare('SELECT Value FROM Heartbeat').get().Value;
        assert.ok(version>=0 && version<=writes);
      } finally {copy.close();}
    } finally {clearInterval(timer);writer.close();}
  });
});

test('the backup SQL pins its snapshot before later WAL commits and includes already committed WAL data', {skip: !hasSqliteCli, timeout: 10000}, async () => {
  const root=mkdtempSync(join(tmpdir(), 'lads-backup-snapshot-'));
  const source=join(root, 'source.db'), destination=slash(join(root, 'copy.db'));
  const writer=new Database(source);
  let child;
  try {
    writer.pragma('journal_mode = WAL');
    writer.exec('CREATE TABLE State(Value INTEGER); INSERT INTO State VALUES(1)');
    // Exercise the actual SQL from the script, pausing exactly before .backup
    // to commit another writer's update after the source snapshot is pinned.
    const script=readFileSync('scripts/db/backupDatabases.sh', 'utf8').replaceAll('\r', '');
    const sql=script.split('<<SQL\n')[1].split('\nSQL')[0];
    const [before, after]=sql.split(".backup '$temporary'");
    assert.ok(before && after);
    child=spawn(sqliteCli, ['-readonly', '-batch', '-bail', source], {windowsHide:true});
    let output='', errors='';
    child.stderr.on('data', chunk=>{errors+=chunk;});
    const finished=new Promise((resolve, reject)=>{child.once('error', reject);child.once('close', code=>resolve(code));});
    const ready=new Promise((resolve, reject)=>{
      child.once('error', reject);
      child.once('close', ()=>reject(new Error(`SQLite exited before snapshot: ${errors}`)));
      child.stdout.on('data', chunk=>{output+=chunk;if(output.includes('SNAPSHOT_READY'))resolve();});
    });
    child.stdin.write(`${before}.print SNAPSHOT_READY\n`);
    await ready;
    writer.exec('UPDATE State SET Value=2');
    child.stdin.end(`.backup '${destination}'${after}\n`);
    assert.equal(await finished, 0, errors);
    const copy=new Database(destination, {readonly:true});
    try {
      assert.equal(copy.prepare('SELECT Value FROM State').get().Value, 1);
      assert.equal(writer.prepare('SELECT Value FROM State').get().Value, 2);
      assert.equal(copy.pragma('integrity_check', {simple:true}), 'ok');
    } finally {copy.close();}
  } finally {
    child?.kill();writer.close();
    if(dirname(resolve(root))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');
    rmSync(root, {recursive:true, force:true});
  }
});
