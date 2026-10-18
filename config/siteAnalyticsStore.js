import Database from 'better-sqlite3';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const PAGE_TYPES = {
  home: ['Home', '/'], league: ['League pages', '/league/:id'],
  player: ['Player profiles', '/player/:id'], team: ['Team pages', '/team/:id'],
  match: ['Matches', '/match/:id'], series: ['Series', '/series/:id'],
  recents: ['Recent results', '/recents + /recentMatches'], h2h: ['Head to Head', '/h2h'],
  signup: ['Signup', '/signup/:id'], rules: ['Rules', '/rules'], awards: ['Awards', '/awards'],
  betting: ['Betting', '/betting'], hero: ['Heroes', '/hero/:id'],
  other: ['Other public pages', 'Public lists and tools'],
};
export const FEATURE_NAMES = {
  series_expanded: 'Series expanded', draft_viewed: 'Draft viewed',
  h2h_comparison: 'H2H comparison', teammates_opened: 'Teammates opened',
  roster_history_opened: 'Roster history opened',
};
export const CLIENT_EVENTS = new Set(['page_view', ...Object.keys(FEATURE_NAMES),
  'signup_signed_in', 'signup_started', 'upload_failure']);
const SOURCES = { Discord: '#a5b4fc', Direct: '#38bdf8', Google: '#34d399', Other: '#94a3b8' };
export const LATENCY_BUCKETS = [25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000];
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
export const localDay = date => dayFormatter.format(date);
const percent = (part, total) => total ? Math.round(part / total * 1000) / 10 : 0;
const shiftDay = (day, offset) => {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

// This database deliberately has no Steam IDs, individual URLs, request bodies, or IPs.
export class SiteAnalyticsStore {
  constructor(filename, { now = () => new Date() } = {}) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.now = now;
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 1000');
    this.db.pragma('cache_size = -2048');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS SiteMetadata (Key TEXT PRIMARY KEY, Value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS SiteVisitors (
        Visitor TEXT PRIMARY KEY, FirstDay TEXT NOT NULL, LastDay TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS SiteVisitorDays (
        Day TEXT NOT NULL, Visitor TEXT NOT NULL, Source TEXT NOT NULL,
        PRIMARY KEY (Day, Visitor));
      CREATE TABLE IF NOT EXISTS SitePageDays (
        Day TEXT NOT NULL, Visitor TEXT NOT NULL, Page TEXT NOT NULL, Views INTEGER NOT NULL,
        PRIMARY KEY (Day, Visitor, Page));
      CREATE TABLE IF NOT EXISTS SiteEventDays (
        Day TEXT NOT NULL, Visitor TEXT NOT NULL, Event TEXT NOT NULL, Count INTEGER NOT NULL,
        PRIMARY KEY (Day, Visitor, Event));
      CREATE TABLE IF NOT EXISTS SiteApiDays (
        Day TEXT NOT NULL, Status INTEGER NOT NULL, Bucket INTEGER NOT NULL,
        Count INTEGER NOT NULL, PRIMARY KEY (Day, Status, Bucket));
    `);
    this.db.prepare('INSERT OR IGNORE INTO SiteMetadata VALUES (?, ?)')
      .run('salt', randomBytes(32).toString('hex'));
    this.salt = this.db.prepare("SELECT Value FROM SiteMetadata WHERE Key = 'salt'").get().Value;
    this.pendingApi = new Map();
    this.writeEvents = this.db.transaction((visitor, events, day) => {
      this.beginCollection();
      this.db.prepare(`INSERT INTO SiteVisitors VALUES (?, ?, ?) ON CONFLICT(Visitor)
        DO UPDATE SET LastDay = excluded.LastDay`).run(visitor, day, day);
      for (const event of events) {
        if (event.name === 'page_view') {
          this.db.prepare('INSERT OR IGNORE INTO SiteVisitorDays VALUES (?, ?, ?)')
            .run(day, visitor, Object.hasOwn(SOURCES, event.source) ? event.source : 'Direct');
          this.db.prepare(`INSERT INTO SitePageDays VALUES (?, ?, ?, 1)
            ON CONFLICT(Day, Visitor, Page) DO UPDATE SET Views = Views + 1`).run(day, visitor, event.page);
        } else {
          this.db.prepare(`INSERT INTO SiteEventDays VALUES (?, ?, ?, 1)
            ON CONFLICT(Day, Visitor, Event) DO UPDATE SET Count = Count + 1`).run(day, visitor, event.name);
        }
      }
    });
    this.timer = setInterval(() => {
      try { this.flush(); } catch { /* A telemetry failure must not interrupt the website. */ }
    }, 15000);
    this.timer.unref();
  }

  beginCollection() {
    this.db.prepare('INSERT OR IGNORE INTO SiteMetadata VALUES (?, ?)')
      .run('startedAt', this.now().toISOString());
  }

  record(token, events) {
    const day = localDay(this.now());
    this.prune(day);
    const visitor = createHmac('sha256', this.salt).update(token).digest('hex');
    this.writeEvents(visitor, events, day);
  }

  recordApi(status, duration) {
    const day = localDay(this.now());
    const bucket = LATENCY_BUCKETS.find(value => duration <= value) ?? 60000;
    // Only finite status and latency categories enter the buffer, never URLs or request details.
    const category = status >= 500 ? 500 : status === 413 ? 413 : status >= 400 ? 400 : 200;
    const key = `${day}|${category}|${bucket}`;
    this.pendingApi.set(key, (this.pendingApi.get(key) || 0) + 1);
    if (this.pendingApi.size > 100) this.flush();
  }

  flush() {
    if (this.pendingApi.size) {
      this.db.transaction(() => {
        this.beginCollection();
        const stmt = this.db.prepare(`INSERT INTO SiteApiDays VALUES (?, ?, ?, ?)
          ON CONFLICT(Day, Status, Bucket) DO UPDATE SET Count = Count + excluded.Count`);
        for (const [key, count] of this.pendingApi) stmt.run(...key.split('|'), count);
      })();
      this.pendingApi.clear();
    }
    this.prune(localDay(this.now()));
  }

  prune(day) {
    if (day === this.prunedDay) return;
    const cutoff = shiftDay(day, -89);
    this.db.transaction(() => {
      for (const table of ['SiteVisitorDays', 'SitePageDays', 'SiteEventDays', 'SiteApiDays']) {
        this.db.prepare(`DELETE FROM ${table} WHERE Day < ?`).run(cutoff);
      }
      this.db.prepare('DELETE FROM SiteVisitors WHERE LastDay < ?').run(cutoff);
      this.db.prepare('UPDATE SiteVisitors SET FirstDay = ? WHERE FirstDay < ?').run(cutoff, cutoff);
    })();
    this.prunedDay = day;
  }

  report(days = 7, enabled = true) {
    if (![1, 7, 30].includes(days)) throw new RangeError('Choose 1, 7, or 30 days');
    this.flush();
    const to = localDay(this.now()), from = shiftDay(to, 1 - days);
    const rows = (sql, ...args) => this.db.prepare(sql).all(...args);
    const count = (sql, ...args) => this.db.prepare(sql).get(...args).n;
    const visitors = count('SELECT COUNT(DISTINCT Visitor) n FROM SiteVisitorDays WHERE Day BETWEEN ? AND ?', from, to);
    const pageViews = count('SELECT COALESCE(SUM(Views), 0) n FROM SitePageDays WHERE Day BETWEEN ? AND ?', from, to);
    const returning = count(`SELECT COUNT(DISTINCT d.Visitor) n FROM SiteVisitorDays d
      JOIN SiteVisitors v USING(Visitor) WHERE d.Day BETWEEN ? AND ? AND v.FirstDay < d.Day`, from, to);
    const dailyRows = rows(`SELECT Day date, COUNT(*) visitors FROM SiteVisitorDays
      WHERE Day BETWEEN ? AND ? GROUP BY Day`, from, to);
    const dailyViews = rows(`SELECT Day date, SUM(Views) pageViews FROM SitePageDays
      WHERE Day BETWEEN ? AND ? GROUP BY Day`, from, to);
    const daily = Array.from({ length: days }, (_, index) => {
      const date = shiftDay(from, index);
      return { date, visitors: dailyRows.find(row => row.date === date)?.visitors || 0,
        pageViews: dailyViews.find(row => row.date === date)?.pageViews || 0 };
    });
    const events = rows(`SELECT Event name, SUM(Count) count FROM SiteEventDays
      WHERE Day BETWEEN ? AND ? GROUP BY Event`, from, to);
    // Cumulative stages per browser in the period; later stages imply earlier stages.
    // Counts represent browsers, not teams, and carry no season or account identifier.
    const funnel = rows(`SELECT Visitor, MAX(CASE Event WHEN 'signup_submitted' THEN 3
      WHEN 'signup_started' THEN 2 WHEN 'signup_signed_in' THEN 1 ELSE 0 END) stage
      FROM SiteEventDays WHERE Day BETWEEN ? AND ? AND Event LIKE 'signup_%' GROUP BY Visitor`, from, to);
    const signupVisitors = new Set(rows(`SELECT DISTINCT Visitor FROM SitePageDays
      WHERE Day BETWEEN ? AND ? AND Page = 'signup'`, from, to).map(row => row.Visitor));
    funnel.forEach(row => signupVisitors.add(row.Visitor));
    const steps = [{ name: 'Signup page', count: signupVisitors.size },
      ...['Signed in', 'Form started', 'Team submitted'].map((name, index) => ({
        name, count: funnel.filter(row => row.stage >= index + 1).length,
      }))];
    const sources = rows(`SELECT Source name, COUNT(*) count FROM SiteVisitorDays d
      WHERE Day BETWEEN ? AND ? AND Day = (SELECT MIN(x.Day) FROM SiteVisitorDays x
        WHERE x.Visitor = d.Visitor AND x.Day BETWEEN ? AND ?) GROUP BY Source`, from, to, from, to);
    const api = rows('SELECT Status, Bucket, SUM(Count) n FROM SiteApiDays WHERE Day BETWEEN ? AND ? GROUP BY Status, Bucket', from, to);
    const requests = api.reduce((sum, row) => sum + row.n, 0);
    let cumulative = 0;
    const p95 = [...api].sort((a, b) => a.Bucket - b.Bucket).find(row => {
      cumulative += row.n;
      return cumulative >= Math.ceil(requests * .95);
    })?.Bucket ?? null;
    return {
      isPreview: false, collectionEnabled: enabled,
      startedAt: this.db.prepare("SELECT Value FROM SiteMetadata WHERE Key = 'startedAt'").get()?.Value || null,
      retentionDays: 90, days, timezone: 'America/New_York', period: { from, to }, daily,
      summary: { visitors, pageViews, returningPercent: percent(returning, visitors),
        completionPercent: percent(steps[3].count, steps[2].count) },
      pages: rows(`SELECT Page, SUM(Views) views, COUNT(DISTINCT Visitor) visitors
        FROM SitePageDays WHERE Day BETWEEN ? AND ? GROUP BY Page ORDER BY views DESC`, from, to)
        .map(({ Page, ...row }) => ({ ...row, name: PAGE_TYPES[Page][0], route: PAGE_TYPES[Page][1] })),
      features: Object.entries(FEATURE_NAMES).map(([event, name]) => ({ name,
        count: events.find(row => row.name === event)?.count || 0 })),
      sources: Object.entries(SOURCES).map(([name, color]) => ({ name, color,
        percent: percent(sources.find(row => row.name === name)?.count || 0, visitors) })),
      signups: { steps, uploadFailures: events.find(row => row.name === 'upload_failure')?.count || 0 },
      health: { requests, p95ResponseMs: p95,
        apiErrorPercent: percent(api.filter(row => row.Status >= 400).reduce((sum, row) => sum + row.n, 0), requests),
        issues: [
          { name: 'Server errors (5xx)', count: api.filter(row => row.Status === 500).reduce((sum, row) => sum + row.n, 0) },
          { name: 'Rejected requests (4xx)', count: api.filter(row => row.Status >= 400 && row.Status < 500).reduce((sum, row) => sum + row.n, 0) },
          { name: 'Payloads too large (413)', count: api.filter(row => row.Status === 413).reduce((sum, row) => sum + row.n, 0) },
        ] },
    };
  }

  close() { clearInterval(this.timer); this.flush(); this.db.close(); }
}
