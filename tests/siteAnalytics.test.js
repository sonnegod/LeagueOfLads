import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { SiteAnalyticsStore } from '../config/siteAnalyticsStore.js';
import { createSiteAnalyticsRouter } from '../routes/siteAnalyticsRoutes.js';
import { analyticsEnabled, createSiteApiHealth, createSiteSignupProgress } from '../config/siteAnalytics.js';

test('daily aggregation deduplicates browsers and preserves source, features, and returning visits', () => {
  let time = new Date('2026-10-15T15:00:00Z');
  const store = new SiteAnalyticsStore(':memory:', { now: () => time });
  try {
    const visitor = 'a'.repeat(64);
    store.record(visitor, [{ name: 'page_view', page: 'home', source: 'Discord' },
      { name: 'page_view', page: 'player', source: 'Direct' }, { name: 'series_expanded' }]);
    store.record('b'.repeat(64), [{ name: 'page_view', page: 'home', source: 'Google' }]);
    time = new Date('2026-10-16T15:00:00Z');
    store.record(visitor, [{ name: 'page_view', page: 'home', source: 'Direct' },
      { name: 'signup_started' }, { name: 'signup_submitted' }, { name: 'signup_submitted' }]);
    const week = store.report(7);
    assert.equal(week.summary.visitors, 2);
    assert.equal(week.summary.pageViews, 4);
    assert.equal(week.summary.returningPercent, 50);
    assert.equal(week.daily.at(-2).visitors, 2);
    assert.equal(week.daily.at(-1).visitors, 1);
    assert.equal(week.sources.find(row => row.name === 'Discord').percent, 50);
    assert.equal(week.sources.find(row => row.name === 'Google').percent, 50);
    assert.equal(week.pages[0].name, 'Home');
    assert.equal(week.pages[0].views, 3);
    assert.equal(week.features[0].count, 1);
    assert.deepEqual(week.signups.steps.map(row => row.count), [1, 1, 1, 1]);
    assert.equal(week.summary.completionPercent, 100);
    assert.ok(!JSON.stringify(week).includes(visitor));
    assert.notEqual(store.db.prepare('SELECT Visitor FROM SiteVisitors LIMIT 1').get().Visitor, visitor);
    assert.equal(store.report(1).summary.visitors, 1);
  } finally { store.close(); }
});

test('health uses bounded aggregates, counts errors, and old usage is pruned after 90 days', () => {
  let time = new Date('2026-06-01T15:00:00Z');
  const store = new SiteAnalyticsStore(':memory:', { now: () => time });
  try {
    store.record('a'.repeat(64), [{ name: 'page_view', page: 'home', source: 'Direct' }]);
    store.recordApi(200, 12);
    store.flush();
    time = new Date('2026-10-16T15:00:00Z');
    for (let index = 0; index < 96; index++) store.recordApi(200, 120);
    store.recordApi(413, 80);
    store.recordApi(404, 70);
    store.recordApi(500, 50);
    store.recordApi(200, 4000);
    const report = store.report(1);
    assert.equal(report.health.requests, 100);
    assert.equal(report.health.p95ResponseMs, 200);
    assert.equal(report.health.apiErrorPercent, 3);
    assert.deepEqual(report.health.issues.map(row => row.count), [1, 2, 1]);
    assert.equal(report.summary.visitors, 0);
    for (const table of ['SiteVisitors', 'SiteVisitorDays', 'SitePageDays']) {
      assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
    }
    assert.equal(store.db.prepare('SELECT MIN(Day) day FROM SiteApiDays').get().day, '2026-10-16');
    assert.equal(store.pendingApi.size, 0);
  } finally { store.close(); }
});

