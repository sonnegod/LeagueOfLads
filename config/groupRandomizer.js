export function groupSpread(groups) {
  const averages = groups.map(group => group.length
    ? group.reduce((sum, team) => sum + Number(team.AverageMMR), 0) / group.length : 0);
  return averages.length ? Math.max(...averages) - Math.min(...averages) : 0;
}

export function randomizeGroups(teams, groupCount, random = Math.random) {
  if (!Number.isInteger(groupCount) || groupCount < 1 || !Array.isArray(teams) || teams.length < groupCount) {
    throw new Error('Create groups and have at least one team for each group');
  }
  const sizes = Array.from({ length: groupCount }, (_, index) =>
    Math.floor(teams.length / groupCount) + (index < teams.length % groupCount ? 1 : 0));
  const candidates = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    const shuffled = [...teams];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    let offset = 0;
    const groups = sizes.map(size => {
      const group = shuffled.slice(offset, offset + size);
      offset += size;
      return group;
    });
    candidates.push({ groups, spread: groupSpread(groups) });
  }
  candidates.sort((left, right) => left.spread - right.spread);
  return candidates[Math.floor(random() * Math.min(10, candidates.length))];
}
