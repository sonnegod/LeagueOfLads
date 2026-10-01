import test from 'node:test';
import assert from 'node:assert/strict';
import { randomizeGroups } from '../config/groupRandomizer.js';

test('randomizer produces 100 balanced candidates and selects among the best ten', () => {
  const teams = Array.from({ length: 11 }, (_, index) => ({
    TeamSubmissionId: index + 1, AverageMMR: 5600 + index * 150,
  }));
  let calls = 0;
  let seed = 1234567;
  const random = () => {
    calls++;
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const choice = randomizeGroups(teams, 3, random);
  assert.deepEqual(choice.groups.map(group => group.length), [4, 4, 3]);
  assert.deepEqual(choice.groups.flat().map(team => team.TeamSubmissionId).sort((a, b) => a - b),
    teams.map(team => team.TeamSubmissionId));
  assert.equal(calls, 100 * (teams.length - 1) + 1);
  assert.ok(choice.spread >= 0);
});
