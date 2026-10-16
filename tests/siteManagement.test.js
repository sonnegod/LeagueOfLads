import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { isSiteManagerSteamId } from '../middleware/checkSiteManager.js';
import { createSiteManagementRouter } from '../routes/siteManagementRoutes.js';
import { SiteAnalyticsStore } from '../config/siteAnalyticsStore.js';

const steamId = accountId => (76561197960265728n + BigInt(accountId)).toString();

test('site-manager access is granted only to the explicitly configured Steam account', () => {
  assert.equal(isSiteManagerSteamId(steamId(49219700)), true);
  for (const candidate of [steamId(49219701), steamId(1), '49219700', '', null, undefined,
    Number(steamId(49219700)), 'not-a-steam-id', '76561197960265728']) {
    assert.equal(isSiteManagerSteamId(candidate), false);
  }
});

test('site-management API enforces its own role, independently of league admins and session flags', async () => {
  const store = new SiteAnalyticsStore(':memory:');
  const app = express();
  // Authentication fixtures exist only in this isolated test application.
  app.use((req, res, next) => {
    const fixture = req.get('x-test-user');
    req.isAuthenticated = () => fixture != null && fixture !== 'signed-out';
    if (fixture === 'owner') req.user = { id: steamId(49219700) };
    if (fixture === 'league-admin') {
      req.user = { id: steamId(42), isSiteManager: true };
      req.admin = { AdminPlayerId: 42, HeadAdmin: 1 };
      req.session = { accountId: '49219700', isSiteManager: true };
    }
    if (fixture === 'player') req.user = { id: steamId(123) };
    if (fixture === 'signed-out') req.user = { id: steamId(49219700) };
    if (fixture === 'invalid-id') req.user = { id: '49219700' };
    next();
  });
  app.use('/api/site-management', createSiteManagementRouter({ report: days => store.report(days, true) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/site-management/analytics`;
  const request = (user, query = '') => fetch(base + query, {
    headers: { ...(user ? { 'x-test-user': user } : {}), Connection: 'close' },
  });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request('signed-out')).status, 401);
    assert.equal((await request('missing-user')).status, 401);
    for (const user of ['league-admin', 'player', 'invalid-id']) {
      const response = await request(user);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'Site manager access required');
    }
    for (const days of [1, 7, 30]) {
      const response = await request('owner', `?days=${days}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const result = await response.json();
      assert.equal(result.isPreview, false);
      assert.equal(result.collectionEnabled, true);
      assert.equal(result.days, days);
      assert.equal(result.daily.length, days);
      assert.ok(result.summary.pageViews >= result.summary.visitors);
    }
    assert.equal((await (await request('owner')).json()).days, 7);
    for (const query of ['?days=0', '?days=14', '?days=7.0', '?days=7&days=30']) {
      assert.equal((await request('owner', query)).status, 400);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});

test('real reporting uses New York dates and truthful empty ranges', () => {
  const store = new SiteAnalyticsStore(':memory:', { now: () => new Date('2026-10-16T02:00:00Z') });
  try {
    const today = store.report(1);
    const week = store.report(7);
    const month = store.report(30);
    assert.deepEqual(today.period, { from: '2026-10-15', to: '2026-10-15' });
    assert.deepEqual(week.daily, month.daily.slice(-7));
    assert.deepEqual(today.daily, week.daily.slice(-1));
    assert.equal(week.summary.pageViews, week.daily.reduce((sum, day) => sum + day.pageViews, 0));
    assert.equal(week.sources.reduce((sum, source) => sum + source.percent, 0), 0);
    assert.equal(week.summary.visitors, 0);
    assert.equal(week.health.p95ResponseMs, null);
    assert.ok(week.signups.steps.every((step, index, steps) => !index || step.count <= steps[index - 1].count));
    assert.throws(() => store.report(14), RangeError);
  } finally { store.close(); }
});
