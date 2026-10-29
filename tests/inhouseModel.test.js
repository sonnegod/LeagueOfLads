import test from 'node:test';
import assert from 'node:assert/strict';
import {inhouseCalibration} from '../client/src/utils/inhouseDisplay.js';
import {selectPlayers, bestTeams, captains, ratingChanges, autoPick, PICK_ORDER} from '../inhouses/model.js';

const player = (id, roles = [1, 2, 3, 4, 5], extra = {}) => ({playerId: id, joinedAt: id, roles, offRole: false, rating: 1000, games: 0, ...extra});

test('FIFO takes the earliest ten even when every player insists on mid', () => {
  const queue = Array.from({length: 12}, (_, i) => player(i + 1, [2]));
  assert.deepEqual(selectPlayers(queue.reverse(), 'fifo').map(p => p.playerId), [1,2,3,4,5,6,7,8,9,10]);
  assert.equal(selectPlayers(queue, 'preference').length, 0);
});

test('preference selection protects the oldest feasible player, skips an infeasible oldest, and uses off-role permission', () => {
  const queue = [player(1, [1]), ...Array.from({length: 10}, (_, i) => player(i + 2, [Math.floor(i / 2) + 1]))];
  const selected = selectPlayers(queue, 'preference');
  assert.equal(selected.length, 10); assert.ok(selected.some(p => p.playerId === 1));
  const supports = Array.from({length: 10}, (_, i) => player(i + 2, [i % 5 + 1]));
  assert.equal(selectPlayers([player(1, [1]), ...supports.filter(p => !p.roles.includes(2))], 'preference').length, 0);
  const missingOne = [player(1, [1]), player(2, [1]), player(3, [1]), ...Array.from({length: 8}, (_, i) => player(i + 4, [Math.floor(i / 2) + 2]))];
  const result = selectPlayers(missingOne, 'preference');
  assert.ok(result.some(p => p.playerId === 1)); assert.equal(result.length, 10);
  const flexible = Array.from({length: 10}, (_, i) => player(i + 1, [2], {offRole: true}));
  assert.equal(selectPlayers(flexible, 'preference').length, 10);
});

test('role-aware balancing fills positions 1–5, seeds the highest captains separately and respects draft picks', () => {
  const players = Array.from({length: 10}, (_, i) => player(i + 1, [Math.floor(i / 2) + 1], {rating: 1000 + i * 20}));
  const seeds = captains(players), teams = bestTeams(players, 'preference');
  assert.equal(seeds.A, 9); assert.equal(seeds.B, 10);
  assert.equal(teams.sides[9], 'A'); assert.equal(teams.sides[10], 'B');
  for (const side of ['A', 'B']) assert.deepEqual(players.filter(p => teams.sides[p.playerId] === side).map(p => teams.positions[p.playerId]).sort(), [1,2,3,4,5]);
  assert.equal(bestTeams(players, 'preference', {1: 'A', 2: 'A'}), null);
  assert.ok(bestTeams(players, 'fifo', {1: 'A', 2: 'A'}));
});

test('automatic picks complete the full snake without making strict roles impossible', () => {
  const players = Array.from({length: 10}, (_, i) => player(i + 1, [Math.floor(i / 2) + 1]));
  const seeds = captains(players), fixed = {[seeds.A]: 'A', [seeds.B]: 'B'};
  for (let turn = 0; turn < 8; turn++) {
    const next = autoPick(players, 'preference', fixed, turn, seeds);
    assert.ok(next && !fixed[next]); fixed[next] = PICK_ORDER[turn];
  }
  assert.equal(Object.values(fixed).filter(s => s === 'A').length, 5);
  assert.ok(bestTeams(players, 'preference', fixed, seeds));
});

test('calibration labels count down five rated games and disappear when complete', () => {
  assert.equal(inhouseCalibration(0), 'Calibrating (5 Games Left)');
  assert.equal(inhouseCalibration(1), 'Calibrating (4 Games Left)');
  assert.equal(inhouseCalibration(4), 'Calibrating (1 Game Left)');
  assert.equal(inhouseCalibration(5), null);
  assert.equal(inhouseCalibration(8), null);
});

test('Elo uses opponent strength and each player’s own calibration count', () => {
  const players = Array.from({length: 10}, (_, i) => ({...player(i + 1), side: i < 5 ? 'A' : 'B', games: i === 0 ? 5 : 4}));
  const changes = ratingChanges(players, 'A');
  assert.equal(changes[0].delta, 12); assert.equal(changes[1].delta, 24); assert.equal(changes[9].delta, -24);
  const favored = ratingChanges(players.map(p => ({...p, rating: p.side === 'A' ? 1400 : 1000})), 'A');
  assert.ok(favored[0].delta < changes[0].delta);
});

test('role-aware queue selection stays bounded for a large waiting room', () => {
  const queue = Array.from({length: 500}, (_, i) => player(i + 1, [i % 5 + 1]));
  const started = performance.now(), selected = selectPlayers(queue, 'preference');
  assert.equal(selected.length, 10); assert.ok(selected.some(p => p.playerId === 1));
  assert.ok(performance.now() - started < 3000);
});
