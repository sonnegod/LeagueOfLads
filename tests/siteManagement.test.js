import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { isSiteManagerSteamId } from '../middleware/checkSiteManager.js';
import { createSiteManagementRouter } from '../routes/siteManagementRoutes.js';
import { SiteAnalyticsStore } from '../config/siteAnalyticsStore.js';
import { getAuditActor } from '../config/adminAuditContext.js';
import { createAnalyticsRoutes } from '../routes/analyticsRoutes.js';
import { createBettingRoutes } from '../routes/bettingRoutes.js';
import { createAdminRosterRouter, createRosterChangeHandler } from '../routes/rosterRoutes.js';
import { engineFixture } from './helpers/bettingFixture.js';

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

test('Betting and league Analytics require the site role while league admins retain isolated roster access', async () => {
  const f = engineFixture();
  const audits = []; let refreshes = 0;
  f.schedules.audit = (type, message) => audits.push({ type, message, actor: getAuditActor() });
  f.league.exec('CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);INSERT INTO PlayerInfo SELECT DISTINCT PlayerId,\'Player \'||PlayerId FROM SeasonTeamPlayers');
  const reviewText='**@A** vs **@B**\nSunday, October 25th, 8pm EDT (10/25/2026 8:00 PM)';
  f.schedules.ingest({messageId:'900000000000001',channelId:'800000000000001',authoredAt:'2026-10-16T12:00:00.000Z',content:reviewText},1,new Date('2026-10-16T12:00:00.000Z'));
  const betting = createBettingRoutes({ ...f, analyticsPath: ':memory:', refresh: () => refreshes++ });
  const rosters = createAdminRosterRouter({league: f.league, schedules: f.schedules});
  betting.adminRoutes.post('/seasons/:seasonId/roster-changes', createRosterChangeHandler({schedules: f.schedules}));
  const analytics = createAnalyticsRoutes({ getPaths: () => ({ analytics: 'missing-site-management-test.db' }) });
  const app = express(); app.use(express.json());
  app.use((req, res, next) => {
    const user = req.get('x-test-user'); req.isAuthenticated = () => Boolean(user);
    if (user) req.user = { id: steamId(user === 'owner' ? 49219700 : 42), displayName: user === 'owner' ? 'Site Owner' : 'League Admin' };
    if (user === 'league-admin') req.admin = { AdminPlayerId: 42, HeadAdmin: 1 };
    next();
  });
  app.use('/api/site-management', createSiteManagementRouter({ bettingRoutes: betting.adminRoutes, leagueAnalyticsRoutes: analytics.adminRoutes }));
  app.use('/api/admin/rosters', (req, res, next) => req.admin ? next() : res.sendStatus(req.user ? 403 : 401), rosters);
  app.use('/api/admin/analytics', (req, res, next) => req.admin ? next() : res.sendStatus(req.user ? 403 : 401), analytics.highlightRoutes);
  app.use('/api/betting', betting.publicRoutes);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, user, method = 'GET', body) => fetch(base + path, { method,
    headers: { ...(user ? { 'x-test-user': user } : {}), 'Content-Type': 'application/json', Connection: 'close' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    for (const path of ['/betting/status', '/league-analytics/status', '/league-analytics/highlights']) {
      assert.equal((await request('/api/site-management' + path)).status, 401);
      assert.equal((await request('/api/site-management' + path, 'league-admin')).status, 403);
      const owner = await request('/api/site-management' + path, 'owner');
      assert.equal(owner.status, 200); assert.match(owner.headers.get('cache-control'), /no-store/);
      if(path==='/betting/status')assert.deepEqual((await owner.json()).messages.map(message=>message.Content),[reviewText]);
    }
    assert.equal((await request('/api/site-management/betting/refresh', 'league-admin', 'POST', {})).status, 403);
    assert.equal(refreshes, 0);
    assert.equal((await request('/api/site-management/betting/refresh', 'owner', 'POST', {})).status, 202);
    assert.equal(refreshes, 1);
    assert.equal((await request('/api/site-management/betting/seasons/1/aliases', 'owner', 'PUT', {
      roleId: '123456789012345', teamKey: 11,
    })).status, 200);
    assert.equal(audits[0].actor.AdminPlayerId, '49219700'); assert.equal(audits[0].actor.AdminPlayerName, 'Site Owner');
    assert.equal((await request('/api/site-management/league-analytics/highlights/settings', 'league-admin', 'PATCH', { paused: true })).status, 403);
    assert.equal((await request('/api/admin/rosters/status')).status, 401);
    const roster = await request('/api/admin/rosters/status', 'league-admin'); assert.equal(roster.status, 200);
    const data = await roster.json(); assert.deepEqual(Object.keys(data).sort(), ['captains', 'rosterOrders', 'rosterSlots', 'season', 'teams']);
    assert.equal(data.season.seasonId, 1); assert.equal(data.teams.length, 2);
    assert.equal(data.rosterSlots.length, 10);
    const orderBody={teamKey:11,order:[4,3,2,1,0],expectedRoster:data.rosterSlots.filter(p=>p.teamKey===11)};
    assert.equal((await request('/api/admin/rosters/seasons/1/roster-order',null,'PUT',orderBody)).status,401);
    assert.equal((await request('/api/admin/rosters/seasons/1/roster-order','owner','PUT',orderBody)).status,403);
    assert.equal((await request('/api/admin/rosters/seasons/1/roster-order','league-admin','PUT',orderBody)).status,200);
    const candidates = await request('/api/admin/rosters/players?search=Player', 'league-admin');
    assert.equal(candidates.status,200);assert.equal((await candidates.json()).players.length,10);
    assert.equal((await request('/api/admin/rosters/seasons/1/pending-slots', null, 'POST', {})).status,401);
    assert.equal((await request('/api/admin/rosters/seasons/1/pending-slots', 'owner', 'POST', {})).status,403);
    assert.equal((await request('/api/admin/rosters/seasons/1/pending-slots', 'league-admin', 'POST', {})).status,400);
    assert.equal((await request('/api/admin/rosters/seasons/1/pending-slots/confirm', 'league-admin', 'POST', {})).status,400);
    assert.equal((await request('/api/admin/rosters/seasons/1/roster-changes', 'league-admin', 'POST', {})).status, 400);
    assert.equal((await request('/api/admin/rosters/seasons/1/captain', null, 'PUT', {})).status,401);
    assert.equal((await request('/api/admin/rosters/seasons/1/captain', 'owner', 'PUT', {})).status,403);
    assert.equal((await request('/api/admin/rosters/seasons/1/captain', 'league-admin', 'PUT', {})).status,400);
    assert.equal((await request('/api/site-management/betting/seasons/1/roster-changes', 'league-admin', 'POST', {})).status,403);
    assert.equal((await request('/api/site-management/betting/seasons/1/roster-changes', 'owner', 'POST', {})).status,400);
    assert.equal((await request('/api/admin/rosters/refresh', 'league-admin', 'POST', {})).status, 404);
    assert.equal((await request('/api/admin/betting/status', 'league-admin')).status, 404);
    assert.equal((await request('/api/admin/analytics/status', 'league-admin')).status, 404);
    assert.equal((await request('/api/admin/analytics/highlights', 'league-admin')).status, 200);
    assert.equal((await request('/api/admin/analytics/highlights')).status, 401);
    assert.equal((await request('/api/admin/analytics/dashboard/preview?previewLeague=100', 'league-admin')).status, 404);
    const publicMeta=await request('/api/betting/meta');assert.equal(publicMeta.status,200);
    assert.equal(JSON.stringify(await publicMeta.json()).includes(reviewText),false);
    const publicEvents=await request('/api/betting/events');assert.equal(publicEvents.status,200);
    assert.equal(JSON.stringify(await publicEvents.json()).includes(reviewText),false);
    f.league.exec("UPDATE LeagueSeasons SET Status='signup_closed' WHERE SeasonId=1;UPDATE SeasonTeamPlayers SET PlayerId=1 WHERE TeamSubmissionId=12 AND Slot=0;");
    const finalized = await request('/api/site-management/betting/seasons/1/setup', 'owner', 'POST', { gamesPerTeam: 6 });
    assert.equal(finalized.status, 200); assert.equal((await finalized.json()).saved, true);
    const status = await (await request('/api/site-management/betting/status', 'owner')).json();
    assert.deepEqual(status.rosterConflicts, [1]);
    assert.equal(JSON.parse(f.schedules.setup(1).SetupJson).roster.filter(p => p.PlayerId === 1).length, 2);
    assert.equal(getAuditActor(), null);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); f.close();
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
