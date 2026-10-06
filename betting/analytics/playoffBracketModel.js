// Simulate the saved playoff bracket, not an assumed fixed map count. Upper
// bracket losses drop into the destination's second slot, as the league's
// bracket updater does; other winners follow winnerToSlot.
export function preparePlayoffBracket(json, externalTeamIds) {
  let bracket;
  try { bracket = typeof json === 'string' ? JSON.parse(json) : json; }
  catch { throw new Error('PlayoffBracket contains invalid JSON'); }
  const upper = bracket?.upperBracket?.flatMap(round => round.matches || []) || [];
  const lower = bracket?.lowerBracket?.flatMap(round => round.matches || []) || [];
  const grand = bracket?.grandFinals || [];
  if (!upper.length || !lower.length || grand.length !== 1) {
    throw new Error('PlayoffBracket is incomplete');
  }
  const nodes = [...upper, ...lower, ...grand];
  const byId = new Map(nodes.map((node, index) => [node.id, { ...node, index }]));
  if (byId.size !== nodes.length) throw new Error('Duplicate playoff bracket match ID');
  const starters = [];
  for (const node of nodes) {
    if (!node.id || !['upper', 'lower', 'grand'].includes(node.bracket) ||
      node.seriesId || Number(node.team1Score || 0) || Number(node.team2Score || 0)) {
      throw new Error('Playoff forecast requires an unplayed, valid bracket');
    }
    const isFirst = node.round === 1 && node.bracket !== 'grand';
    if (isFirst) {
      if (!node.team1Id || !node.team2Id) throw new Error('First-round bracket teams are missing');
      starters.push(String(node.team1Id), String(node.team2Id));
    } else if (node.team1Id || node.team2Id) {
      throw new Error('Future bracket slots must be empty before playoff forecasts');
    }
    if (node.bracket !== 'grand') {
      const next = byId.get(node.winnerTo);
      if (!next || next.index <= byId.get(node.id).index ||
        ![1, 2].includes(node.winnerToSlot)) {
        throw new Error(`Invalid winner route in ${node.id}`);
      }
      if (node.loserTo && (!byId.has(node.loserTo) ||
        byId.get(node.loserTo).index <= byId.get(node.id).index)) {
        throw new Error(`Invalid loser route in ${node.id}`);
      }
    }
  }
  const expected = externalTeamIds.map(String).sort();
  if (starters.length !== expected.length ||
    starters.sort().some((team, index) => team !== expected[index])) {
    throw new Error('First-round bracket teams do not match playoff seeding');
  }
  return nodes;
}

export function simulatePlayoffBracket(nodes, strengths, random) {
  const slots = new Map(nodes.map(node => [node.id, [
    node.round === 1 && node.bracket !== 'grand' ? String(node.team1Id) : null,
    node.round === 1 && node.bracket !== 'grand' ? String(node.team2Id) : null,
  ]]));
  const mapsByTeam = new Map([...strengths.keys()].map(team => [String(team), 0]));
  const route = (id, slot, team) => {
    const target = slots.get(id);
    if (!target || target[slot - 1]) throw new Error(`Playoff route collides at ${id}`);
    target[slot - 1] = team;
  };
  let champion = null;
  for (const node of nodes) {
    const [a, b] = slots.get(node.id);
    if (!a || !b || a === b || !strengths.has(a) || !strengths.has(b)) {
      throw new Error(`Playoff bracket match ${node.id} cannot be filled`);
    }
    const p = 1 / (1 + Math.exp(-(strengths.get(a) - strengths.get(b)) / 500));
    const targetWins = node.bracket === 'grand' ? 3 : 2;
    let aWins = 0;
    let bWins = 0;
    while (aWins < targetWins && bWins < targetWins) {
      if (random() < p) aWins += 1;
      else bWins += 1;
      mapsByTeam.set(a, mapsByTeam.get(a) + 1);
      mapsByTeam.set(b, mapsByTeam.get(b) + 1);
    }
    const winner = aWins > bWins ? a : b;
    const loser = winner === a ? b : a;
    if (node.bracket === 'grand') champion = winner;
    else {
      route(node.winnerTo, node.winnerToSlot, winner);
      if (node.loserTo) route(node.loserTo, 2, loser);
    }
  }
  if (!champion) throw new Error('Playoff bracket has no champion');
  return { champion, mapsByTeam };
}
