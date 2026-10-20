import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { once } from 'node:events';
import SeasonScheduleStore, { groupRoundRobin } from '../config/seasonScheduleStore.js';
import { createAdminScheduleRouter, createPublicScheduleRouter } from '../routes/seasonScheduleRoutes.js';

function fixture(sizes = [6, 5]) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER PRIMARY KEY, LeagueName TEXT, Status TEXT, ExternalLeagueId INTEGER);
    CREATE TABLE GroupNames (LeagueId INTEGER, GroupId INTEGER, GroupName TEXT);
    CREATE TABLE LeagueRosterEntries (EntryId INTEGER PRIMARY KEY, LeagueId INTEGER, GroupId INTEGER,
      TeamId INTEGER, DisplayName TEXT, SortOrder INTEGER);
    CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY, LeagueId INTEGER);
    CREATE TABLE LeagueStandings (LeagueId INTEGER, TeamId INTEGER, Wins INTEGER, Losses INTEGER);
    INSERT INTO LeagueSeasons VALUES (1, 'New season', 'active', 900), (2, 'Previous season', 'ended', 899);
    INSERT INTO MatchLeague VALUES (42, 900);
    INSERT INTO LeagueStandings VALUES (900, 101, 1, 0);`);
  let next = 1;
  sizes.forEach((size, index) => {
    db.prepare('INSERT INTO GroupNames VALUES (900, ?, ?)').run(index + 1, `Group ${index + 1}`);
    for (let i = 0; i < size; i++) {
      const id = next++;
      db.prepare('INSERT INTO LeagueRosterEntries VALUES (?, 900, ?, NULL, ?, ?)')
        .run(id, index + 1, `Team ${id}`, i);
    }
  });
  const audit = [];
  const store = new SeasonScheduleStore(db, (type, message) => audit.push({ type, message }));
  const settings = { startDate: '2026-10-26', seriesPerWindow: 3, weeksPerWindow: 2 };
  return { db, store, settings, audit };
}

test('round robin covers each pair once for odd and even groups without self matches or round collisions', () => {
  for (let size = 2; size <= 20; size++) {
    const teams = Array.from({ length: size }, (_, i) => i + 1);
    const rounds = groupRoundRobin(teams, () => 0.37);
    const pairs = rounds.flat();
    assert.equal(pairs.length, size * (size - 1) / 2);
    assert.equal(new Set(pairs.map(pair => pair.join(':'))).size, pairs.length);
    assert.equal(rounds.length, size % 2 ? size : size - 1);
    for (const round of rounds) {
      const played = round.flat();
      assert.equal(new Set(played).size, played.length);
      assert.ok(round.every(([a, b]) => a < b));
    }
    assert.deepEqual(teams, Array.from({ length: size }, (_, i) => i + 1));
  }
  assert.deepEqual(groupRoundRobin([]), []);
  assert.deepEqual(groupRoundRobin([1]), []);
});

test('generation stays within groups, includes unlinked teams, and follows the 3-series / 2-week pace', () => {
  const { db, store, settings, audit } = fixture();
  try {
    store.saveSettings(1, settings);
    const plan = store.generate(1, {}, () => 0.37);
    assert.equal(plan.matchups.length, 25);
    assert.equal(plan.expectedMatchups, 25);
    assert.deepEqual(plan.warnings, []);
    assert.deepEqual(plan.windows.map(row => [row.startDate, row.endDate]), [
      ['2026-10-26', '2026-11-08'], ['2026-11-09', '2026-11-22'],
    ]);
    for (const row of plan.matchups) {
      const a = plan.teams.find(team => team.EntryId === row.TeamAEntryId);
      const b = plan.teams.find(team => team.EntryId === row.TeamBEntryId);
      assert.equal(a.GroupId, b.GroupId);
      assert.equal(a.GroupId, row.GroupId);
      assert.equal(row.TeamAId, null);
    }
    assert.ok(plan.windows.every(window => window.teamLoads.every(team => team.series <= 3)));
    assert.ok(plan.windows[0].teamLoads.filter(team => team.GroupId === 1).every(team => team.series === 3));
    assert.ok(plan.windows[1].teamLoads.filter(team => team.GroupId === 1).every(team => team.series === 2));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchLeague').get().n, 1);
    assert.deepEqual(db.prepare('SELECT * FROM LeagueStandings').all(), [{ LeagueId: 900, TeamId: 101, Wins: 1, Losses: 0 }]);
    assert.ok(audit.some(row => row.type === 'Schedule Randomized'));
    assert.equal(store.forLeague(900).matchups.length, 25);
    assert.deepEqual(store.forLeague(999).matchups, []);
  } finally { db.close(); }
});

test('cadence is configurable and existing suggestions require explicit replacement', () => {
  const { db, store, settings } = fixture([6]);
  try {
    assert.throws(() => store.generate(1), { status: 409 });
    store.saveSettings(1, { ...settings, seriesPerWindow: 2, weeksPerWindow: 1 });
    const first = store.generate(1, {}, () => 0.2);
    assert.equal(first.windows.length, 3);
    assert.equal(first.windows[0].endDate, '2026-11-01');
    assert.ok(first.windows.every(window => window.teamLoads.every(team => team.series <= 2)));
    assert.throws(() => store.generate(1), { status: 409 });
    assert.deepEqual(store.read(1).matchups, first.matchups);
    const second = store.generate(1, { replaceExisting: true }, () => 0.8);
    assert.equal(second.matchups.length, 15);
    assert.notDeepEqual(second.matchups.map(row => [row.TeamAEntryId, row.TeamBEntryId, row.WindowNumber]),
      first.matchups.map(row => [row.TeamAEntryId, row.TeamBEntryId, row.WindowNumber]));
  } finally { db.close(); }
});

test('9/9/10 format gives nine-team groups 4+4 series and puts the ten-team remainder in its last window',()=>{
  const {db,store,settings}=fixture([9,9,10]);try {
    store.saveSettings(1,{...settings,seriesPerWindow:4});
    for(const seed of [0,.37,.8]) {
      const plan=store.generate(1,{replaceExisting:true},()=>seed);
      assert.equal(plan.matchups.length,117);assert.equal(plan.windows.length,2);assert.deepEqual(plan.warnings,[]);
      assert.equal(new Set(plan.matchups.map(row=>`${row.TeamAEntryId}:${row.TeamBEntryId}`)).size,117);
      for(const window of plan.windows)for(const team of window.teamLoads) {
        assert.equal(team.series,team.GroupId===3&&window.number===2?5:4);
      }
    }
  }finally{db.close();}
});

test('generation retains complete round robins across odd/even groups and configurable paces',()=>{
  for(let size=2;size<=14;size++)for(const pace of [1,2,3,4,5,6]) {
    const {db,store,settings}=fixture([size]);try {
      store.saveSettings(1,{...settings,seriesPerWindow:pace});const plan=store.generate(1,{},()=>.37);
      assert.equal(plan.matchups.length,size*(size-1)/2,`size ${size}, pace ${pace}`);
      assert.equal(new Set(plan.matchups.map(row=>`${row.TeamAEntryId}:${row.TeamBEntryId}`)).size,plan.matchups.length);
      for(const team of plan.teams)assert.equal(plan.matchups.filter(row=>[row.TeamAEntryId,row.TeamBEntryId].includes(team.EntryId)).length,size-1);
    }finally{db.close();}
  }
});

test('re-slotting an existing 5+4 plan moves the extra series to the end without replacing opponents',()=>{
  const {db,store,settings}=fixture([10]);try {
    store.saveSettings(1,{...settings,seriesPerWindow:4});const generated=store.generate(1,{},()=>.37);
    generated.matchups.forEach((row,index)=>db.prepare('UPDATE SeasonMatchups SET WindowNumber=? WHERE MatchupId=?').run(index<25?1:2,row.MatchupId));
    assert.ok(store.read(1).windows[0].teamLoads.every(team=>team.series===5));
    const after=store.reslot(1);assert.equal(after.windows.length,2);
    assert.ok(after.windows[0].teamLoads.every(team=>team.series===4));
    assert.ok(after.windows[1].teamLoads.every(team=>team.series===5));
    assert.deepEqual(after.matchups.map(row=>row.MatchupId),generated.matchups.map(row=>row.MatchupId));
    assert.deepEqual(after.warnings,[]);
  }finally{db.close();}
});

test('re-slotting uses the saved pace while preserving pairings, IDs, and existing per-group order',()=>{
  const {db,store,settings,audit}=fixture([9,9,10]);try {
    store.saveSettings(1,{...settings,seriesPerWindow:4});const before=store.generate(1,{},()=>.37);
    const pairings=plan=>plan.matchups.map(({MatchupId,GroupId,TeamAEntryId,TeamBEntryId})=>({MatchupId,GroupId,TeamAEntryId,TeamBEntryId})).sort((a,b)=>a.MatchupId-b.MatchupId);
    const saved=store.saveSettings(1,{...settings,startDate:'2026-11-02',seriesPerWindow:2,weeksPerWindow:1});
    assert.deepEqual(saved.matchups,before.matchups,'saving settings alone keeps current window assignments');
    const after=store.reslot(1);assert.deepEqual(pairings(after),pairings(before));assert.equal(after.windows.length,5);
    for(const group of before.groups)assert.deepEqual(after.matchups.filter(row=>row.GroupId===group.GroupId).map(row=>row.MatchupId),
      before.matchups.filter(row=>row.GroupId===group.GroupId).map(row=>row.MatchupId));
    assert.equal(after.windows[0].startDate,'2026-11-02');assert.equal(after.windows[1].startDate,'2026-11-09');
    assert.ok(after.windows.every(window=>window.teamLoads.every(team=>team.series<=2)));
    assert.deepEqual(store.reslot(1).matchups,after.matchups,'re-slotting again is stable');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchLeague').get().n,1);
    assert.deepEqual(db.prepare('SELECT * FROM LeagueStandings').all(),[{LeagueId:900,TeamId:101,Wins:1,Losses:0}]);
    assert.ok(audit.some(row=>row.type==='Schedule Re-slotted'));
  }finally{db.close();}
});

test('re-slotting preserves manually moved order and migrates an older plan without changing opponents',()=>{
  const {db,store,settings}=fixture([4]);try {
    store.saveSettings(1,{...settings,seriesPerWindow:4});
    for(const opponent of [2,3,4])store.saveMatchup(1,{teamAEntryId:1,teamBEntryId:opponent,windowNumber:opponent===2?5:1});
    const original=store.read(1).matchups.map(row=>row.MatchupId);
    db.exec('ALTER TABLE SeasonMatchups DROP COLUMN SortOrder');
    const migrated=new SeasonScheduleStore(db);const after=migrated.reslot(1);
    assert.deepEqual(after.matchups.map(row=>row.MatchupId),original);assert.equal(after.windows.length,1);
    assert.deepEqual(migrated.reslot(1).matchups,after.matchups);
  }finally{db.close();}
});

test('re-slotting rejects empty, changed-group and ended plans without partial writes',()=>{
  const {db,store,settings}=fixture([4,2]);try {
    assert.throws(()=>store.reslot(1),{status:409});store.saveSettings(1,settings);
    assert.throws(()=>store.reslot(1),{status:409});
    store.generate(1,{},()=>.37);const rows=db.prepare('SELECT * FROM SeasonMatchups ORDER BY MatchupId').all();
    db.exec('UPDATE LeagueRosterEntries SET GroupId=2 WHERE EntryId=1');
    assert.throws(()=>store.reslot(1),{status:409});assert.deepEqual(db.prepare('SELECT * FROM SeasonMatchups ORDER BY MatchupId').all(),rows);
    db.exec("UPDATE LeagueRosterEntries SET GroupId=1 WHERE EntryId=1;UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=1");
    assert.throws(()=>store.reslot(1),{status:409});
  }finally{db.close();}
});

test('manual edits permit extra workload as advice while rejecting duplicate and cross-group pairings', () => {
  const { db, store, settings } = fixture([5, 2]);
  try {
    store.saveSettings(1, { ...settings, seriesPerWindow: 1 });
    store.saveMatchup(1, { teamAEntryId: 1, teamBEntryId: 2, windowNumber: 1 });
    const plan = store.saveMatchup(1, { teamAEntryId: 1, teamBEntryId: 3, windowNumber: 1 });
    assert.equal(plan.matchups.length, 2);
    assert.ok(plan.warnings.some(note => note.includes('Team 1 has 2 series')));
    assert.throws(() => store.saveMatchup(1, { teamAEntryId: 2, teamBEntryId: 1, windowNumber: 2 }), { status: 409 });
    assert.throws(() => store.saveMatchup(1, { teamAEntryId: 1, teamBEntryId: 6, windowNumber: 1 }), { status: 400 });
    assert.throws(() => store.saveMatchup(1, { teamAEntryId: 1, teamBEntryId: 1, windowNumber: 1 }), { status: 400 });
    assert.throws(() => store.saveMatchup(1, { teamAEntryId: 1, teamBEntryId: 999, windowNumber: 1 }), { status: 400 });
    const row = plan.matchups[1];
    const moved = store.saveMatchup(1, { teamAEntryId: 1, teamBEntryId: 3, windowNumber: 2 }, row.MatchupId);
    assert.equal(moved.matchups.find(item => item.MatchupId === row.MatchupId).WindowNumber, 2);
    assert.deepEqual(moved.warnings, []);
    assert.equal(store.remove(1, row.MatchupId).matchups.length, 1);
    assert.throws(() => store.remove(1, row.MatchupId), { status: 404 });
    // Linking the real Dota team ID later preserves the plan and public team link.
    db.exec('UPDATE LeagueRosterEntries SET TeamId = 1234 WHERE EntryId = 1');
    assert.equal(store.read(1).matchups[0].TeamAId, 1234);
  } finally { db.close(); }
});

test('random manual matchups select unused in-group opponents, optionally keeping one fixed team', () => {
  const { db, store, settings } = fixture([4, 2]);
  try {
    store.saveSettings(1, settings);
    for (let i = 0; i < 3; i++) {
      store.randomMatchup(1, { groupId: 1, teamAEntryId: 1, windowNumber: 1 }, () => 0);
    }
    const plan = store.read(1);
    assert.equal(plan.matchups.length, 3);
    assert.ok(plan.matchups.every(row => row.TeamAEntryId === 1 && row.TeamBEntryId <= 4));
    assert.throws(() => store.randomMatchup(1, { groupId: 1, teamAEntryId: 1, windowNumber: 2 }), { status: 409 });
    const otherGroup = store.randomMatchup(1, { groupId: 2, windowNumber: 2 }, () => 0);
    assert.equal(otherGroup.matchups.at(-1).TeamAEntryId, 5);
    assert.equal(otherGroup.matchups.at(-1).TeamBEntryId, 6);
    assert.throws(() => store.randomMatchup(1, { groupId: 2, teamAEntryId: 1, windowNumber: 2 }), { status: 409 });
  } finally { db.close(); }
});

test('settings and lifecycle validation prevents invalid dates, foreign seasons, or ended-season writes', () => {
  const { db, store, settings } = fixture();
  try {
    for (const startDate of ['2026-02-30', 'bad', '', '1999-12-31']) {
      assert.throws(() => store.saveSettings(1, { ...settings, startDate }), { status: 400 });
    }
    for (const seriesPerWindow of [0, 1.5, 21, null, false]) {
      assert.throws(() => store.saveSettings(1, { ...settings, seriesPerWindow }), { status: 400 });
    }
    assert.throws(() => store.saveSettings(1, { ...settings, weeksPerWindow: 0 }), { status: 400 });
    assert.throws(() => store.saveSettings(2, settings), { status: 409 });
    assert.throws(() => store.saveSettings(99, settings), { status: 404 });
    store.saveSettings(1, settings);
    const plan = store.saveMatchup(1, { teamAEntryId: 1, teamBEntryId: 2, windowNumber: 1 });
    assert.throws(() => store.saveMatchup(1, { teamAEntryId: 1, teamBEntryId: 3, windowNumber: 0 }), { status: 400 });
    assert.throws(() => store.saveMatchup(1, { teamAEntryId: 1, teamBEntryId: 3, windowNumber: 1 }, 99), { status: 404 });
    db.exec("UPDATE LeagueSeasons SET Status = 'ended' WHERE SeasonId = 1");
    assert.throws(() => store.remove(1, plan.matchups[0].MatchupId), { status: 409 });
    assert.throws(() => store.generate(1, { replaceExisting: true }), { status: 409 });
    assert.equal(store.forLeague(900).matchups.length, 1);
  } finally { db.close(); }
});

test('API supports manual and randomized planning with a public read view and validates request IDs', async () => {
  const { db, store, settings } = fixture([4]);
  const app = express();
  app.use(express.json());
  app.use('/api', createPublicScheduleRouter(store));
  // The real mount inherits checkAdmin; this isolated server supplies an authenticated-admin fixture.
  app.use('/api/admin/seasons', (req, res, next) => req.get('x-test-admin') === 'yes'
    ? next() : res.status(401).json({ error: 'Admin required' }), createAdminScheduleRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', body, admin = true) {
    const response = await fetch(base + path, { method,
      headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-test-admin': 'yes' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  const endpoint = '/api/admin/seasons/1/schedule';
  try {
    assert.equal((await request(endpoint, 'GET', undefined, false)).status, 401);
    assert.equal((await request('/api/admin/seasons/invalid/schedule')).status, 400);
    assert.equal((await request(endpoint, 'PUT', settings)).status, 200);
    const added = await request(`${endpoint}/matchups/random`, 'POST', { groupId: 1, windowNumber: 1, teamAEntryId: 1 });
    assert.equal(added.status, 200);
    const row = added.data.matchups[0];
    const moved = await request(`${endpoint}/matchups/${row.MatchupId}`, 'PATCH', {
      teamAEntryId: row.TeamAEntryId, teamBEntryId: row.TeamBEntryId, windowNumber: 2,
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.matchups[0].WindowNumber, 2);
    assert.equal((await request(`${endpoint}/randomize`, 'POST', {})).status, 409);
    assert.equal((await request(`${endpoint}/randomize`, 'POST', { replaceExisting: true })).data.matchups.length, 6);
    assert.equal((await request(`${endpoint}/reslot`,'POST',{},false)).status,401);
    const beforeReslot=(await request(endpoint)).data.matchups;
    const reslotted=await request(`${endpoint}/reslot`,'POST',{});assert.equal(reslotted.status,200);
    assert.deepEqual(reslotted.data.matchups.map(row=>row.MatchupId),beforeReslot.map(row=>row.MatchupId));
    const publicView = await request('/api/leagues/900/schedule', 'GET', undefined, false);
    assert.equal(publicView.status, 200);
    assert.equal(publicView.data.matchups.length, 6);
    assert.equal((await request('/api/leagues/bad/schedule')).status, 400);
    assert.equal((await request(`${endpoint}/matchups/bad`, 'DELETE')).status, 400);
    const latest = await request(endpoint);
    assert.equal((await request(`${endpoint}/matchups/${latest.data.matchups[0].MatchupId}`, 'DELETE')).data.matchups.length, 5);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
