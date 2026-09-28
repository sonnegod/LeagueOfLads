export function filterRuleItems(items, search) {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return items;

  const groups = [];
  let group = { header: null, rules: [] };
  for (const item of items) {
    if (item.ItemType === 'header') {
      groups.push(group);
      group = { header: item, rules: [] };
    } else {
      group.rules.push(item);
    }
  }
  groups.push(group);

  return groups.flatMap(({ header, rules }) => {
    if (header?.RuleText.toLocaleLowerCase().includes(term)) return [header, ...rules];
    const matches = rules.filter((rule) => rule.RuleText.toLocaleLowerCase().includes(term));
    return matches.length && header ? [header, ...matches] : matches;
  });
}
