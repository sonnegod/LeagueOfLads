import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ANALYTICS_VERSION = 6;
export const ANALYTICS_DEFAULTS = Object.freeze({
  publicLookbackDays: 90,
  recentGames: 10,
  minimumSamples: 5,
  minimumRosterGames: 5,
  sourceStaleHours: 48,
  retainedGenerations: 2,
  dailyHighlights: 5,
  timezone: 'America/New_York',
});

export function analyticsPaths(env = process.env) {
  const directory = env.ENVIRONMENT === 'DEV' ? resolve(root, 'db') : '/root/LeagueOfLads/db';
  return {
    league: resolve(env.ANALYTICS_LEAGUE_DB || resolve(directory, 'LadsData.db')),
    public: resolve(env.ANALYTICS_PUBLIC_DB || resolve(directory, 'public.db')),
    analytics: resolve(env.ANALYTICS_DB || resolve(directory, 'Analytics.db')),
  };
}

export function positiveId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return number;
}

export function previewAnalyticsPath(path, leagueId) {
  leagueId = positiveId(leagueId, 'preview league');
  if (!leagueId) throw new Error('A preview league is required');
  return resolve(dirname(path), `Analytics-preview-${leagueId}.db`);
}