test('collection validates batches, declines bots/privacy signals, and never accepts account or URL data', async () => {
  const recorded = [];
  const app = express();
  app.use('/api/site-analytics', createSiteAnalyticsRouter({
    enabled: () => true, record: (token, events) => recorded.push({ token, events }),
    allowedOrigins: ['http://localhost:5173'],
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/site-analytics`;
  const request = (body, headers = {}) => fetch(`${base}/events`, {
    method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json',
      'User-Agent': 'Test browser', ...headers }, body: JSON.stringify(body),
  });
  const event = { name: 'page_view', page: 'player', source: 'Direct' };
  try {
    assert.equal((await request({ events: [event] }, { Origin: 'https://evil.example' })).status, 403);
    for (const header of [{ DNT: '1' }, { 'Sec-GPC': '1' }, { 'User-Agent': 'Googlebot' }]) {
      const response = await request({ events: [event] }, header);
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal(recorded.length, 0);
    for (const body of [{ events: [] }, { events: Array(21).fill(event) },
      { events: [{ ...event, accountId: 49219700 }] }, { events: [{ ...event, page: '/player/123' }] },
      { events: [{ name: 'signup_submitted' }] }, { events: [event], url: 'private' },
      { events: [{ name: 'upload_failure', source: 'Direct' }] }]) {
      assert.equal((await request(body)).status, 400);
    }
    assert.equal((await request({ events: [event], padding: 'x'.repeat(9000) })).status, 413);
    const response = await request({ events: [event, { name: 'teammates_opened' }] });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /lads_visitor=[a-f0-9]{64}/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    await request({ events: [event] }, { Cookie: cookie.split(';')[0] });
    assert.equal(recorded[0].token, recorded[1].token);
    assert.equal(recorded[0].events[0].page, 'player');
    const removal = await fetch(`${base}/events`, { method: 'DELETE' });
    assert.equal(removal.status, 204);
    assert.match(removal.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
    let last;
    for (let i = 0; i < 125; i++) last = await request({ events: [event] });
    assert.equal(last.status, 429);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('collection defaults to production only and supports explicit overrides', () => {
  const previous = { ENVIRONMENT: process.env.ENVIRONMENT, SITE_ANALYTICS_ENABLED: process.env.SITE_ANALYTICS_ENABLED };
  try {
    delete process.env.SITE_ANALYTICS_ENABLED;
    process.env.ENVIRONMENT = 'DEV';
    assert.equal(analyticsEnabled(), false);
    process.env.ENVIRONMENT = 'PROD';
    assert.equal(analyticsEnabled(), true);
    process.env.SITE_ANALYTICS_ENABLED = 'false';
    assert.equal(analyticsEnabled(), false);
    process.env.ENVIRONMENT = 'DEV';
    process.env.SITE_ANALYTICS_ENABLED = 'true';
    assert.equal(analyticsEnabled(), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('API monitoring includes polling and parser errors; only verified submissions advance the funnel', async () => {
  const health = [], progress = [];
  const app = express();
  app.use(createSiteApiHealth({ enabled: () => true,
    record: (status, duration) => health.push({ status, duration }) }));
  app.use(express.json({ limit: '1kb' }));
  app.use('/api/signup', createSiteSignupProgress({ enabled: () => true,
    record: (token, events) => progress.push({ token, events }) }));
  app.get('/api/poll', (req, res) => res.json({ ok: true }));
  app.get('/api/site-management/analytics', (req, res) => res.json({}));
  app.post('/api/signup/:id/drafts/:draft/submit', (req, res) => res.status(req.body.fail ? 409 : 201).json({}));
  app.post('/api/signup/:id/teams', (req, res) => res.status(201).json({}));
  app.post('/api/signup/:id/drafts', (req, res) => res.status(201).json({}));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: 'Request rejected' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body = {}, headers = {}) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      Cookie: `lads_visitor=${'a'.repeat(64)}`, ...headers }, body: JSON.stringify(body),
  });
  try {
    await fetch(base + '/api/poll');
    await fetch(base + '/api/site-management/analytics');
    await post('/api/signup/1/drafts/draft/submit');
    await post('/api/signup/1/drafts/draft/submit', { fail: true });
    await post('/api/signup/1/drafts');
    await post('/api/signup/1/teams', {}, { DNT: '1' });
    await post('/api/signup/1/teams', {}, { Cookie: '' });
    assert.equal((await post('/api/signup/1/teams', { screenshot: 'x'.repeat(2000) })).status, 413);
    assert.equal(progress.length, 1);
    assert.equal(progress[0].events[0].name, 'signup_submitted');
    assert.equal(health.length, 7);
    assert.deepEqual(health.map(row => row.status), [200, 201, 409, 201, 201, 201, 413]);
    assert.ok(health.every(row => Number.isFinite(row.duration) && row.duration >= 0));
    assert.ok(health.every(row => !('path' in row) && !('token' in row)));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
