import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ANALYTICS_DEFAULTS, ANALYTICS_VERSION } from './config.js';

export const METRICS = Object.freeze([
  ['Kills', 'count', 1], ['Deaths', 'count', 1], ['Assists', 'count', 1], ['LastHits', 'count', 1],
  ['HeroDamage', 'damage', 1], ['TowerDamage', 'damage', 1], ['Healing', 'healing', 1],
  ['GPM', 'gold/minute', 0], ['XPM', 'experience/minute', 0], ['NetWorth', 'gold', 0],
]);

export function migrateAnalytics(db) {
  const existing = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'AnalyticsMigrations'`).get();
  const version = existing ? db.prepare('SELECT MAX(Version) AS Version FROM AnalyticsMigrations').get().Version : 0;
  if (version > ANALYTICS_VERSION) throw new Error('Analytics schema is newer than this application');
  if (version === ANALYTICS_VERSION) return;
  db.transaction(() => {
    db.exec(readFileSync(new URL('../scripts/db/analytics.schema.sql', import.meta.url), 'utf8'));
    db.exec(readFileSync(new URL('../scripts/db/analyticsWarehouse.schema.sql', import.meta.url), 'utf8'));
    if (!db.pragma('table_info(MatchFacts)').some(column => column.name === 'SourceObservedAtUtc')) {
      db.exec('ALTER TABLE MatchFacts ADD COLUMN SourceObservedAtUtc TEXT');
    }
    const runColumns = new Set(db.pragma('table_info(AnalyticsRuns)').map(column => column.name));
    for (const [column, type] of [['Scope', "TEXT NOT NULL DEFAULT 'signup_era'"], ['SelectedSeasonId', 'INTEGER'], ['PreviewLeagueId', 'INTEGER']]) {
      if (!runColumns.has(column)) db.exec(`ALTER TABLE AnalyticsRuns ADD COLUMN ${column} ${type}`);
    }
    const insert = db.prepare(`INSERT OR REPLACE INTO MetricDefinitions
      (Metric, Version, Unit, AllowsSeasonTotal, AllowsSeasonAverage, Definition) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const [metric, unit, total] of METRICS) insert.run(metric, 1, unit, total, metric === 'NetWorth' ? 0 : 1,
      'Recorded per-game values; arithmetic mean over valid samples. Season markets use official rostered regular-season games only.');
    db.prepare('INSERT INTO AnalyticsMigrations VALUES (?, ?)').run(ANALYTICS_VERSION, new Date().toISOString());
  })();
}

export function openAnalytics(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'").all();
    if (tables.length && !tables.some(table => table.name === 'AnalyticsMigrations')) {
      throw new Error('Target is not an Analytics database');
    }
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrateAnalytics(db);
    return db;
  } catch (error) { db.close(); throw error; }
}

// Operational browser projection. It deliberately contains no input features,
// source paths, source payloads, model output, screenshots, or stored exception messages.
export function safeAnalyticsStatus(db, now = new Date()) {
  const scoped = db.pragma('table_info(AnalyticsRuns)').some(column => column.name === 'Scope');
  const scopeFields = scoped ? 'r.Scope, r.SelectedSeasonId, r.PreviewLeagueId'
    : "'signup_era' AS Scope, NULL AS SelectedSeasonId, NULL AS PreviewLeagueId";
  const published = db.prepare(`SELECT r.RunId, r.FinishedAtUtc, r.AsOfUtc, r.MatchCount,
    r.PlayerGameCount, r.IssueCount, r.DurationMs, ${scopeFields} FROM AnalyticsState s
    JOIN AnalyticsRuns r ON r.RunId = s.PublishedRunId WHERE s.Id = 1`).get();
  const latest = db.prepare(`SELECT RunId, StartedAtUtc, FinishedAtUtc, Status, FailureCode
    FROM AnalyticsRuns ORDER BY RunId DESC LIMIT 1`).get();
  const sources = published ? db.prepare(`SELECT SourceName, LastSuccessAtUtc, LatestStatus
    FROM SourceSnapshots WHERE RunId = ? ORDER BY SourceName`).all(published.RunId).map(row => ({
      name: row.SourceName,
      lastSuccessAt: row.LastSuccessAtUtc,
      status: row.LatestStatus,
      stale: !row.LastSuccessAtUtc || now.getTime() - Date.parse(row.LastSuccessAtUtc)
        >= ANALYTICS_DEFAULTS.sourceStaleHours * 3600000,
    })) : [];
  const issues = published ? db.prepare(`SELECT Code AS code, COUNT(*) AS count
    FROM DataQualityIssues WHERE RunId = ? GROUP BY Code ORDER BY Code`).all(published.RunId) : [];
  const lock = db.prepare('SELECT LeaseUntilUtc FROM AnalyticsBuildLock WHERE Id = 1').get();
  const running = Boolean(lock && Date.parse(lock.LeaseUntilUtc) > now.getTime());
  const warehouse = published && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='MatchContextFacts'").get()
    ? db.prepare(`SELECT COUNT(*) AS matches,
      COALESCE(SUM(c.EnrichmentStatus IN ('ready','partial')),0) AS enrichedMatches,
      COALESCE(SUM(m.TimeSource='edw'),0) AS edwUtcMatches,
      COALESCE(SUM(c.PatchKey IS NOT NULL),0) AS patchedMatches
      FROM MatchContextFacts c JOIN MatchFacts m USING(RunId,MatchId) WHERE c.RunId=?`).get(published.RunId) : null;
  return {
    available: true,
    running,
    scope: published ? { mode: published.Scope, seasonId: published.SelectedSeasonId, leagueId: published.PreviewLeagueId } : null,
    published: published ? {
      runId: published.RunId, finishedAt: published.FinishedAtUtc, asOf: published.AsOfUtc,
      matches: published.MatchCount, playerGames: published.PlayerGameCount,
      issues: published.IssueCount, durationMs: published.DurationMs,
    } : null,
    latest: latest ? { runId: latest.RunId, startedAt: latest.StartedAtUtc, finishedAt: latest.FinishedAtUtc,
      status: latest.Status === 'running' && !running ? 'interrupted' : latest.Status,
      failureCode: latest.FailureCode } : null,
    sources, issues, warehouse,
    highlights: db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'HighlightEvents'").get()
      ? { paused: Boolean(db.prepare('SELECT Paused FROM HighlightSettings WHERE Id = 1').get()?.Paused),
        published: db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Status = 'published' AND Hidden = 0 AND OverrideNeedsReview = 0").get().n,
        hidden: db.prepare('SELECT COUNT(*) AS n FROM HighlightEvents WHERE Hidden = 1').get().n,
        withdrawn: db.prepare("SELECT COUNT(*) AS n FROM HighlightEvents WHERE Status = 'withdrawn'").get().n }
      : null,
  };
}

export function readAnalyticsStatus(path) {
  if (!existsSync(path)) return { available: false, running: false, published: null, latest: null, sources: [], issues: [] };
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try { return db.transaction(() => safeAnalyticsStatus(db))(); }
  finally { db.close(); }
}
