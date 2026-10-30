import test from 'node:test';
import assert from 'node:assert/strict';
import {inhouseFixture} from './helpers/inhouseFixture.js';
import {inhouseBotFixture} from './helpers/inhouseBotFixture.js';
import {createInhouseWorker} from '../inhouses/worker.js';

test('one worker owns the five bot sessions and another cannot start sessions under its lease', async () => {
  const f=inhouseFixture();let a,b,starts=0,closes=0;
  const pool={start(){starts++;},tick(){},close(){closes++;}};
  try {
    a=createInhouseWorker(f.store,pool,{clock:f.clock,owner:'one'});
    b=createInhouseWorker(f.store,pool,{clock:f.clock,owner:'two'});
    assert.equal((await a.step()).polled,true);assert.equal((await b.step()).skipped,true);
    await a.step();assert.equal(starts,1);
    b.close();assert.equal(closes,0);
    a.close();assert.equal(closes,1);
    assert.equal(f.db.prepare('SELECT Owner FROM InhouseWorker').get().Owner,null);
  } finally {a?.close();b?.close();f.close();}
});

test('bot events are consumed before launch deadlines expire, preserving a detected game and cancelling an unlaunched one', async () => {
  const f=inhouseFixture();let worker;
  try {
    const a=f.ten(),b=f.ten(11);f.ready(a);f.ready(b);
    const match=f.match(a,{winner:null});f.advance(15*60000+1);
    worker=createInhouseWorker(f.store,{start(){},tick(){f.store.applyMatch(a,match);},close(){}},{clock:f.clock});
    await worker.step();
    assert.equal(f.store.game(a).status,'playing');assert.equal(f.store.game(b).status,'cancelled');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n,10);
  } finally {worker?.close();f.close();}
});

test('a missing result or interrupted bot connection cannot release playing reservations or guess a winner', async () => {
  const f=inhouseFixture();let worker;
  try {
    const id=f.ten();f.ready(id);f.store.applyMatch(id,f.match(id,{winner:null}));
    worker=createInhouseWorker(f.store,{start(){},tick(){return {errors:['Bot disconnected; reconnecting.']};},close(){}},{clock:f.clock});
    f.advance(7200000);await worker.step();
    assert.equal(f.store.game(id).status,'playing');assert.equal(f.store.game(id).winner,null);
    assert.throws(()=>f.join(1),/already/);
    assert.match(f.store.snapshot().worker.lastError,/disconnected/);
    f.advance(1000);await worker.step();assert.match(f.store.snapshot().worker.lastError,/disconnected/);
  } finally {worker?.close();f.close();}
});

test('deadline maintenance stays responsive while a Game Coordinator result request is pending', async () => {
  const f=inhouseBotFixture();let worker,finish;
  try {
    const playing=f.ten();f.ready(playing);f.step();f.fill(1);f.step();f.step();
    const waiting=f.ten(11);
    f.sessions.get(1).lobby=null;
    f.sessions.get(1).details=()=>new Promise(resolve=>{finish=resolve;});
    worker=createInhouseWorker(f.store,{...f.pool,start(){}},{clock:f.clock});
    await worker.step();
    assert.equal(typeof finish,'function');
    f.advance(60001);await worker.step();
    assert.equal(f.store.game(waiting).status,'cancelled');
    assert.equal(f.store.game(playing).status,'playing');
    worker.close();finish(f.match(playing,{matchId:90001}));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.store.game(playing).status,'playing','A result after shutdown is not applied by an old owner');
  } finally {worker?.close();f.cleanup();}
});

test('worker success timestamps represent Steam activity and unchanged ticks do not republish snapshots', async () => {
  const f=inhouseFixture();let worker,activity=0;
  try {
    worker=createInhouseWorker(f.store,{start(){},tick(){return {lastSuccess:activity};},close(){}},{clock:f.clock});
    await worker.step();assert.equal(f.store.snapshot().worker.lastSuccess,null);
    const revision=f.store.revision();
    f.advance(1000);await worker.step();assert.equal(f.store.revision(),revision);
    activity=f.clock();await worker.step();assert.equal(f.store.snapshot().worker.lastSuccess,activity);
    f.advance(1000);await worker.step();assert.equal(f.store.snapshot().worker.lastSuccess,activity);
  } finally {worker?.close();f.close();}
});

test('losing the worker lease closes its sessions without overwriting the new owner’s bot status', async () => {
  const f=inhouseFixture();let worker;const closed=[];
  try {
    worker=createInhouseWorker(f.store,{start(){},tick(){},close(options){closed.push(options);}},{clock:f.clock,owner:'old'});
    await worker.step();
    f.db.prepare('UPDATE InhouseWorker SET Owner=?,LeaseUntil=? WHERE Id=1').run('new',f.clock()+120000);
    assert.equal(worker.maintain(),false);assert.deepEqual(closed,[{report:false}]);
    worker.close();assert.equal(f.db.prepare('SELECT Owner FROM InhouseWorker').get().Owner,'new');
  } finally {worker?.close();f.close();}
});

test('failed bot startup closes partial sessions and releases the lease instead of creating duplicate logins', async () => {
  const f=inhouseFixture();let worker,starts=0,closes=0;
  try {
    worker=createInhouseWorker(f.store,{start(){starts++;throw new Error('Login setup failed');},tick(){},close(){closes++;}},{clock:f.clock});
    await assert.rejects(worker.step(),/Login setup failed/);
    assert.equal((await worker.step()).skipped,true);
    assert.equal(starts,1);assert.equal(closes,1);
    assert.equal(f.db.prepare('SELECT Owner FROM InhouseWorker').get().Owner,null);
  } finally {worker?.close();f.close();}
});
