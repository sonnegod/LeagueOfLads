import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join as joinPath} from 'node:path';
import {InhouseStore} from '../inhouses/store.js';
import {inhouseFixture} from './helpers/inhouseFixture.js';

test('initialization is additive, ticket is required, and invalid or stale settings roll back', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE LeagueStandings(TeamId INTEGER,Wins INTEGER); INSERT INTO LeagueStandings VALUES(1,4)');
  try {
    const store = new InhouseStore(db);
    assert.throws(() => store.join(1, {roles: [1], offRole: false}, 'One'), /ticket/);
    store.saveSettings({version: 1, leagueId: 777, queueMode: 'fifo', draftMode: 'captain', launchMinutes: 15}, 99);
    assert.throws(() => store.saveSettings({version: 1}, 99), /changed/);
    assert.deepEqual(db.prepare('SELECT * FROM LeagueStandings').get(), {TeamId: 1, Wins: 4});
    assert.equal(db.prepare('SELECT COUNT(*) n FROM InhousePlayers').get().n, 0);
  } finally {db.close();}
});

test('twenty players form separate reservations, duplicate joins and reserved edits/leaving are rejected', () => {
  const f = inhouseFixture();
  try {
    const a = f.ten(), b = f.ten(11);
    assert.notEqual(a, b); assert.equal(f.store.queue().length, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n, 20);
    assert.throws(() => f.join(1), /already/);
    assert.throws(() => f.store.leave(1), /reserved/);
    assert.throws(() => f.store.preferences(1, {roles: [2], offRole: false}, 'One'), /locked/);
    assert.equal(f.store.game(a).players.length, 10);
    assert.throws(() => f.store.ready(a, 99), /not in/);
  } finally {f.close();}
});

test('ready timeout removes absent players and preserves original waiting priority for confirmations', () => {
  const f = inhouseFixture();
  try {
    const id = f.ten();
    for (let i = 1; i <= 9; i++) f.store.ready(id, i);
    const original = f.store.members(id)[0].joinedAt;
    f.advance(60001); f.store.tick();
    assert.equal(f.store.game(id).status, 'cancelled');
    assert.deepEqual(f.store.queue().map(p => p.playerId), [1,2,3,4,5,6,7,8,9]);
    assert.equal(f.store.queue()[0].joinedAt, original);
    f.join(11); assert.equal(f.store.game(2).status, 'ready');
  } finally {f.close();}
});

test('preference mode waits for coverage while FIFO allows free draft, and settings are snapshotted', () => {
  const f = inhouseFixture({queueMode: 'preference'});
  try {
    f.ten(1, {roles: [2], offRole: false});
    assert.equal(f.store.queue().length, 10);
    f.store.saveSettings({...f.store.settings(), queueMode: 'fifo', draftMode: 'captain'}, 99);
    const game = f.ready(1);
    assert.equal(game.status, 'drafting'); assert.equal(game.allowedPicks.length, 8);
    f.store.saveSettings({...f.store.settings(), leagueId: 888, launchMinutes: 30}, 99);
    assert.equal(f.store.game(1).leagueId, 777); assert.equal(f.store.game(1).launchMinutes, 15);
  } finally {f.close();}
});

test('captain authorization, stale turns, timeout picks, and final launch deadline are server-owned', () => {
  const f = inhouseFixture({draftMode: 'captain'});
  try {
    const id = f.ten(); let game = f.ready(id);
    assert.throws(() => f.store.pick(id, 99, {turn: 0, playerId: game.allowedPicks[0]}), /captain/);
    f.store.pick(id, game.captainA, {turn: 0, playerId: game.allowedPicks[0]});
    assert.equal(f.store.auditLog().find(entry => entry.action === 'pick').actorId, game.captainA);
    assert.throws(() => f.store.pick(id, game.captainA, {turn: 0, playerId: game.allowedPicks[1]}), /moved on/);
    for (let i = 0; i < 7; i++) {f.advance(60001); f.store.tick();}
    game = f.store.game(id);
    assert.equal(game.status, 'awaiting_game'); assert.equal(game.turn, 8);
    assert.equal(game.deadline, f.clock() + 15 * 60000);
    assert.equal(game.players.filter(p => p.side === 'A').length, 5);
    f.advance(15 * 60000 + 1); f.store.tick();
    assert.equal(f.store.game(id).status, 'cancelled');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n, 0);
  } finally {f.close();}
});

test('strict role drafts reject picks that make a complete assignment impossible', () => {
  const f = inhouseFixture({draftMode: 'captain', queueMode: 'preference'});
  try {
    for (let i = 1; i <= 10; i++) f.join(i, {roles: [Math.ceil(i / 2)], offRole: false});
    const game = f.ready(1);
    f.store.pick(1, game.captainA, {turn: 0, playerId: 3});
    f.store.pick(1, game.captainB, {turn: 1, playerId: 5});
    assert.ok(!f.store.game(1).allowedPicks.includes(6));
    assert.throws(() => f.store.pick(1, game.captainB, {turn: 2, playerId: 6}), /invalid position/);
  } finally {f.close();}
});

