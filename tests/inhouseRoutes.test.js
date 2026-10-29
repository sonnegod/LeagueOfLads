import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createInhouseRoutes, createInhouseStream} from '../routes/inhouseRoutes.js';
import {createSiteApiHealth} from '../config/siteAnalytics.js';
import {inhouseFixture, inhousePreviewAdmin} from './helpers/inhouseFixture.js';

test('admin preview guards all reads, streams and actions; mutations use Steam identity and JSON', async () => {
  const f = inhouseFixture(); let server, routes;
  try {
    const app = express(); app.use(express.json());
    app.use((req, res, next) => {
      const id = req.get('x-test-user');
      req.isAuthenticated = () => Boolean(id);
      if (id) req.user = {id: (76561197960265728n + BigInt(id)).toString(), displayName: `Signed in ${id}`};
      next();
    });
    let correction;
    routes = createInhouseRoutes({store: f.store, requireAdmin: inhousePreviewAdmin, isOfficialTicket: id => id === 20285,
      api: {details: async id => {assert.equal(id, 9002); return correction;}}});
    app.use('/api/inhouses', routes.publicRoutes);
    app.use('/api/admin/inhouses', (req, res, next) => req.get('x-test-user') === '99' ? next() : res.sendStatus(req.user ? 403 : 401), routes.adminRoutes);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = (path, user, method = 'GET', body, role) => fetch(base + path, {method,
      headers: {'Content-Type': 'application/json', ...(user ? {'x-test-user': String(user)} : {}), ...(role ? {'x-test-preview-role': role} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    const revision = f.store.revision();
    for (const [path, method = 'GET'] of [['state'], ['queue'], ['activity'], ['stream'], ['activity/stream'], ['games'], ['games/1'], ['me'], ['games/1/chat'],
      ['queue', 'POST'], ['queue', 'DELETE'], ['preferences', 'PUT'], ['preferences/dismiss', 'POST'], ['games/1/ready', 'POST'], ['games/1/pick', 'POST'], ['games/1/chat', 'POST']]) {
      assert.equal((await request(`/inhouses/${path}`, null, method, method === 'GET' ? undefined : {})).status, 401, `Anonymous ${method} ${path}`);
      const regular = await request(`/inhouses/${path}`, 1, method, method === 'GET' ? undefined : {}, 'user');
      assert.equal(regular.status, 403, `Non-admin ${method} ${path}`);
      assert.equal(regular.headers.get('cache-control'), 'private, no-store');
    }
    assert.equal(f.store.revision(), revision, 'Denied requests never change queue, profiles or preferences');
    assert.equal((await request('/inhouses/state')).status, 401);
    assert.equal((await request('/inhouses/state', 1)).status, 200);
    assert.equal((await request('/inhouses/me')).status, 401);
    assert.equal((await request('/inhouses/queue', null, 'POST', {roles: [1], offRole: false})).status, 401);
    assert.equal((await request('/admin/inhouses/status')).status, 401);
    assert.equal((await request('/admin/inhouses/status', 1)).status, 403);
    assert.equal((await request('/admin/inhouses/status', 99)).status, 200);
    assert.equal((await request('/admin/inhouses/settings', 99, 'PUT', {...f.store.settings(), leagueId: 20285})).status, 400);
    assert.equal(f.store.settings().leagueId, 777);
    assert.equal((await request('/inhouses/queue', 1, 'POST', {roles: [2], offRole: false, playerId: 999, rating: 9000})).status, 200);
    let state = await (await request('/inhouses/state', 1)).json();
    assert.equal(state.queue[0].playerId, 1); assert.equal(state.queue[0].rating, 1000); assert.equal(state.queue[0].name, 'Signed in 1');
    const queueSummary = await (await request('/inhouses/queue', 1)).json();
    assert.deepEqual(queueSummary, {count: 1, players: [{playerId: 1, name: 'Signed in 1'}]});
    assert.ok(!JSON.stringify(state).includes('steamid')); assert.equal(state.audit, undefined);
    assert.equal((await request('/inhouses/queue', 1, 'POST', {roles: [2], offRole: false})).status, 409);
    assert.equal((await request('/inhouses/preferences', 1, 'PUT', {roles: [2,2], offRole: false})).status, 400);
    assert.equal((await request('/inhouses/queue', 1, 'DELETE', {})).status, 200);
    state = await (await request('/inhouses/state', 1)).json(); assert.equal(state.queue.length, 0);
    const htmlPost = await fetch(base + '/inhouses/queue', {method: 'POST', headers: {'x-test-user': '1', 'Content-Type': 'text/plain'}, body: '{}'});
    assert.equal(htmlPost.status, 415);
    const gameId = f.ten(); f.ready(gameId); const match = f.match(gameId);
    f.store.applyMatch(gameId, match);
    correction = {...match, matchId: 9002, winner: 'dire'};
    const body = {matchId: 9002, reason: 'Correct the original game'};
    assert.equal((await request(`/admin/inhouses/games/${gameId}/link`, 1, 'POST', body)).status, 403);
    assert.equal((await request(`/admin/inhouses/games/${gameId}/link`, 99, 'POST', body)).status, 200);
    assert.equal(f.store.game(gameId).winner, 'B');
    assert.equal(f.db.prepare('SELECT MAX(Games) n FROM InhousePlayers').get().n, 1);
  } finally {routes?.stream.close(); if (server) await new Promise(resolve => server.close(resolve)); f.close();}
});

test('one revision stream fans out worker changes, reconnects to full state and is excluded from API latency', {timeout: 10000}, async () => {
  const f = inhouseFixture(), stream = createInhouseStream(f.store, {intervalMs: 5});
  let server; const abort = new AbortController(), abort2 = new AbortController(); let tracked = 0;
  try {
    const app = express();
    app.use(createSiteApiHealth({enabled: () => true, record: () => {tracked++;}}));
    app.get('/api/inhouses/stream', (req, res) => stream.subscribe(req, res));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/inhouses/stream`;
    const response = await fetch(url, {signal: abort.signal});
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let first = decoder.decode((await reader.read()).value); assert.match(first, /event: state/);
    f.join(1);
    let output = '';
    while (!output.includes('"playerId":1')) output += decoder.decode((await reader.read()).value);
    assert.match(output, /Signed|Player 1/);
    f.advance(10000);
    const second = await fetch(url, {signal: abort2.signal}), secondReader = second.body.getReader();
    const current = decoder.decode((await secondReader.read()).value); assert.match(current, /"playerId":1/);
    assert.match(current, new RegExp(`"serverNow":${f.clock()}`));
    f.join(2);
    let fanoutA = '', fanoutB = '';
    while (!fanoutA.includes('"playerId":2')) fanoutA += decoder.decode((await reader.read()).value);
    while (!fanoutB.includes('"playerId":2')) fanoutB += decoder.decode((await secondReader.read()).value);
    abort.abort(); abort2.abort();
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(tracked, 0);
  } finally {abort.abort(); abort2.abort(); stream.close(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); f.close();}
});
