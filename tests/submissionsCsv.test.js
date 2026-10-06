import test from 'node:test';
import assert from 'node:assert/strict';
import { submissionsCsv } from '../config/submissionsCsv.js';

test('submission export includes team and player fields without screenshots', () => {
  const csv = submissionsCsv([
    {
      TeamSubmissionId: 42, IsManual: 0, TeamName: 'The "Lads", Inc.',
      CaptainName: 'Captain', CaptainId: 123, AverageMMR: 6123,
      SubmittedAt: '2026-10-01T12:00:00Z', UpdatedAt: '2026-10-01T13:00:00Z',
      players: [{ Slot: 0, PlayerName: '=SUM(1,1)', PlayerId: 123, MMR: 6123,
        DotaProfileUrl: 'https://www.dotabuff.com/players/123',
        ScreenshotData: 'private image bytes', ScreenshotMime: 'image/png' }],
    },
    { TeamSubmissionId: 43, IsManual: 1, TeamName: 'Manual team', AverageMMR: 6200, players: [] },
  ]);

  assert.ok(csv.startsWith('\uFEFF"Submission ID","Type","Team name"'));
  assert.match(csv, /"The ""Lads"", Inc\."/);
  assert.match(csv, /"'=SUM\(1,1\)"/);
  assert.match(csv, /"Manual","Manual team"/);
  assert.equal((csv.match(/profile URL/g) || []).length, 5);
  assert.equal(csv.includes('Screenshot'), false);
  assert.equal(csv.includes('private image bytes'), false);
});
