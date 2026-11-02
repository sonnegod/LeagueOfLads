import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {inhouseFixture, inhousePreviewAdmin} from './helpers/inhouseFixture.js';
import {inhouseBotFixture} from './helpers/inhouseBotFixture.js';
import {createInhouseRoutes} from '../routes/inhouseRoutes.js';
import {InhouseStore} from '../inhouses/store.js';
import {dismissInhouseReport, readDismissedInhouseReports, inhouseReportStorageKey} from '../client/src/utils/inhouseReports.js';

test('clearing the waiting queue preserves game reservations, preferences and ratings, and records the admin', () => {
  const f = inhouseFixture();
  try {
    const gameId = f.ten();
    f.join(11); f.join(12);
    const settings = f.store.settings(), game = f.store.game(gameId), players = f.db.prepare('SELECT * FROM InhousePlayers').all();
    assert.deepEqual(f.store.clearQueue(99), {removed: 2});
    assert.equal(f.store.queueSummary().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue WHERE InhouseId=?').get(gameId).n, 10);
    assert.deepEqual(f.store.game(gameId), game);
    assert.deepEqual(f.store.settings(), settings);
    assert.deepEqual(f.db.prepare('SELECT * FROM InhousePlayers').all(), players);
    const audit = f.store.auditLog().find(entry => entry.action === 'queue-cleared');
    assert.equal(audit.actorId, 99); assert.equal(audit.details.removed, 2);
    const revision = f.store.revision();
    assert.deepEqual(f.store.clearQueue(99), {removed: 0});
    assert.equal(f.store.revision(), revision, 'Clearing an empty queue is a no-op');
  } finally {f.close();}
});

test('bots create public ticketed lobbies and correct an unlisted lobby before opening its timer', () => {
  const f = inhouseBotFixture();
  try {
    f.join(1); const {gameId} = f.store.startAdminTest(1, {playerCount: 1}); f.ready(gameId); f.step();
    const created = f.commands.find(command => command.name === 'create').data;
    assert.equal(created.lobbyDetails.visibility, 0);
    assert.equal(created.lobbyDetails.leagueid, 777);
    assert.ok(created.passKey);
    const lobby = f.sessions.get(1).lobby;
    lobby.visibility = 2;
    f.step();
    assert.equal(f.commands.at(-1).name, 'details');
    assert.equal(f.commands.at(-1).data.visibility, 0);
    assert.equal(f.store.game(gameId).lobbyJoinStartedAt, null);
    f.step(); assert.ok(f.store.game(gameId).lobbyJoinStartedAt);
  } finally {f.cleanup();}
});

test('player reinvite requests reach only their assigned bot, persist across stores and are throttled', () => {
  const f = inhouseBotFixture();
  try {
    const first = f.ten(); f.ready(first); f.step(); f.step();
    f.join(11); const {gameId} = f.store.startAdminTest(11, {playerCount: 1}); f.ready(gameId); f.step(); f.step();
    const web = new InhouseStore(f.db, {clock: f.clock});
    assert.throws(() => web.requestReinvite(gameId, 1), error => error.status === 403);
    const result = web.requestReinvite(gameId, 11);
    assert.equal(result.pending, true); assert.equal(result.retryAt, f.clock() + 30000);
    assert.throws(() => web.requestReinvite(gameId, 11), error => error.status === 429);
    assert.throws(() => new InhouseStore(f.db, {clock: f.clock}).requestReinvite(gameId, 11), error => error.status === 429);
    const before = f.commands.filter(command => command.name === 'invite' && command.playerId === 11).length;
    f.step();
    const invites = f.commands.filter(command => command.name === 'invite' && command.playerId === 11);
    assert.equal(invites.length, before + 1);
    assert.equal(invites.at(-1).id, 2);
    assert.deepEqual(web.pendingReinvites(gameId), []);
    f.step();
    assert.equal(f.commands.filter(command => command.name === 'invite' && command.playerId === 11).length, before + 1);
    f.advance(30000); web.requestReinvite(gameId, 11);
    f.restart(); f.step();
    assert.deepEqual(web.pendingReinvites(gameId), [], 'The restarted worker consumes the persisted request');
    assert.equal(f.commands.filter(command => command.name === 'invite' && command.playerId === 11).at(-1).id, 2);
  } finally {f.cleanup();}
});

test('reinvites reject unavailable, expired and started lobbies; a request for an already present player cannot hold launch', () => {
  const f = inhouseBotFixture();
  try {
    f.join(1); const {gameId} = f.store.startAdminTest(1, {playerCount: 1});
    assert.throws(() => f.store.requestReinvite(gameId, 1), error => error.status === 409);
    f.ready(gameId); f.step(); f.step();
    const bot = f.store.botStatus()[0];
    f.store.updateBot(1, {steamId: bot.steamId, status: 'offline'});
    assert.throws(() => f.store.requestReinvite(gameId, 1), error => error.status === 409);
    f.step(); f.store.requestReinvite(gameId, 1); f.fill(1);
    const before = f.commands.filter(command => command.name === 'invite').length;
    for (let tick = 0; tick < 12; tick++) f.step();
    assert.equal(f.commands.filter(command => command.name === 'invite').length, before);
    assert.deepEqual(f.store.pendingReinvites(gameId), []);
    assert.ok(f.commands.some(command => command.name === 'launch'));
    assert.throws(() => f.store.requestReinvite(gameId, 1), error => error.status === 409);
    f.store.cancel(gameId, 'End test', 99);
    assert.throws(() => f.store.requestReinvite(gameId, 1), error => error.status === 409);
    f.step(); f.step(); f.join(2);
    const expired = f.store.startAdminTest(2, {playerCount: 1}).gameId;
    f.ready(expired); f.step(); f.step(); f.advance(16 * 60000);
    assert.throws(() => f.store.requestReinvite(expired, 2), error => error.status === 409);
  } finally {f.cleanup();}
});

test('queue clearing requires an admin; reinvite uses the signed-in participant instead of a supplied player ID', async () => {
  const f = inhouseBotFixture(); let server, routes;
  try {
    f.store.setAvailability({availability: 'open', version: f.store.settings().version}, 99);
    f.join(1); const {gameId} = f.store.startAdminTest(1, {playerCount: 1}); f.ready(gameId); f.step(); f.step(); f.join(2);
    const app = express(); app.use(express.json());
    app.use((req, res, next) => {
      const id = req.get('x-test-user'); req.isAuthenticated = () => Boolean(id);
      if (id) req.user = {id: String(76561197960265728n + BigInt(id)), isAdmin: id === '99'};
      next();
    });
    routes = createInhouseRoutes({store: f.store, requireAdmin: inhousePreviewAdmin});
    app.use('/api/inhouses', routes.publicRoutes);
    app.use('/api/admin/inhouses', (req, res, next) => req.user?.isAdmin ? next() : res.sendStatus(req.user ? 403 : 401), routes.adminRoutes);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = (path, user, method, body = {}) => fetch(base + path, {method, headers: {'Content-Type': 'application/json', ...(user ? {'x-test-user': String(user)} : {})}, body: JSON.stringify(body)});
    assert.equal((await request('/admin/inhouses/queue', null, 'DELETE')).status, 401);
    assert.equal((await request('/admin/inhouses/queue', 2, 'DELETE')).status, 403);
    const path = `/inhouses/games/${gameId}/reinvite`;
    assert.equal((await request(path, null, 'POST')).status, 401);
    assert.equal((await request(path, 2, 'POST', {playerId: 1})).status, 403);
    assert.equal((await request(path, 1, 'POST', {playerId: 2})).status, 202);
    assert.deepEqual(f.store.pendingReinvites(gameId).map(request => request.playerId), [1]);
    assert.equal((await request(path, 1, 'POST')).status, 429);
    const clear = await request('/admin/inhouses/queue', 99, 'DELETE');
    assert.equal(clear.status, 200); assert.deepEqual(await clear.json(), {removed: 1});
    assert.equal(f.store.playerActivity(1).activeGameId, gameId);
  } finally {
    routes?.stream.close(); server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve)); f.cleanup();
  }
});

test('report dismissals survive reload, stay account-local and tolerate unavailable or corrupted browser storage', () => {
  const data = new Map(), storage = {getItem: key => data.get(key), setItem: (key, value) => data.set(key, value)};
  assert.deepEqual(readDismissedInhouseReports(storage, 1), []);
  assert.deepEqual(dismissInhouseReport(storage, 1, 17), [17]);
  assert.deepEqual(readDismissedInhouseReports(storage, 1), [17]);
  assert.deepEqual(readDismissedInhouseReports(storage, 2), []);
  assert.deepEqual(dismissInhouseReport(storage, 1, 18), [17, 18]);
  assert.deepEqual(readDismissedInhouseReports(storage, null), []);
  storage.setItem(inhouseReportStorageKey(1), '{broken');
  assert.deepEqual(readDismissedInhouseReports(storage, 1), []);
  storage.setItem(inhouseReportStorageKey(1), '[17,17,-1,"wrong",null]');
  assert.deepEqual(readDismissedInhouseReports(storage, 1), [17]);
  assert.deepEqual(dismissInhouseReport(null, 1, 19, [17]), [17, 19]);
});
