// Stable market definitions shared by forecasting, publishing, and settlement.
// GPM/XPM are rates: season totals of those fields are not meaningful markets.
export const PLAYER_STATS = Object.freeze([
  { key: 'kills', column: 'Kills', label: 'kills' },
  { key: 'deaths', column: 'Deaths', label: 'deaths' },
  { key: 'assists', column: 'Assists', label: 'assists' },
  { key: 'gpm', column: 'GPM', label: 'GPM' },
  { key: 'xpm', column: 'XPM', label: 'XPM' },
]);

export const REGULAR_PLAYER_MARKETS = Object.freeze([
  ...PLAYER_STATS.filter(stat => ['kills', 'deaths', 'assists'].includes(stat.key))
    .map(stat => ({ key: `regular:season_${stat.key}`, stat: stat.key,
      aggregate: 'total', title: `Most regular-season ${stat.label}` })),
  ...PLAYER_STATS.map(stat => ({ key: `regular:average_${stat.key}`, stat: stat.key,
    aggregate: 'average', title: `Highest regular-season average ${stat.label}` })),
  ...PLAYER_STATS.map(stat => ({ key: `regular:game_${stat.key}`, stat: stat.key,
    aggregate: 'max', title: `Highest single-game ${stat.label} in the regular season` })),
]);

export const PLAYOFF_PLAYER_MARKETS = Object.freeze(REGULAR_PLAYER_MARKETS.map(market => ({
  ...market, key: market.key.replace(/^regular:/, 'playoffs:'),
  title: market.title.replace('regular-season', 'playoff').replace('in the regular season', 'in the playoffs'),
})));

export const DEFAULT_AVERAGE_MINIMUM_PARTICIPATION = 0.5;

export function regularSchedule(groupTeamCount) {
  if (!Number.isSafeInteger(groupTeamCount) || groupTeamCount < 2) {
    throw new Error('A group needs at least two teams');
  }
  const series = groupTeamCount - 1;
  return { series, maps: series * 2 };
}

export function averageEligible(appearances, scheduledMaps,
  fraction = DEFAULT_AVERAGE_MINIMUM_PARTICIPATION) {
  if (!Number.isSafeInteger(appearances) || appearances < 0 ||
      !Number.isSafeInteger(scheduledMaps) || scheduledMaps < 1 ||
      !Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error('Invalid average-market participation input');
  }
  return appearances >= Math.ceil(scheduledMaps * fraction);
}
