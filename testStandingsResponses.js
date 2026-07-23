import assert from 'node:assert/strict';
import test from 'node:test';

import { compareStandings, getAppStandingsPayload } from './routes/utility/standingsResponses.js';

test('standings sort by wins, losses, Neustadtl, then team id', () => {
  const teams = [
    { TeamId: 4, Wins: 3, Losses: 2, Score: 7 },
    { TeamId: 3, Wins: 4, Losses: 3, Score: 9 },
    { TeamId: 2, Wins: 4, Losses: 2, Score: 6 },
    { TeamId: 1, Wins: 4, Losses: 2, Score: 8 },
  ];

  assert.deepEqual(teams.sort(compareStandings).map((team) => team.TeamId), [1, 2, 3, 4]);
});

test('app payload returns ranked groups and qualification buckets', async () => {
  const fakeDb = {
    getLeagueRules: () => ({
      UpperBracketTeams: 1,
      LowerBracketTeams: 1,
      EliminatedTeams: 1,
      HasTiebreaker: true,
      TiebreakerPosition: 2,
    }),
    getLeagueLeaderboard: async () => [
      { GroupId: 1, GroupName: 'Alpha', LeagueId: 10 },
      { GroupId: 2, GroupName: 'Beta', LeagueId: 10 },
    ],
    getGroupStats: async (group) => group.GroupId === 1 ? [
      { TeamId: 12, TeamName: 'Two', Wins: 2, Losses: 1, Score: 5 },
      { TeamId: 11, TeamName: 'One', Wins: 3, Losses: 0, Score: 8 },
      { TeamId: 13, TeamName: 'Three', Wins: 1, Losses: 2, Score: 3 },
      { TeamId: 14, TeamName: 'Four', Wins: 0, Losses: 3, Score: 1 },
    ] : [],
  };

  const payload = await getAppStandingsPayload(fakeDb, 10, { groupId: 1 });

  assert.equal(payload.groups.length, 1);
  assert.deepEqual(payload.groups[0].teams.map((team) => team.teamId), [11, 12, 13, 14]);
  assert.deepEqual(payload.groups[0].teams.map((team) => team.qualification), [
    'upper', 'tiebreaker', 'lower', 'eliminated',
  ]);
  assert.equal(payload.qualification.upperBracket[0].teamName, 'One');
  assert.equal(payload.qualification.eliminated[0].teamName, 'Four');
});
