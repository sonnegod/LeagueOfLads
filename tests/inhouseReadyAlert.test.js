import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {InhouseStore} from '../inhouses/store.js';
import {createInhouseRoutes} from '../routes/inhouseRoutes.js';
import {inhouseFixture, inhousePreviewAdmin} from './helpers/inhouseFixture.js';

test('ready alerts follow authenticated queue reservations, confirmation, cancellation and reconnects over the shared stream', {timeout: 10000}, async () => {
  const f = inhouseFixture(), routes = createInhouseRoutes({store: f.store, api: {}, requireAdmin: inhousePreviewAdmin});
  const abort = new AbortController(); let server;
  try {
    f.join(1);
    const app = express(); app.use(express.json());
    app.use((req, res, next) => {
      const id = req.get('x-test-user'); req.isAuthenticated = () => Boolean(id);
      if (id) req.user = {id: String(76561197960265728n + BigInt(id))};
      next();
    });
    app.use('/api/inhouses', routes.publicRoutes);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/inhouses`;
    const request = (path, id) => fetch(base + path, {signal: abort.signal, headers: {'x-test-user': String(id)}});
    async function subscribe(id) {
      const response = await request('/activity/stream', id);
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      return {async player() {
        for (;;) {
          const end = buffer.indexOf('\n\n');
          if (end >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (frame.startsWith('event: player\n')) return JSON.parse(frame.split('\ndata: ')[1]);
          } else {
            const chunk = await reader.read(); if (chunk.done) throw new Error('Stream closed');
            buffer += decoder.decode(chunk.value, {stream: true});
          }
        }
      }};
    }
    const selected = await subscribe(1), observer = await subscribe(99);
    assert.deepEqual(await selected.player(), {queued: true, readyCheck: null});
    assert.deepEqual(await observer.player(), {queued: false, readyCheck: null});
    for (let id = 2; id <= 10; id++) f.join(id);
    const gameId = f.store.rawGame(1).InhouseId;
    const alert = {queued: false, readyCheck: {gameId, deadline: f.clock() + 60000}};
    assert.deepEqual(await selected.player(), alert);
    assert.deepEqual((await (await request('/activity?playerId=1', 99)).json()).player, {queued: false, readyCheck: null});
    f.store.ready(gameId, 1);
    assert.deepEqual(await selected.player(), {queued: false, readyCheck: null}, 'Acknowledgement clears the private alert even if the public summary is unchanged');
    const confirmed = await subscribe(1), unconfirmed = await subscribe(2);
    assert.equal((await confirmed.player()).readyCheck, null);
    assert.deepEqual(await unconfirmed.player(), alert);
    const workerStore = new InhouseStore(f.db, {clock: f.clock});
    workerStore.cancel(gameId, 'Cancel ready check', 99);
    assert.deepEqual(await unconfirmed.player(), {queued: false, readyCheck: null}, 'Changes from the separate worker reach the existing connection');
    for (let id = 1; id <= 10; id++) f.join(id);
    assert.ok(f.store.playerActivity(2).readyCheck);
    f.advance(60001);
    assert.equal(f.store.playerActivity(2).readyCheck, null, 'Expired ready checks cannot trigger an alert on reconnect');
  } finally {
    abort.abort(); routes.stream.close(); server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    f.close();
  }
});
