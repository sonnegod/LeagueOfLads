import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlayoffBracket } from '../client/src/utils/playoffBracket.js';
import { preparePlayoffBracket, simulatePlayoffBracket }
  from '../betting/analytics/playoffBracketModel.js';

test('playoff model follows stored upper/lower routes and counts Bo3/Bo5 maps', () => {
  const bracket = generatePlayoffBracket([
    { Bracket: 'upper' }, { Bracket: 'upper' },
    { Bracket: 'lower' }, { Bracket: 'lower' },
  ]);
  Object.assign(bracket.upperBracket[0].matches[0], { team1Id: '101', team2Id: '102' });
  Object.assign(bracket.lowerBracket[0].matches[0], { team1Id: '103', team2Id: '104' });
  const nodes = preparePlayoffBracket(bracket, [101, 102, 103, 104]);
  const strength = new Map([['101', 10000], ['102', 1000],
    ['103', 1000], ['104', 1000]]);
  const result = simulatePlayoffBracket(nodes, strength, () => 0.25);
  assert.equal(result.champion, '101');
  assert.equal([...result.mapsByTeam.values()].reduce((a, b) => a + b, 0), 18);
  assert.throws(() => preparePlayoffBracket(bracket, [101, 102, 103, 105]),
    /do not match playoff seeding/);
  bracket.upperBracket[0].matches[0].team1Score = 2;
  assert.throws(() => preparePlayoffBracket(bracket, [101, 102, 103, 104]),
    /unplayed/);
});
