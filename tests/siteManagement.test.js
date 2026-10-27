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
import { createAdminMatchRouter } from '../routes/adminMatchRoutes.js';
import { runWithAuditActor } from '../config/adminAuditContext.js';
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
      assert.equal(result.hourly.length, days === 1 ? 24 : 0);
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

test('Betting and league Analytics require the site role while league admins retain isolated roster and scheduling access', async () => {
  const f = engineFixture();
  const audits = []; let refreshes = 0;
  f.schedules.audit = (type, message) => audits.push({ type, message, actor: getAuditActor() });
  f.league.exec('CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);INSERT INTO PlayerInfo SELECT DISTINCT PlayerId,\'Player \'||PlayerId FROM SeasonTeamPlayers');
  const reviewText='**<@&111111111111111111>** vs **<@&222222222222222222>**\nSunday, October 25th, 8pm EDT (10/25/2026 8:00 PM)';
  const displayText="**@Sock's Warriors** vs **@Initiative**\nSunday, October 25th, 8pm EDT (10/25/2026 8:00 PM)";
  f.schedules.ingest({messageId:'900000000000001',channelId:'800000000000001',authoredAt:'2026-10-16T12:00:00.000Z',content:reviewText,
    roleNames:{'111111111111111111':"Sock's Warriors",'222222222222222222':'Initiative'}},1,new Date('2026-10-16T12:00:00.000Z'));
  const betting = createBettingRoutes({ ...f, analyticsPath: ':memory:', refresh: () => refreshes++ });
  const rosters = createAdminRosterRouter({league: f.league, schedules: f.schedules});
  betting.adminRoutes.post('/seasons/:seasonId/roster-changes', createRosterChangeHandler({schedules: f.schedules}));
  const analytics = createAnalyticsRoutes({ getPaths: () => ({ analytics: 'missing-site-management-test.db' }) });
  const app = express(); app.use(express.json());
  app.use((req, res, next) => {
    const user = req.get('x-test-user'); req.isAuthenticated = () => Boolean(user);
    if (user) req.user = { id: steamId(user === 'owner' ? 49219700 : 42), displayName: user === 'owner' ? 'Site Owner' : 'League Admin' };
    if (user === 'league-admin') req.admin = { AdminPlayerId: 42, AdminPlayerName: 'League Admin', HeadAdmin: 1 };
    next();
  });
  app.use('/api/site-management', createSiteManagementRouter({ bettingRoutes: betting.adminRoutes, leagueAnalyticsRoutes: analytics.adminRoutes }));
  app.use('/api/admin/rosters', (req, res, next) => req.admin ? next() : res.sendStatus(req.user ? 403 : 401), rosters);
  app.use('/api/admin/matches', (req,res,next)=>req.admin?runWithAuditActor(req.admin,next):res.sendStatus(req.user?403:401),
    createAdminMatchRouter({league:f.league,schedules:f.schedules}));
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
      if(path==='/betting/status') {
        const status=await owner.json();
        for(const key of ['messages','events','aliases'])assert.equal(key in status,false);
      }
    }
    assert.equal((await request('/api/site-management/betting/refresh', 'league-admin', 'POST', {})).status, 403);
    assert.equal(refreshes, 0);
    assert.equal((await request('/api/site-management/betting/refresh', 'owner', 'POST', {})).status, 202);
    assert.equal(refreshes, 1);
    assert.equal((await request('/api/admin/matches/status')).status,401);
    assert.equal((await request('/api/admin/matches/status','owner')).status,403);
    const matchStatus=await request('/api/admin/matches/status','league-admin');assert.equal(matchStatus.status,200);
    const matchData=await matchStatus.json();
    assert.deepEqual(Object.keys(matchData).sort(),['aliases','events','localTesting','messages','season','seasons','teams']);
    assert.deepEqual(matchData.messages.map(message=>message.Content),[reviewText]);
    assert.deepEqual(matchData.messages.map(message=>message.DisplayContent),[displayText]);
    assert.equal((await request('/api/site-management/betting/seasons/1/aliases','owner','PUT',{})).status,404);
    assert.equal((await request('/api/admin/matches/seasons/1/aliases', 'league-admin', 'PUT', {
      roleId: '123456789012345', teamKey: 11,
    })).status, 200);
    assert.equal(audits[0].actor.AdminPlayerId,42);assert.equal(audits[0].actor.AdminPlayerName,'League Admin');
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
    const metaPayload=JSON.stringify(await publicMeta.json());
    assert.equal(metaPayload.includes(reviewText),false);assert.equal(metaPayload.includes("Sock's Warriors"),false);
    const publicEvents=await request('/api/betting/events');assert.equal(publicEvents.status,200);
    const eventPayload=JSON.stringify(await publicEvents.json());
    assert.equal(eventPayload.includes(reviewText),false);assert.equal(eventPayload.includes("Sock's Warriors"),false);
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

test('site managers review all users tickets with status/season filters, bounded pages and immutable accepted odds', async () => {
  const f=engineFixture();let server;
  try {
    f.book.registerSeason({SeasonId:1,LeagueName:'Current',Status:'active'});
    f.book.registerSeason({SeasonId:2,LeagueName:'Previous',Status:'ended'});
    const market=f.book.publish({seasonId:1,eventId:91,stage:'regular',type:'exact_score',title:'First vs Second',rules:{localTesting:f.book.localTesting}},
      [{key:'2-0',label:'First 2–0',probability:.5},{key:'0-2',label:'Second 2–0',probability:.5}],1,'2026-10-14T01:00:00Z');
    const selection=f.betting.prepare('SELECT SelectionId FROM BettingSelections WHERE MarketId=? ORDER BY SelectionId').get(market).SelectionId;
    const insert=f.betting.prepare(`INSERT INTO BettingTickets (SeasonId,UserId,StakeCents,RequestKey,Status,PayoutCents,PlacedAtUtc)
      VALUES (?,?,?,?,?,?,?)`);
    for(let id=1;id<=61;id++){
      const status=id===57?'won':id===58?'lost':id===59?'refunded':'pending';
      insert.run(id===60?2:id===61?0:1,id%2?'99':'100',12345,`private-key-${id}`,status,status==='won'?24690:status==='refunded'?12345:0,'2026-10-12T21:00:00Z');
      f.betting.prepare(`INSERT INTO BettingTicketLegs
        (TicketId,MarketId,SelectionId,OutcomeKey,QuoteVersion,AcceptedMicros,DefinitionJson,Result)
        VALUES (?,?,?,'2-0',1,2000000,'{}',?)`).run(id,market,selection,status==='pending'?'pending':status==='refunded'?'void':status);
    }
    f.betting.prepare("UPDATE BettingMarkets SET CloseAtUtc='2026-10-12T21:00:00Z' WHERE MarketId=?").run(market);
    f.betting.prepare('UPDATE BettingSelections SET OfferedMicros=5000000 WHERE SelectionId=?').run(selection);
    const routes=createBettingRoutes({...f,playerName:id=>id==='99'?'Alice':'Bob'});
    const app=express();app.use((req,res,next)=>{
      const user=req.get('x-test-user');req.isAuthenticated=()=>Boolean(user);
      if(user)req.user={id:steamId(user==='owner'?49219700:99)};
      if(user==='league-admin')req.admin={AdminPlayerId:99,HeadAdmin:1};
      next();
    });
    app.use('/api/site-management',createSiteManagementRouter({bettingRoutes:routes.adminRoutes}));
    app.use('/api/betting',routes.publicRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=(query='',user='owner')=>fetch(`${base}/api/site-management/betting/tickets${query}`,{
      headers:{...(user?{'x-test-user':user}:{}),Connection:'close'}});
    const changes=f.betting.prepare('SELECT total_changes() n').get().n;
    assert.equal((await request('',null)).status,401);
    assert.equal((await request('','league-admin')).status,403);
    assert.equal((await request('','player')).status,403);
    const response=await request('?status=pending&seasonId=1');assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control'),/private, no-store/);
    const page=await response.json();
    assert.equal(page.tickets.length,50);assert.equal(page.nextBefore,7);
    assert.deepEqual(page.tickets.slice(0,2).map(ticket=>[ticket.ticketId,ticket.name]),[[56,'Bob'],[55,'Alice']]);
    assert.deepEqual(page.counts,{lost:1,pending:56,refunded:1,won:1});
    assert.equal(page.tickets[0].stake,123.45);assert.equal(page.tickets[0].legs[0].odds,2);
    assert.equal(page.tickets[0].legs[0].marketStatus,'locked');assert.equal(page.tickets[0].legs[0].eventId,91);
    assert.equal(page.tickets[0].legs[0].result,'pending');
    const next=await(await request(`?status=pending&seasonId=1&before=${page.nextBefore}`)).json();
    assert.deepEqual(next.tickets.map(ticket=>ticket.ticketId),[6,5,4,3,2,1]);assert.equal(next.nextBefore,null);
    for(const [status,id] of [['won',57],['lost',58],['refunded',59]]){
      const filtered=await(await request(`?status=${status}&seasonId=1`)).json();
      assert.deepEqual(filtered.tickets.map(ticket=>ticket.ticketId),[id]);
    }
    assert.equal((await(await request('?status=won')).json()).tickets[0].payout,246.9);
    assert.deepEqual((await(await request('?seasonId=2')).json()).tickets.map(ticket=>ticket.ticketId),[60]);
    assert.deepEqual((await(await request('?seasonId=0')).json()).tickets.map(ticket=>ticket.ticketId),[61]);
    assert.deepEqual((await(await request('?seasonId=999')).json()).tickets,[]);
    const all=await(await request()).json();assert.equal(all.tickets[0].ticketId,61);
    for(const query of ['?status=invalid','?status=pending&status=won','?seasonId=bad','?seasonId=-1','?before=0','?before=bad'])assert.equal((await request(query)).status,400,query);
    assert.equal(f.betting.prepare('SELECT total_changes() n').get().n,changes);
    assert.equal(JSON.stringify(all).includes('private-key-'),false);
    assert.equal((await fetch(`${base}/api/betting/admin/tickets`)).status,404);
    const own=await(await fetch(`${base}/api/betting/tickets?seasonId=1`,{headers:{'x-test-user':'player'}})).json();
    assert.ok(own.tickets.every(ticket=>ticket.ticketId%2===1));
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    f.close();
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
