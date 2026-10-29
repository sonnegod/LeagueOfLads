import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {InhouseStore} from '../inhouses/store.js';
import {createInhouseRoutes} from '../routes/inhouseRoutes.js';
import {createSiteApiHealth} from '../config/siteAnalytics.js';
import {inhouseFixture, inhousePreviewAdmin} from './helpers/inhouseFixture.js';

const message = (text = 'Hello lobby', clientId = 'message_0001') => ({text, clientId});

test('chat persists per lobby, trusts membership and stored names, and does not invalidate game snapshots', () => {
  const f = inhouseFixture();
  try {
    const id = f.ten(), otherId = f.ten(11), revision = f.store.revision();
    let notifications = 0;
    const unsubscribe = f.store.subscribe(() => {assert.equal(f.db.inTransaction, false); notifications++;});
    const result = f.store.postChat(id, 1, {...message('  <b>Hello</b>\r\nteam  '), name: 'Impersonator', playerId: 2});
    assert.equal(result.messages[0].name, 'Player 1'); assert.equal(result.messages[0].playerId, 1);
    assert.equal(result.messages[0].text, '<b>Hello</b>\nteam');
    assert.equal(f.store.revision(), revision); assert.equal(notifications, 1);
    assert.deepEqual(f.store.postChat(id, 1, message('<b>Hello</b>\nteam')), result);
    assert.equal(notifications, 1, 'Retrying a successful post does not duplicate or republish');
    assert.throws(() => f.store.postChat(id, 1, message('Different text')), {status: 409});
    assert.throws(() => f.store.readChat(id, 11), {status: 403});
    assert.throws(() => f.store.postChat(id, 11, message()), {status: 403});
    assert.equal(f.store.readChat(otherId, 11).messages.length, 0);
    const reopened = new InhouseStore(f.db, {clock: f.clock});
    assert.equal(reopened.readChat(id, 2).messages[0].text, '<b>Hello</b>\nteam');
    unsubscribe(); assert.equal(f.store.listeners.size, 0);
  } finally {f.close();}
});

test('chat validates input, limits rapid sends, bounds loaded history, and closes with its game', () => {
  const f = inhouseFixture();
  try {
    const id = f.ten();
    for (const text of ['', '   ', 'x'.repeat(501), 123, null]) assert.throws(() => f.store.postChat(id, 1, message(text)), {status: 400});
    assert.throws(() => f.store.postChat(id, 1, message('Hello', 'bad')), {status: 400});
    for (let i = 0; i < 5; i++) f.store.postChat(id, 1, message(String(i), `message_${i}`));
    assert.throws(() => f.store.postChat(id, 1, message('Too fast', 'message_5')), {status: 429});
    f.advance(10000); f.store.postChat(id, 1, message('Allowed now', 'message_5'));
    for (let i = 6; i < 110; i++) {f.advance(10000); f.store.postChat(id, 1, message(String(i), `message_${i}`));}
    const history = f.store.readChat(id, 2).messages;
    assert.equal(history.length, 100); assert.equal(history[0].text, '10'); assert.equal(history.at(-1).text, '109');
    f.store.cancel(id, 'Finished testing', 99);
    assert.throws(() => f.store.postChat(id, 1, message()), {status: 409});
    assert.equal(f.store.readChat(id, 2).status, 'cancelled');
    assert.equal(f.store.readChat(id, 2).messages.length, 100);
  } finally {f.close();}
});

