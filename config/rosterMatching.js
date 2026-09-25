export function normalizeRosterName(name) {
  return String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function planRosterLinks(entries, teams) {
  const entriesByName = new Map();
  const teamsByName = new Map();
  for (const entry of entries) {
    const name = normalizeRosterName(entry.DisplayName);
    if (name) entriesByName.set(name, [...(entriesByName.get(name) || []), entry]);
  }
  for (const team of teams) {
    const name = normalizeRosterName(team.TeamName);
    if (name) teamsByName.set(name, [...(teamsByName.get(name) || []), team]);
  }
  return [...entriesByName].flatMap(([name, matchingEntries]) => {
    const matchingTeams = teamsByName.get(name) || [];
    return matchingEntries.length === 1 && matchingTeams.length === 1
      ? [{ entryId: matchingEntries[0].EntryId, teamId: matchingTeams[0].TeamId }]
      : [];
  });
}
