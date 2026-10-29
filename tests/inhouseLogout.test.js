import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createLogoutHandler} from '../routes/authLogout.js';
import {inhouseFixture} from './helpers/inhouseFixture.js';

async function logoutServer(removeWaiting) {
  const app = express(), events = [];
  app.use((req, res, next) => {
    const id = req.get('x-test-user');
    req.user = {id: (76561197960265728n + BigInt(id || 2)).toString()};
    req.isAuthenticated = () => Boolean(id);
    req.logout = done => {events.push('logout'); req.user = undefined; req.isAuthenticated = () => false; done();};
    req.session = {destroy: done => {events.push('destroy'); done();}};
    next();
  });
  const handler = createLogoutHandler({removeWaiting: id => {events.push(`remove:${id}`); return removeWaiting(id);}});
  app.get(['/api/auth/logout', '/api/logout'], handler);
  app.use((error, req, res, next) => {void next; res.status(error.status || 500).json({error: error.message});});
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  return {events, request: (id, path = '/api/auth/logout') => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: id ? {'x-test-user': String(id)} : {}, redirect: 'manual'}),
  close: async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}};
}

test('both sign-out URLs remove only the authenticated waiting player before destroying the session', async () => {
  const f = inhouseFixture(), api = await logoutServer(id => f.store.leaveOnLogout(id));
  try {
    f.join(1); f.join(2);
    for (const path of ['/api/auth/logout?accountId=2', '/api/logout?accountId=2']) {
      if (!f.store.queue().some(p => p.playerId === 1)) f.join(1);
      const revision = f.store.revision(), response = await api.request(1, path);
      assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/');
      assert.match(response.headers.get('set-cookie'), /connect\.sid=;/);
      assert.deepEqual(f.store.queue().map(p => p.playerId), [2]);
      assert.ok(f.store.revision() > revision);
      assert.deepEqual(api.events.splice(0), ['remove:1', 'logout', 'destroy']);
    }
    const revision = f.store.revision();
    await api.request(null);
    assert.deepEqual(f.store.queue().map(p => p.playerId), [2]);
    assert.equal(f.store.revision(), revision);
    assert.deepEqual(api.events, ['logout', 'destroy']);
  } finally {await api.close(); f.close();}
});

test('signing out preserves reservations throughout ready checks, drafting and playing', async () => {
  const f = inhouseFixture({draftMode: 'captain'}), api = await logoutServer(id => f.store.leaveOnLogout(id));
  try {
    const id = f.ten();
    async function remains(status) {
      const revision = f.store.revision();
      assert.equal((await api.request(1)).status, 302);
      assert.equal(f.store.game(id).status, status);
      assert.equal(f.db.prepare('SELECT InhouseId FROM InhouseQueue WHERE PlayerId=1').get().InhouseId, id);
      assert.equal(f.store.revision(), revision);
      assert.deepEqual(f.store.queueSummary(), {count: 0, players: []});
    }
    await remains('ready');
    f.ready(id); await remains('drafting');
    for (let i = 0; i < 8; i++) {f.advance(60001); f.store.tick();}
    await remains('awaiting_game');
    f.store.applyMatch(id, f.match(id, {winner: null})); await remains('playing');
  } finally {await api.close(); f.close();}
});

test('failed queue cleanup does not claim the user signed out or destroy their session', async () => {
  const api = await logoutServer(() => {throw Object.assign(new Error('Queue temporarily busy'), {status: 503});});
  try {
    assert.equal((await api.request(1)).status, 503);
    assert.deepEqual(api.events, ['remove:1']);
  } finally {await api.close();}
});
