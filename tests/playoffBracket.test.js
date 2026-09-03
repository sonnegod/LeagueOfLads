import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generatePlayoffBracket,
  normalizeEqualSizePlayoffBracket
} from '../client/src/utils/playoffBracket.js';

const teams = (upperCount, lowerCount) => [
  ...Array.from({ length: upperCount }, (_, index) => ({
    TeamId: index + 1,
    TeamName: `Upper ${index + 1}`,
    Bracket: 'upper'
  })),
  ...Array.from({ length: lowerCount }, (_, index) => ({
    TeamId: upperCount + index + 1,
    TeamName: `Lower ${index + 1}`,
    Bracket: 'lower'
  }))
];

test('equal starting brackets meet in lower round 2', () => {
  const bracket = generatePlayoffBracket(teams(8, 8));

  assert.equal(bracket.lowerBracket.length, 6);
  assert.deepEqual(bracket.lowerBracket.map((round) => round.matches.length), [4, 4, 2, 2, 1, 1]);
  assert.equal(bracket.upperBracket[0].matches[0].loserTo, 'lb-r2-m1');
  assert.equal(bracket.lowerBracket[0].matches[0].winnerTo, 'lb-r2-m1');
  assert.equal(bracket.lowerBracket[1].matches[0].isDropRound, true);
  assert.equal(bracket.lowerBracket[1].matches[0].dropSourceRound, 1);
});

test('larger lower bracket retains the existing round 3 first drop', () => {
  const bracket = generatePlayoffBracket(teams(8, 16));

  assert.equal(bracket.lowerBracket.length, 7);
  assert.deepEqual(bracket.lowerBracket.map((round) => round.matches.length), [8, 4, 4, 2, 2, 1, 1]);
  assert.equal(bracket.upperBracket[0].matches[0].loserTo, 'lb-r3-m1');
});

test('legacy equal-size brackets are shifted without losing first-round winners or UB drops', () => {
  const bracket = generatePlayoffBracket(teams(8, 8));
  bracket.upperBracket.forEach((round) => {
    round.matches.forEach((match) => {
      match.loserTo = `lb-r${(round.round * 2) + 1}-m${match.matchNum}`;
    });
  });
  bracket.lowerBracket[1].matches = bracket.lowerBracket[1].matches.slice(0, 2);
  bracket.lowerBracket[0].matches.forEach((match, index) => {
    match.matchNum = index + 1;
    match.id = `lb-r1-m${index + 1}`;
    match.team1Id = 20 + index;
    match.team1Name = `Winner ${index + 1}`;
    match.team2Id = 30 + index;
    match.team2Name = `Loser ${index + 1}`;
    match.team1Score = 2;
    match.team2Score = 0;
  });
  bracket.upperBracket[0].matches.forEach((match, index) => {
    match.team1Id = 40 + index;
    match.team1Name = `UB winner ${index + 1}`;
    match.team2Id = 50 + index;
    match.team2Name = `UB loser ${index + 1}`;
    match.team1Score = 2;
    match.team2Score = 0;
  });

  const normalized = normalizeEqualSizePlayoffBracket(bracket);

  assert.equal(normalized.changed, true);
  assert.equal(normalized.bracket.lowerBracket.length, 6);
  assert.deepEqual(normalized.bracket.lowerBracket.map((round) => round.matches.length), [4, 4, 2, 2, 1, 1]);
  assert.equal(normalized.bracket.lowerBracket[1].matches[0].id, 'lb-r2-m1');
  assert.equal(normalized.bracket.lowerBracket[1].matches[0].team1Name, 'Winner 1');
  assert.equal(normalized.bracket.lowerBracket[1].matches[0].team2Name, 'UB loser 1');
  assert.equal(normalized.bracket.upperBracket[1].matches[0].loserTo, 'lb-r4-m1');
});

test('legacy migration refuses to remove a lower round that already has results', () => {
  const bracket = generatePlayoffBracket(teams(8, 8));
  bracket.upperBracket.forEach((round) => {
    round.matches.forEach((match) => {
      match.loserTo = `lb-r${(round.round * 2) + 1}-m${match.matchNum}`;
    });
  });
  bracket.lowerBracket[1].matches[0].team1Score = 2;
  bracket.lowerBracket[1].matches[0].team2Score = 1;

  const normalized = normalizeEqualSizePlayoffBracket(bracket);

  assert.equal(normalized.changed, false);
  assert.match(normalized.error, /already has a result/);
  assert.equal(normalized.bracket.lowerBracket.length, 6);
});
