import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLeagueSeries, seriesMatchesForDisplay } from '../client/src/utils/leagueSeries.js';

const series = [
  { SeriesId: 3, Team1: 10, Team2: 20, team_one: 'Old name', team_two: 'Second' },
  { SeriesId: 2, Team1: 10, Team2: 20 },
  { SeriesId: 1, Team1: 10, Team2: 20 },
];

function match(MatchId, SeriesId, RadiantTeamId, DireTeamId, WinnerSide) {
  return { MatchId, SeriesId, RadiantTeamId, DireTeamId, WinnerSide,
    RadiantTeamName: RadiantTeamId === 10 ? 'First' : 'Second',
    DireTeamName: DireTeamId === 10 ? 'First' : 'Second', matchPlayers: [{ PlayerId: 100 }] };
}

test('series scores follow team identity across side swaps and keep match details', () => {
  const matches = [
    match(302, '3', 20, 10, 'd'),
    match(301, 3, 10, 20, 'r'),
    match(303, 3, 20, 10, 'r'),
    match(201, 2, 10, 20, 'r'),
    match(202, 2, 20, 10, 'r'),
  ];
  const grouped = groupLeagueSeries(series, matches);
  assert.deepEqual(grouped.series.map(item => item.SeriesId), [3, 2]);
  assert.deepEqual(grouped.series.map(item => [item.team1Wins, item.team2Wins]), [[2, 1], [1, 1]]);
  assert.deepEqual(grouped.series[0].matches.map(item => item.MatchId), [301, 302, 303]);
  assert.equal(grouped.series[0].team_one, 'First');
  assert.equal(grouped.series[0].matches[0], matches[1]);
  assert.equal(grouped.series[0].hasPendingResults, false);
  assert.deepEqual(grouped.ungroupedMatches, []);
  assert.equal(matches[0].MatchId, 302);
  assert.equal(series[0].matches, undefined);
});

test('unknown results stay pending and matches without saved series remain visible', () => {
  const matches = [match(301, 3, 10, 20, 'r'), match(302, 3, 20, 10, null),
    match(401, null, 10, 20, 'd'), match(402, 99, 10, 20, 'r')];
  const grouped = groupLeagueSeries(series, matches);
  assert.equal(grouped.series[0].team1Wins, 1);
  assert.equal(grouped.series[0].team2Wins, 0);
  assert.equal(grouped.series[0].hasPendingResults, true);
  assert.deepEqual(grouped.ungroupedMatches.map(item => item.MatchId), [401, 402]);
  assert.deepEqual(groupLeagueSeries([], []), { series: [], ungroupedMatches: [] });
});

test('recent series API games use the shared card format and score correctly across side swaps', () => {
  const data = [{ ...series[0], seriesMatches: [
    { MatchId: 301, rad_team_id: 10, dire_team_id: 20, rad_team_name: 'First', dire_team_name: 'Second', WinnerSide: 'r', Duration: 1800 },
    { MatchId: 302, rad_team_id: 20, dire_team_id: 10, rad_team_name: 'Second', dire_team_name: 'First', WinnerSide: 'r', Duration: 2400 },
  ] }];
  const matches = seriesMatchesForDisplay(data);
  const result = groupLeagueSeries(data, matches).series[0];
  assert.deepEqual([result.team1Wins, result.team2Wins], [1,1]);
  assert.deepEqual(matches.map(match => match.SeriesId), [3,3]);
  assert.equal(matches[1].RadiantTeamName, 'Second');
  assert.equal(matches[1].DireTeamId, 10);
  assert.equal(matches[0].Duration, 1800);
  assert.equal(data[0].seriesMatches[0].SeriesId, undefined);
  assert.deepEqual(seriesMatchesForDisplay([{ SeriesId: 99 }]), []);
});
