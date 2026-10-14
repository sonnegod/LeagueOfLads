import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { contentWindow } from './contentWindows.js';

const metricLabels = { Kills: 'Kills', Assists: 'Assists', GPM: 'GPM', XPM: 'XPM', HeroDamage: 'Hero damage', TowerDamage: 'Tower damage', Healing: 'Healing' };

function ready(db) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'HighlightEvents'").get());
}

// Deliberate allowlist, including evidence. Neither private features nor arbitrary
// stored JSON properties are serializable through this consumer.
export function highlightDTO(row, admin = false) {
  const evidence = JSON.parse(row.EvidenceJson);
  const matchIds = Array.isArray(evidence.matchIds) ? evidence.matchIds.filter(Number.isSafeInteger) : [];
  const value = typeof evidence.value === 'number' && Number.isFinite(evidence.value) ? evidence.value.toLocaleString('en-US') : null;
  const metricLabel = Object.hasOwn(metricLabels, evidence.metric) ? metricLabels[evidence.metric] : null;
  const unit = ['GPM', 'XPM'].includes(evidence.metric) ? metricLabel : metricLabel?.toLowerCase();
  const scope = { regular: 'group stage', playoff: 'playoff', tiebreaker: 'tiebreaker' }[row.Stage] || 'league';
  const achievement = value && metricLabel
    ? `${value} ${unit}${evidence.comparison === 'season_stage_through_match_id' ? ` — a new ${scope} high` : ''}` : null;
  const payload = {
    id: row.HighlightId, seasonId: row.SeasonId, leagueId: row.LeagueId, leagueName: row.LeagueName,
    category: row.Category, period: row.Period, stage: row.Stage,
    title: row.TitleOverride ?? row.Title, body: row.BodyOverride ?? row.Body,
    notification: row.TitleOverride ?? achievement ?? row.Title,
    publishedAt: row.FirstPublishedAtUtc, updatedAt: row.UpdatedAtUtc, occurredAt: row.OccurredAtUtc,
    revision: row.Revision, matchIds: matchIds.slice(0, 5), supportingMatchCount: matchIds.length,
    playerId: Number.isSafeInteger(evidence.playerId) ? evidence.playerId : null,
    playerName: typeof evidence.playerName === 'string' ? evidence.playerName : row.PlayerId ? `Player ${row.PlayerId}` : null,
    teamName: typeof evidence.teamName === 'string' ? evidence.teamName : evidence.teamId ? `Team ${evidence.teamId}` : null,
    teamId: Number.isSafeInteger(evidence.teamId) ? evidence.teamId : null,
    heroId: Number.isSafeInteger(evidence.heroId) ? evidence.heroId : null,
    seriesId: Number.isSafeInteger(evidence.seriesId) ? evidence.seriesId : null,
    membership: ['rostered', 'stand_in', 'unknown'].includes(evidence.membership) ? evidence.membership : null,
    weekStart: evidence.weekStart ?? null, weekEnd: evidence.weekEnd ?? null,
    day: evidence.day ?? null,
    excludesUndatedMatches: Boolean(evidence.excludesUndatedMatches),
    stat: metricLabel && typeof evidence.value === 'number' && Number.isFinite(evidence.value)
      ? { label: metricLabel, value: evidence.value }
      : row.Category === 'survival' ? { label: 'K/D/A', value: `${evidence.kills}/${evidence.deaths}/${evidence.assists}` }
      : row.Category === 'variety' ? { label: 'Heroes', value: `${evidence.heroes} in ${evidence.games} games` } : null,
  };
  if (admin) Object.assign(payload, { status: row.Status, hidden: Boolean(row.Hidden),
    generatedTitle: row.Title, generatedBody: row.Body, overrideNeedsReview: Boolean(row.OverrideNeedsReview),
    hasOverride: row.TitleOverride !== null || row.BodyOverride !== null });
  return payload;
}

export function readHighlightFeed(path, { leagueId = null, before = null, limit = 6, admin = false,
  status = 'published', allowPreview = false, period = 'all', now = new Date() } = {}) {
  const window = contentWindow(period, now);
  if (!existsSync(path)) return { available: false, highlights: [], nextBefore: null, paused: false };
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 1000');
    return db.transaction(() => {
      if (!ready(db)) return { available: false, highlights: [], nextBefore: null, paused: false };
      const scope = db.prepare(`SELECT r.Scope FROM AnalyticsRuns r JOIN AnalyticsState s ON s.PublishedRunId = r.RunId WHERE s.Id = 1`).get();
      // allowPreview is supplied only by the protected homepage-preview route.
      // It preserves public visibility filters and the public DTO.
      if (!admin && !allowPreview && scope?.Scope === 'legacy_preview') return { available: false, highlights: [], nextBefore: null, paused: false };
      const rows = db.prepare(`SELECT * FROM HighlightEvents WHERE (? IS NULL OR LeagueId = ?)
        AND (? IS NULL OR HighlightId < ?)
        AND (? IS NULL OR (CASE WHEN PlayerId IS NOT NULL THEN OccurredAtUtc ELSE COALESCE(OccurredAtUtc, FirstPublishedAtUtc) END >= ?
          AND CASE WHEN PlayerId IS NOT NULL THEN OccurredAtUtc ELSE COALESCE(OccurredAtUtc, FirstPublishedAtUtc) END <= ?))
        ${admin ? 'AND (? IS NULL OR Status = ?)' : "AND Status = 'published' AND Hidden = 0 AND OverrideNeedsReview = 0"}
        ORDER BY HighlightId DESC LIMIT ?`).all(...[leagueId, leagueId, before, before, window.from, window.from, window.to,
          ...(admin ? [status === 'all' ? null : status, status === 'all' ? null : status] : []), limit + 1]);
      const page = rows.slice(0, limit);
      return { available: true, highlights: page.map(row => highlightDTO(row, admin)),
        nextBefore: rows.length > limit ? page.at(-1).HighlightId : null,
        ...(admin ? { paused: Boolean(db.prepare('SELECT Paused FROM HighlightSettings WHERE Id = 1').get().Paused) } : {}) };
    })();
  } finally { db.close(); }
}
