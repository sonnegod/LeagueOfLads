import {INHOUSE_CALIBRATION_GAMES} from '../shared/inhouseRating.js';

export const PICK_ORDER = ['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A'];
export const ROLES = [1, 2, 3, 4, 5];
export const acceptedRoles = player => player.offRole ? ROLES : player.roles;
const preferenceCost = (player, role) => {
  const index = player.roles.indexOf(role);
  return index < 0 ? 5 : index;
};
const earlier = (a, b) => a.joinedAt - b.joinedAt || a.playerId - b.playerId;
const less = (a, b) => !b || a.some((v, i) => v !== b[i] && a.slice(0, i).every((x, j) => x === b[j]) && v < b[i]);

// Five base-three digits count up to two players per position. This considers
// the entire queue in O(queue length * 243 * 5), without enumerating ten-player
// combinations. The first score component protects the oldest feasible player.
export function selectPlayers(queue, mode) {
  const players = [...queue].sort(earlier);
  if (players.length < 10) return [];
  if (mode === 'fifo') return players.slice(0, 10);
  const dp = Array(243).fill(null);
  dp[0] = {score: [Infinity, 0, 0], path: null};
  const powers = [1, 3, 9, 27, 81];
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    for (let mask = 242; mask >= 0; mask--) {
      const previous = dp[mask];
      if (!previous) continue;
      for (const role of acceptedRoles(player)) {
        const step = powers[role - 1];
        if (Math.floor(mask / step) % 3 === 2) continue;
        const next = mask + step;
        const score = [Math.min(previous.score[0], i), previous.score[1] + preferenceCost(player, role), previous.score[2] + i];
        if (less(score, dp[next]?.score)) dp[next] = {score, path: {player, previous: previous.path}};
      }
    }
  }
  const result = [];
  for (let path = dp[242]?.path; path; path = path.previous) result.push(path.player);
  return result.sort(earlier);
}

export function captains(players) {
  const sorted = [...players].sort((a, b) => b.rating - a.rating || earlier(a, b));
  // B is the highest-rated; the lower-rated captain A gets the first pick.
  return {A: sorted[1].playerId, B: sorted[0].playerId};
}

function assignRoles(team) {
  const dp = Array(32).fill(null);
  dp[0] = {cost: 0, roles: {}};
  for (const player of team) {
    const next = Array(32).fill(null);
    for (let mask = 0; mask < 32; mask++) {
      if (!dp[mask]) continue;
      for (const role of acceptedRoles(player)) {
        const bit = 1 << (role - 1);
        if (mask & bit) continue;
        const target = mask | bit, cost = dp[mask].cost + preferenceCost(player, role);
        if (!next[target] || cost < next[target].cost) next[target] = {cost, roles: {...dp[mask].roles, [player.playerId]: role}};
      }
    }
    for (let i = 0; i < 32; i++) dp[i] = next[i];
  }
  return dp[31];
}

// Only 252 partitions of ten players. Captains and picks constrain these further.
// Return the best complete, feasible draft, also used to reject impossible picks.
export function bestTeams(players, mode, fixed = {}, seeds = captains(players)) {
  if (players.length === 2) return {sides: {[seeds.A]: 'A', [seeds.B]: 'B'}, positions: {}};
  if (players.length !== 10) return null;
  const forced = {...fixed, [seeds.A]: 'A', [seeds.B]: 'B'};
  let best = null;
  for (let mask = 0; mask < 1024; mask++) {
    const a = [], b = [];
    let valid = true;
    for (let i = 0; i < 10; i++) {
      const side = mask & (1 << i) ? 'A' : 'B', p = players[i];
      if (forced[p.playerId] && forced[p.playerId] !== side) {valid = false; break;}
      (side === 'A' ? a : b).push(p);
    }
    if (!valid || a.length !== 5 || b.length !== 5) continue;
    const ar = mode === 'preference' ? assignRoles(a) : {cost: 0, roles: {}};
    const br = mode === 'preference' ? assignRoles(b) : {cost: 0, roles: {}};
    if (!ar || !br) continue;
    const difference = Math.abs(a.reduce((n, p) => n + p.rating, 0) - b.reduce((n, p) => n + p.rating, 0)) / 5;
    const score = [difference, ar.cost + br.cost, mask];
    if (less(score, best?.score)) best = {
      score, sides: Object.fromEntries(players.map((p, i) => [p.playerId, mask & (1 << i) ? 'A' : 'B'])),
      positions: {...ar.roles, ...br.roles},
    };
  }
  return best;
}

export function autoPick(players, mode, fixed, turn, seeds) {
  const completion = bestTeams(players, mode, fixed, seeds);
  if (!completion) return null;
  const side = PICK_ORDER[turn];
  return [...players].filter(p => !fixed[p.playerId] && completion.sides[p.playerId] === side)
    .sort((a, b) => b.rating - a.rating || earlier(a, b))[0]?.playerId ?? null;
}

export function ratingChanges(players, winner) {
  const average = side => {
    const team = players.filter(p => p.side === side);
    return team.reduce((n, p) => n + p.rating, 0) / team.length;
  };
  const expectedA = 1 / (1 + 10 ** ((average('B') - average('A')) / 400));
  return players.map(p => {
    const expected = p.side === 'A' ? expectedA : 1 - expectedA, k = p.games < INHOUSE_CALIBRATION_GAMES ? 48 : 24;
    const delta = k * ((p.side === winner ? 1 : 0) - expected);
    return {playerId: p.playerId, before: p.rating, after: p.rating + delta, delta, expected, k};
  });
}
