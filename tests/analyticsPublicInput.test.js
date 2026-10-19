import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicMatches, publicMatchPages } from '../analytics/publicMatchInput.js';

const match = { match_id: 1, hero_id: 2, kills: 0, deaths: 1, assists: 2, player_slot: 0,
  radiant_win: true, start_time: Date.parse('2026-10-01T12:00:00Z') / 1000 };

test('public input keeps measured zeros, rejects missing values, and computes side-specific wins', () => {
  const rows = normalizePublicMatches(12, [match, match, { ...match, match_id: 2, kills: null },
    { ...match, match_id: 3, player_slot: 128 }, { ...match, match_id: 4, start_time: null }]);
  assert.deepEqual(rows.map(row => [row.MatchId, row.Kills, row.Won]), [[1, 0, 1], [3, 0, 0]]);
});

test('public history requests paginate the 90-day window and retry transient failures', async () => {
  const requests = [];
  let calls = 0;
  const fetchImpl = async url => {
    requests.push(new URL(url)); calls += 1;
    if (calls === 1) return { ok: false, status: 429 };
    return { ok: true, json: async () => calls === 2
      ? [match, { ...match, match_id: 2 }] : [{ ...match, match_id: 3 }] };
  };
  const rows = [];
  for await (const page of publicMatchPages(12, { fetchImpl, pause: async () => {}, pageSize: 2 })) rows.push(...page);
  assert.equal(rows.length, 3);
  assert.deepEqual(requests.map(url => url.searchParams.get('offset')), ['0', '0', '2']);
  assert.equal(requests.every(url => url.searchParams.get('date') === '90'), true);
});

test('invalid or repeating pages fail instead of declaring incomplete coverage fresh', async () => {
  const options = { pause: async () => {}, pageSize: 1 };
  await assert.rejects(async () => {
    for await (const page of publicMatchPages(12, { ...options,
      fetchImpl: async () => ({ ok: true, json: async () => [match] }) })) void page;
  }, /did not advance/);
  await assert.rejects(async () => {
    for await (const page of publicMatchPages(12, { ...options,
      fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'not a page' }) }) })) void page;
  }, /Invalid public match response/);
});