test('HTTP and SSE isolate lobby chat while public queue updates fan out immediately and survive reconnects', {timeout: 15000}, async () => {
  const f = inhouseFixture(), routes = createInhouseRoutes({store: f.store, api: {}, requireAdmin: inhousePreviewAdmin});
  const abort = new AbortController(); let server, tracked = 0;
  try {
    const id = f.ten(), otherId = f.ten(11), app = express();
    app.use(express.json());
    app.use(createSiteApiHealth({enabled: () => true, record: () => {tracked++;}}));
    app.use((req, res, next) => {
      const user = req.get('x-test-user'); req.isAuthenticated = () => Boolean(user);
      if (user) req.user = {id: (76561197960265728n + BigInt(user)).toString()};
      next();
    });
    app.use('/api/inhouses', routes.publicRoutes);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/inhouses`;
    const request = (path, user, body) => fetch(base + path, {signal: abort.signal,
      headers: {'Content-Type': 'application/json', ...(user ? {'x-test-user': String(user)} : {})},
      ...(body ? {method: 'POST', body: JSON.stringify(body)} : {})});
    for (const path of [`/games/${id}/chat`, `/activity?gameId=${id}`, `/activity/stream?gameId=${id}`]) {
      assert.equal((await request(path)).status, 401);
      assert.equal((await request(path, 11)).status, 403);
    }
    assert.equal((await request(`/games/${id}/chat`, null, message())).status, 401);
    assert.equal((await request(`/games/${id}/chat`, 11, message())).status, 403);
    async function subscribe(user, gameId) {
      const response = await request(`/activity/stream${gameId ? `?gameId=${gameId}` : ''}`, user);
      assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      assert.equal(response.headers.get('x-accel-buffering'), 'no');
      const reader = response.body.getReader(), decoder = new TextDecoder(), received = []; let buffer = '';
      return {received, async next(event) {
        for (;;) {
          const end = buffer.indexOf('\n\n');
          if (end >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (frame.startsWith('event: ')) {
              const data = JSON.parse(frame.split('\ndata: ')[1]); received.push({event: frame.split('\n')[0].slice(7), data});
              if (frame.startsWith(`event: ${event}\n`)) return data;
            }
            continue;
          }
          const read = await reader.read(); if (read.done) throw Error('Stream closed');
          buffer += decoder.decode(read.value, {stream: true});
        }
      }};
    }
    const a = await subscribe(1, id), b = await subscribe(2, id), other = await subscribe(11, otherId), publicView = await subscribe(99);
    assert.equal((await a.next('chat')).messages.length, 0);
    assert.equal((await b.next('chat')).messages.length, 0);
    assert.equal((await other.next('queue')).count, 0);
    assert.equal((await other.next('chat')).messages.length, 0);
    const initialActivity = await publicView.next('queue');
    assert.equal(initialActivity.count, 0); assert.equal(initialActivity.games.length, 2);
    assert.equal(initialActivity.activePlayers, 20); assert.equal(initialActivity.totalPlayers, 20);
    assert.ok(initialActivity.games.every(game => game.status === 'ready' && game.playerCount === 10));
    const posted = await request(`/games/${id}/chat`, 1, {...message(), name: 'Fake'});
    assert.equal(posted.status, 201); const saved = await posted.json();
    assert.deepEqual(await a.next('chat'), saved); assert.deepEqual(await b.next('chat'), saved);
    assert.equal((await (await request(`/games/${otherId}/chat`, 11)).json()).messages.length, 0);
    const reconnect = await subscribe(2, id); assert.deepEqual(await reconnect.next('chat'), saved);
    // A separate store has no local listeners, just like the independent worker.
    const workerStore = new InhouseStore(f.db, {clock: f.clock});
    workerStore.join(21, {roles: [], offRole: true}, 'Worker player');
    const workerActivity = await publicView.next('queue');
    assert.equal(workerActivity.count, 1); assert.equal(workerActivity.totalPlayers, 21);
    assert.equal((await other.next('queue')).count, 1, 'Other lobby receives public queue, no private chat');
    assert.ok(other.received.filter(event => event.event === 'chat').every(event => event.data.messages.length === 0));
    assert.ok(publicView.received.every(event => event.event !== 'chat'));
    f.store.join(22, {roles: [], offRole: true}, 'Local player');
    assert.equal((await publicView.next('queue')).count, 2);
    f.store.cancel(id, 'Done', 99);
    assert.equal((await a.next('chat')).status, 'cancelled');
    const cancelledActivity = await publicView.next('queue');
    assert.equal(cancelledActivity.count, 2);
    assert.deepEqual(cancelledActivity.games, [{id: otherId, status: 'ready', playerCount: 10}]);
    assert.equal(cancelledActivity.totalPlayers, 12, 'Cancellation releases players from the active pool');
    assert.equal((await request(`/games/${id}/chat`, 1, message('After cancellation', 'closed_message'))).status, 409);
    const beforeClose = tracked; abort.abort(); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(tracked, beforeClose, 'SSE streams excluded from API health timings');
  } finally {
    abort.abort(); routes.stream.close(); server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    assert.equal(f.store.listeners.size, 0); f.close();
  }
});