test('linking checks all participants, ticket, team membership and time; reversed sides resolve once', () => {
  const f = inhouseFixture();
  try {
    const id = f.ten(); f.ready(id);
    const match = f.match(id, {reversed: true});
    for (const invalid of [{...match, leagueId: 999}, {...match, players: match.players.slice(1)},
      {...match, players: match.players.map((p, i) => i === 0 ? {...p, playerId: 999} : p)},
      {...match, players: match.players.map((p, i) => i === 0 ? {...p, side: p.side === 'radiant' ? 'dire' : 'radiant'} : p)},
      {...match, startedAt: f.clock() - 86400000}]) assert.throws(() => f.store.applyMatch(id, invalid));
    f.store.applyMatch(id, {...match, winner: null});
    f.advance(3600000); f.store.tick(); assert.equal(f.store.game(id).status, 'playing');
    f.store.applyMatch(id, match); f.store.applyMatch(id, match);
    const game = f.store.game(id); assert.equal(game.status, 'completed'); assert.equal(game.winner, 'B');
    assert.equal(f.db.prepare('SELECT MAX(Games) n FROM InhousePlayers').get().n, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n, 0);
    assert.throws(() => f.store.cancel(id, 'No', 99), /already ended/);
    assert.equal(game.players.find(p => p.side === 'B').ratingDelta, 24);
    f.join(1); assert.equal(f.store.queue().length, 1);
  } finally {f.close();}
});

test('short remakes stay unrated and admin cancellation releases players without changing records', () => {
  const f = inhouseFixture();
  try {
    const id = f.ten(); f.ready(id);
    f.store.applyMatch(id, f.match(id, {duration: 30}));
    assert.equal(f.store.game(id).status, 'playing');
    assert.equal(f.db.prepare('SELECT SUM(Games) n FROM InhousePlayers').get().n, 0);
    assert.throws(() => f.store.cancel(id, '', 99), /reason/);
    f.store.cancel(id, 'Remade lobby', 99);
    assert.equal(f.store.game(id).status, 'cancelled'); assert.equal(f.store.queue().length, 0);
    f.join(1); assert.equal(f.store.queue().length, 1);
  } finally {f.close();}
});

test('correcting an earlier resolved link replays subsequent ratings and keeps historical drafts unchanged', () => {
  const f = inhouseFixture();
  try {
    const first = f.ten(); f.ready(first); const firstMatch = f.match(first);
    f.store.applyMatch(first, firstMatch);
    f.advance(3600000);
    const second = f.ten(); f.ready(second); f.store.applyMatch(second, f.match(second, {matchId: 9002}));
    const before = f.store.game(second).players.map(p => p.ratingDelta), sides = f.store.game(first).players.map(p => p.side);
    f.store.applyMatch(first, {...firstMatch, matchId: 9003, winner: 'dire'}, {correction: true, actorId: 99, reason: 'Wrong game linked'});
    const after = f.store.game(second).players.map(p => p.ratingDelta);
    assert.notDeepEqual(after, before);
    assert.deepEqual(f.store.game(first).players.map(p => p.side), sides);
    assert.equal(f.db.prepare('SELECT MIN(Games) n FROM InhousePlayers').get().n, 2);
    assert.equal(f.store.game(first).matchId, 9003);
    assert.ok(f.store.auditLog().some(r => r.action === 'match-corrected' && r.actorId === 99));
    assert.throws(() => f.store.applyMatch(first, {...firstMatch, matchId: 9002}, {correction: true, reason: 'Duplicate'}), /another/);
  } finally {f.close();}
});

test('reservations and deadlines persist across connections and cannot be claimed twice', () => {
  const directory = mkdtempSync(joinPath(tmpdir(), 'lads-inhouses-')), path = joinPath(directory, 'test.db');
  let a, b;
  try {
    a = new Database(path); const first = new InhouseStore(a);
    first.saveSettings({version: 1, leagueId: 777, queueMode: 'fifo', draftMode: 'captain', launchMinutes: 15}, 99);
    for (let id = 1; id <= 10; id++) first.join(id, {roles: [2], offRole: false}, `Player ${id}`);
    const deadline = first.game(1).deadline;
    b = new Database(path); const second = new InhouseStore(b);
    assert.equal(second.game(1).deadline, deadline);
    assert.throws(() => second.join(1, {roles: [1], offRole: false}, 'One'), /already/);
    second.tick(); assert.equal(first.db.prepare('SELECT COUNT(*) n FROM InhouseGames').get().n, 1);
  } finally {b?.close(); a?.close(); rmSync(directory, {recursive: true, force: true});}
});

test('each player finishes calibration after exactly five rated games', () => {
  const f = inhouseFixture();
  try {
    for (let n = 1; n <= 6; n++) {
      const id = f.ten(); f.ready(id);
      f.store.applyMatch(id, f.match(id, {matchId: 9000 + n}));
      assert.equal(f.db.prepare('SELECT K FROM InhouseMembers WHERE InhouseId=? AND PlayerId=1').get(id).K, n <= 5 ? 48 : 24);
      assert.equal(f.db.prepare('SELECT Games FROM InhousePlayers WHERE PlayerId=1').get().Games, n);
      f.advance(3600000);
    }
  } finally {f.close();}
});
