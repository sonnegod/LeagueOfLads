import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduledMatch } from '../discordbot/parseScheduledMatch.js';

function post(content, createdAt, id = '1') {
  return { id, content, createdAt: new Date(createdAt),
    mentions: { roles: new Map([['a', { name: 'One' }], ['b', { name: 'Two' }]]) } };
}

test('Discord schedule parser handles date, tonight, and compact Eastern times', () => {
  assert.deepEqual(parseScheduledMatch(post('X vs Y Tuesday, 9/8 at 9 pm est',
    '2026-09-09T13:27:00Z')), {
    team1: 'One', team2: 'Two', date: '2026-09-08',
    startAt: '2026-09-09T01:00:00.000Z', sourceMessageId: '1',
  });
  assert.equal(parseScheduledMatch(post('X vs Y tonight 9 est',
    '2026-09-11T16:24:00Z')).startAt, '2026-09-12T01:00:00.000Z');
  assert.equal(parseScheduledMatch(post('X vs Y 9/21 Monday at 9est',
    '2026-09-20T16:24:00Z')).startAt, '2026-09-22T01:00:00.000Z');
  assert.equal(parseScheduledMatch(post('X vs Y 9/27 Sunday at 9est',
    '2026-09-23T17:08:00Z')).date, '2026-09-27');
});

test('parser respects year rollover and keeps unknown time out of publishable data', () => {
  assert.equal(parseScheduledMatch(post('X vs Y 1/2 at 9est',
    '2026-12-30T15:00:00Z')).date, '2027-01-02');
  assert.equal(parseScheduledMatch(post('X vs Y 9/21',
    '2026-09-20T15:00:00Z')).startAt, null);
  assert.equal(parseScheduledMatch(post('X vs Y 2/30 at 9est',
    '2026-02-01T15:00:00Z')), null);
});
