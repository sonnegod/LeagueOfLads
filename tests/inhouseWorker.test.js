import test from 'node:test';
import assert from 'node:assert/strict';
import {inhouseFixture} from './helpers/inhouseFixture.js';
import {createInhouseWorker} from '../inhouses/worker.js';
import {createSteamInhouseClient, normalizeLiveGame, normalizeMatchDetails} from '../inhouses/steam.js';

test('Steam adapter validates responses, supports both live rosters and reversed detail slots, and keeps calls paced', async () => {
  let now = 0; const calls = [];
  const api = createSteamInhouseClient({apiKey: 'test-key', clock: () => now, sleep: async ms => {now += ms;},
    fetchImpl: async (url, options) => {
      calls.push({url, options, at: now});
      const result = url.pathname.includes('GetLive') ? {games: [{match_id: 5, scoreboard: {radiant: {players: [{account_id: 1}]}, dire: {players: [{account_id: 2}]}}}]}
        : url.pathname.includes('History') ? {status: 1, matches: [{match_id: 5, start_time: 100}]}
        : {match_id: 5, leagueid: 777, start_time: 100, duration: 2400, radiant_win: false, players: [{account_id: 1, player_slot: 0}, {account_id: 2, player_slot: 128}]};
      return {ok: true, json: async () => ({result})};
    }});
  const [live, history, detail] = await Promise.all([api.live(777), api.history(777), api.details(5)]);
  assert.equal(live[0].leagueId, 777); assert.equal(history[0].startedAt, 100000); assert.equal(detail.winner, 'dire');
  assert.equal(detail.players[1].side, 'dire'); assert.deepEqual(calls.map(c => c.at), [0,1000,2000]);
  assert.ok(calls.every(c => c.options.cache === 'no-store' && c.options.signal instanceof AbortSignal));
  assert.throws(() => normalizeMatchDetails({match_id: 6, players: []}, 5), /not available/);
  const full = normalizeLiveGame({match_id: 8, players: Array.from({length: 10}, (_, i) => ({account_id: i + 1, team: i < 5 ? 0 : 1}))}, 777);
  assert.equal(full.players[0].side, 'radiant'); assert.equal(full.players[9].side, 'dire');
  const missing = createSteamInhouseClient({apiKey: '', fetchImpl: () => {throw new Error('Should not call');}});
  await assert.rejects(missing.live(777), /not configured/);
  const invalid = createSteamInhouseClient({apiKey: 'test', fetchImpl: async () => ({ok: true, json: async () => ({result: {games: null}})})});
  await assert.rejects(invalid.live(777), /no live games/);
});

test('worker links simultaneous games by roster, settles reversed sides, and another worker cannot share its lease', async () => {
  const f = inhouseFixture(); let a, b;
  try {
    const first = f.ten(), second = f.ten(11); f.ready(first); f.ready(second);
    const matches = [f.match(first, {matchId: 101, reversed: true}), f.match(second, {matchId: 102})];
    const api = {live: async () => matches.map(m => ({...m, winner: null})), history: async () => [], details: async id => matches.find(m => m.matchId === id)};
    a = createInhouseWorker(f.store, api, {clock: f.clock, owner: 'one'});
    b = createInhouseWorker(f.store, api, {clock: f.clock, owner: 'two'});
    await a.step(); assert.equal((await b.step()).skipped, true);
    assert.equal(f.store.game(first).matchId, 101); assert.equal(f.store.game(first).winner, 'B');
    assert.equal(f.store.game(second).matchId, 102); assert.equal(f.store.game(second).winner, 'A');
    f.advance(20000); await a.step();
    assert.equal(f.db.prepare('SELECT MAX(Games) n FROM InhousePlayers').get().n, 1);
    assert.equal(f.store.queue().length, 0);
  } finally {b?.close(); a?.close(); f.close();}
});

test('worker recovers a missed completed game from league history and rejects unrelated participants', async () => {
  const f = inhouseFixture(); let worker;
  try {
    const id = f.ten(); f.ready(id); const match = f.match(id);
    worker = createInhouseWorker(f.store, {live: async () => [{...match, matchId: 555, players: match.players.slice(1)}],
      history: async () => [{matchId: match.matchId, startedAt: match.startedAt}], details: async () => match}, {clock: f.clock});
    await worker.step();
    assert.equal(f.store.game(id).status, 'completed'); assert.equal(f.store.game(id).matchId, match.matchId);
  } finally {worker?.close(); f.close();}
});

test('a vanished game or failed result API cannot release players or guess a winner', async () => {
  const f = inhouseFixture(); let worker;
  try {
    const id = f.ten(); f.ready(id); f.store.applyMatch(id, f.match(id, {winner: null}));
    worker = createInhouseWorker(f.store, {live: async () => [], history: async () => [], details: async () => {throw new Error('Upstream temporarily unavailable');}}, {clock: f.clock});
    f.advance(7200000); await worker.step();
    assert.equal(f.store.game(id).status, 'playing');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n, 10);
    assert.throws(() => f.join(1), /already/);
    assert.match(f.store.snapshot().worker.lastError, /unavailable/);
  } finally {worker?.close(); f.close();}
});

test('worker checks for matching games before launch cancellation, then cancels games not found', async () => {
  const f = inhouseFixture(); let worker;
  try {
    const a = f.ten(), b = f.ten(11); f.ready(a); f.ready(b);
    const match = f.match(a, {winner: null}); f.advance(15 * 60000 + 1);
    worker = createInhouseWorker(f.store, {live: async () => [match], history: async () => [], details: async () => match}, {clock: f.clock});
    await worker.step();
    assert.equal(f.store.game(a).status, 'playing'); assert.equal(f.store.game(b).status, 'cancelled');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM InhouseQueue').get().n, 10);
  } finally {worker?.close(); f.close();}
});

test('ready and draft maintenance continues while a Steam request is pending, and stopping releases the worker lease', async () => {
  const f = inhouseFixture(); let worker, finish;
  try {
    const waiting = f.ten(), playing = f.ten(11); f.ready(playing);
    const response = new Promise(resolve => {finish = resolve;});
    worker = createInhouseWorker(f.store, {live: () => response, history: async () => [], details: async () => null}, {clock: f.clock});
    const step = worker.step();
    f.advance(60001); worker.maintain();
    assert.equal(f.store.game(waiting).status, 'cancelled');
    assert.equal(f.store.game(playing).status, 'awaiting_game');
    finish([]); await step;
    worker.close();
    assert.equal(f.db.prepare('SELECT Owner FROM InhouseWorker').get().Owner, null);
    assert.equal(worker.maintain(), false);
  } finally {finish?.([]); worker?.close(); f.close();}
});
