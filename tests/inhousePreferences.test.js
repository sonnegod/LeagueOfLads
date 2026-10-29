import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {InhouseStore} from '../inhouses/store.js';
import {createInhouseRoutes} from '../routes/inhouseRoutes.js';
import {inhouseFixture, inhousePreviewAdmin} from './helpers/inhouseFixture.js';

test('first-visit skip persists per account without choosing roles or joining a queue', () => {
  const f = inhouseFixture();
  try {
    const first = f.store.profile(1, 'One');
    assert.deepEqual(first.roles, []); assert.equal(first.offRole, true); assert.equal(first.preferencesPromptedAt, null);
    const skipped = f.store.dismissPreferencesPrompt(1, 'One');
    assert.equal(skipped.preferencesPromptedAt, f.clock()); assert.deepEqual(skipped.roles, []); assert.equal(skipped.offRole, true);
    assert.deepEqual(f.store.queueSummary(), {count: 0, players: []});
    f.advance(60000);
    const reopened = new InhouseStore(f.db, {clock: f.clock});
    assert.equal(reopened.profile(1, 'One').preferencesPromptedAt, skipped.preferencesPromptedAt);
    assert.equal(reopened.dismissPreferencesPrompt(1, 'One').preferencesPromptedAt, skipped.preferencesPromptedAt);
    assert.equal(reopened.profile(2, 'Two').preferencesPromptedAt, null);
    assert.equal('preferencesPromptedAt' in reopened.snapshot().leaderboard[0], false);
  } finally {f.close();}
});

test('saving preferred role order acknowledges the popup and no-preference players can fill a role-aware game', () => {
  const f = inhouseFixture({queueMode: 'preference'});
  try {
    const saved = f.store.preferences(1, {roles: [5, 4], offRole: false}, 'One');
    assert.deepEqual(saved.roles, [5, 4]); assert.equal(saved.preferencesPromptedAt, f.clock());
    assert.deepEqual(f.store.dismissPreferencesPrompt(1, 'One').roles, [5, 4]);
    assert.throws(() => f.store.preferences(1, {roles: [], offRole: false}, 'One'));
    for (let id = 1; id <= 10; id++) f.store.join(id, {roles: [], offRole: true}, `Player ${id}`);
    f.ready(1);
    const game = f.store.game(1);
    assert.equal(game.status, 'awaiting_game');
    for (const side of ['A', 'B']) assert.deepEqual(game.players.filter(p => p.side === side).map(p => p.position).sort(), [1,2,3,4,5]);
    assert.throws(() => f.store.preferences(1, {roles: [2], offRole: false}, 'One'), /locked/);
  } finally {f.close();}
});

test('onboarding migration preserves existing preferences and ratings and can run twice', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE InhousePlayers(PlayerId INTEGER PRIMARY KEY,Name TEXT NOT NULL,RolesJson TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
      OffRole INTEGER NOT NULL DEFAULT 1,Rating REAL NOT NULL DEFAULT 1000,Games INTEGER NOT NULL DEFAULT 0,
      Wins INTEGER NOT NULL DEFAULT 0,Losses INTEGER NOT NULL DEFAULT 0);
      INSERT INTO InhousePlayers VALUES(1,'Existing','[4,5]',0,1234.5,7,4,3);`);
    const a = new InhouseStore(db), b = new InhouseStore(db);
    const old = a.profile(1, 'Existing');
    assert.deepEqual(old.roles, [4,5]); assert.equal(old.offRole, false); assert.equal(old.rating, 1234.5); assert.equal(old.games, 7);
    assert.equal(old.preferencesPromptedAt, null);
    assert.equal(db.pragma('table_info(InhousePlayers)').filter(c => c.name === 'PreferencesPromptedAt').length, 1);
    assert.deepEqual(b.profile(2, 'New').roles, []);
  } finally {db.close();}
});

test('popup acknowledgement uses authenticated identity and keeps onboarding metadata private', async () => {
  const f = inhouseFixture(), app = express(); let server, routes;
  try {
    app.use(express.json());
    app.use((req, res, next) => {
      req.isAuthenticated = () => req.get('x-test-user') === 'yes';
      req.user = {id: '76561197960265729', displayName: 'One'}; next();
    });
    routes = createInhouseRoutes({store: f.store, api: {}, requireAdmin: inhousePreviewAdmin}); app.use('/api/inhouses', routes.publicRoutes);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    f.store.profile(2, 'Two');
    const url = `http://127.0.0.1:${server.address().port}/api/inhouses`;
    const dismiss = loggedIn => fetch(url + '/preferences/dismiss', {method: 'POST', headers: {'Content-Type': 'application/json', ...(loggedIn ? {'x-test-user': 'yes'} : {})}, body: JSON.stringify({playerId: 2})});
    assert.equal((await dismiss(false)).status, 401);
    const result = await dismiss(true); assert.equal(result.status, 200);
    const player = (await result.json()).player; assert.equal(player.playerId, 1); assert.equal(player.preferencesPromptedAt, f.clock());
    assert.equal(f.store.profile(2, 'Two').preferencesPromptedAt, null);
    const publicState = await (await fetch(url + '/state', {headers: {'x-test-user': 'yes'}})).json();
    assert.ok(publicState.leaderboard.every(p => !Object.hasOwn(p, 'preferencesPromptedAt')));
  } finally {routes?.stream.close(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); f.close();}
});
