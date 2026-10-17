import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { readFileSync } from 'node:fs';
import DraftGodStore from '../config/draftGodStore.js';
import { createDraftGodRouter } from '../routes/draftGodRoutes.js';
import { isDraftGodOwner } from '../middleware/checkDraftGod.js';
import { ensurePublicScoutingSchema, publicScoutingPlayers, recordPublicSync } from '../config/publicScouting.js';
import { DEFAULT_FORMAT, analyzeDraft, assignLineup, sequenceFor, validateBoard, validateDraftState } from '../shared/draftModel.js';

function fixture() {
  const db = new Database(':memory:'), pub = new Database(':memory:');
  db.exec(readFileSync(new URL('../scripts/db/ladsData.schema.sql', import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE IF NOT EXISTS LeagueTeamNames (LeagueId INTEGER,TeamId INTEGER,DisplayName TEXT);
    CREATE TABLE IF NOT EXISTS LeagueRosterEntries (EntryId INTEGER PRIMARY KEY,LeagueId INTEGER,GroupId INTEGER,DisplayName TEXT,TeamId INTEGER,TeamSubmissionId INTEGER,SortOrder INTEGER);
    INSERT INTO LeagueInfo VALUES (10,'Previous',0),(20,'Test league',0),(30,'Upcoming signups',1);
    INSERT INTO LeagueSeasons (SeasonId,LeagueName,Status,ExternalLeagueId,CreatedAt,UpdatedAt) VALUES
      (1,'Previous','ended',10,'old','old'),(2,'Test league','ended',20,'old','old'),(3,'Upcoming signups','signup_closed',30,'now','now');
    INSERT INTO TeamInfo (TeamId,TeamName) VALUES (100,'Our team'),(200,'Opponent');
    INSERT INTO SeasonTeams (TeamSubmissionId,SeasonId,TeamName,SubmittedAt,UpdatedAt) VALUES
      (1,3,'New Alpha','now','now'),(2,3,'New Beta','now','now');`);
  for (let i = 1; i <= 30; i++) db.prepare('INSERT INTO HeroInfo VALUES (?,?)').run(i, `Hero ${i}`);
  for (let i = 1; i <= 11; i++) db.prepare('INSERT INTO PlayerInfo (PlayerId,PlayerName) VALUES (?,?)').run(i, `Player ${i}`);
  for (let i = 1; i <= 10; i++) db.prepare(`INSERT INTO SeasonTeamPlayers
    (TeamSubmissionId,PlayerId,Slot,MMR,DotaProfileUrl,ScreenshotMime,ScreenshotData) VALUES (?,?,?,6000,'url','image/png',X'00')`)
    .run(i <= 5 ? 1 : 2, i, (i - 1) % 5);
  pub.exec(`CREATE TABLE PublicMatchPlayer (MatchId INTEGER,PlayerId INTEGER,HeroId INTEGER,Won INTEGER,DateCreated TEXT,PRIMARY KEY(MatchId,PlayerId));
    CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);`);
  ensurePublicScoutingSchema(pub);
  const now = () => Date.parse('2026-01-10T12:00:00Z'), store = new DraftGodStore(db, pub, { now });
  function game(id, date, league = 20, winner = 100) {
    db.prepare('INSERT INTO MatchTeam (MatchId,TeamRad,TeamDire,WinnerId,SeriesId) VALUES (?,100,200,?,0)').run(id, winner);
    db.prepare('INSERT INTO MatchLeague VALUES (?,?,?)').run(id, league, date);
    for (let player = 1; player <= 10; player++) {
      db.prepare('INSERT INTO MatchPlayer (MatchId,PlayerId,HeroId,Kills,Deaths,Assists,Lasthits,GPM,XPM) VALUES (?,?,?,0,0,0,0,0,0)').run(id, player, player);
      db.prepare('INSERT INTO MatchTeamPlayer (MatchId,PlayerId,TeamId) VALUES (?,?,?)').run(id, player, player <= 5 ? 100 : 200);
    }
    let a = 1, b = 6, banned = 11;
    DEFAULT_FORMAT.actions.forEach((action, order) => db.prepare('INSERT INTO PickInfo VALUES (?,?,?,?,?)')
      .run(id, Number(action[1] === 'P'), action[1] === 'P' ? action[0] === 'A' ? a++ : b++ : banned++, order, action[0] === 'A' ? 0 : 1));
  }
  const config = { seasonId: 2, ourTeam: 't100', opponentTeam: 't200', firstPick: true, radiant: true,
    asOf: '2026-01-03T12:00:00.000Z', format: DEFAULT_FORMAT,
    lineups: { our: [1,2,3,4,5].map(id => ({ id, role: id })), opponent: [6,7,8,9,10].map(id => ({ id, role: id - 5 })) } };
  return { db, pub, store, game, config, close() { db.close(); pub.close(); } };
}

test('signup teams and five-player rosters are available before team IDs or matches exist', () => {
  const f = fixture(); try {
    const setup = f.store.setup(3);
    assert.deepEqual(setup.teams.map(t => t.key), ['s1', 's2']);
    assert.equal(setup.teams[0].roster.source, 'signup');
    const config = { ...f.config, seasonId: 3, ourTeam: 's1', opponentTeam: 's2' };
    const data = f.store.context(config);
    assert.equal(data.teams.s1.games, 0); assert.equal(Object.keys(data.players).length, 10);
    assert.equal(JSON.stringify(data).includes('Screenshot'), false);
    const model = analyzeDraft(data, config, []);
    assert.equal(model.score, 50); assert.equal(model.confidence, 'Unknown');
    assert.equal(model.recommendations.length, 0); // No invented ban likelihood for completely unknown heroes.
    assert.equal(publicScoutingPlayers(f.db).length, 10);
  } finally { f.close(); }
});

test('history is deduplicated, bounded by the cutoff, excludes same-day date-only/undated/remade games, and uses games as pick denominator', () => {
  const f = fixture(); try {
    f.game(1, '2026-01-01', 10); f.game(2, '2026-01-02T12:00:00Z');
    f.game(3, '2026-01-03T13:00:00Z'); f.game(4, '2026-01-03'); f.game(5, null); f.game(6, '2026-01-02', 20, 999);
    f.game(7, '2026-01-02'); f.db.prepare('UPDATE MatchTeam SET Rehost=1 WHERE MatchId=7').run();
    f.db.exec(`INSERT INTO MatchPlayer (MatchId,PlayerId,HeroId,Kills,Deaths,Assists,Lasthits,GPM,XPM) VALUES (2,1,1,0,0,0,0,0,0);
      INSERT INTO MatchTeamPlayer (MatchId,PlayerId,TeamId) VALUES (2,1,100);
      INSERT INTO PickInfo SELECT * FROM PickInfo WHERE MatchId=2;
      INSERT INTO LeagueTeamNames VALUES (20,100,'Scoped team');`);
    f.pub.exec(`INSERT INTO PublicMatchPlayer VALUES (1,1,1,1,'2026-01-02T10:00:00.000Z'),(2,1,20,1,'2026-01-04T00:00:00.000Z');`);
    const data = f.store.context(f.config);
    assert.equal(data.teams.t100.name, 'Scoped team'); assert.equal(data.coverage.matches, 2);
    assert.equal(data.players[1].games, 2); assert.equal(data.players[1].heroes[0].games, 2);
    assert.equal(data.teams.t100.heroes[1].picks, 2); assert.equal(data.teams.t100.games, 2);
    assert.deepEqual(data.players[1].publicHeroes.map(h => h.id), [1]);
    assert.equal(data.coverage.excludedUndated, 1);
    const initial = analyzeDraft(data, f.config, []);
    assert.equal(initial.recommendations.find(r => r.heroId === 6).pickRate, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(data)) < 100000);
    const same = f.store.history(f.store.getSeason(2), f.config.asOf);
    assert.equal(same, f.store.history(f.store.getSeason(2), f.config.asOf));
  } finally { f.close(); }
});

test('assessment is symmetric, map side is independent, flex assignments are unique, and known role conflicts are rejected', () => {
  const f = fixture(); try {
    for (let i = 1; i <= 10; i++) f.game(i, '2026-01-01', 20, i <= 5 ? 100 : 200);
    const data = f.store.context(f.config), seq = sequenceFor(f.config);
    const board = seq.slice(0, 9).map((s, i) => ({ heroId: i < 7 ? 11 + i : s.side === 'our' ? 1 : 6, playerId: null }));
    assert.equal(analyzeDraft(data, f.config, board).score, 50);
    assert.equal(analyzeDraft(data, { ...f.config, radiant: false }, board).score, 50);
    const inverted = { ...f.config, firstPick: false, lineups: { our: f.config.lineups.opponent, opponent: f.config.lineups.our }, ourTeam: 't200', opponentTeam: 't100' };
    assert.equal(analyzeDraft(data, inverted, board).score, 50);
    const picks = [{ heroId: 1 }, { heroId: 2 }, { heroId: 3 }];
    const assignment = assignLineup(picks, f.config.lineups.our, data);
    assert.equal(assignment.valid, true); assert.equal(new Set(assignment.assignments.map(p => p.playerId)).size, 3);
    data.heroProfiles[1] = { roles: [1], tags: ['initiation'] };
    data.heroProfiles[2] = { roles: [1], tags: ['damage'] };
    assert.equal(assignLineup(picks, f.config.lineups.our, data).valid, false);
    assert.throws(() => validateBoard([...board, { heroId: 1 }], f.config), /once/);
    const duplicatePicks = seq.slice(0, 14).map((step, i) => ({ heroId: i + 1, playerId: step.side === 'our' && step.type === 'pick' ? 1 : null }));
    assert.throws(() => validateBoard(duplicatePicks, f.config), /two heroes/);
    const duplicate = structuredClone(f.config); duplicate.lineups.opponent[0].id = 1;
    assert.throws(() => validateDraftState({ version: 1, config: duplicate, board: [] }), /once/);
  } finally { f.close(); }
});

test('saved drafts persist with optimistic concurrency, alternatives, profile validation and deletion', () => {
  const f = fixture(); try {
    f.game(1, '2026-01-01');
    const state = { version: 1, config: f.config, board: [], undo: [], redo: [] };
    const draft = f.store.saveDraft(null, { name: 'Match plan', state });
    const changed = { ...state, board: [{ heroId: 11, playerId: null }], undo: [[]] };
    const saved = f.store.saveDraft(draft.id, { name: 'Plan A', state: changed, revision: draft.revision });
    assert.equal(saved.revision, 2); assert.equal(saved.state.board.length, 1);
    assert.throws(() => f.store.saveDraft(draft.id, { name: 'Stale tab', state, revision: 1 }), { status: 409 });
    assert.equal(f.store.getDraft(draft.id).name, 'Plan A');
    const alt = f.store.saveDraft(null, { name: 'Alternative', state: saved.state });
    assert.notEqual(alt.id, draft.id); assert.equal(f.store.listDrafts().length, 2);
    const patch=f.store.context(f.config).meta.current.key;
    f.store.saveHeroProfile(1, { roles: [1, 2], tags: ['initiation', 'lockdown'], patch });
    assert.deepEqual(f.store.context(f.config).heroProfiles[1].roles, [1, 2]);
    assert.throws(() => f.store.saveHeroProfile(1, { roles: [6], tags: ['imagined'] }), { status: 400 });
    f.store.deleteDraft(alt.id); assert.throws(() => f.store.getDraft(alt.id), { status: 404 });
  } finally { f.close(); }
});

test('every Draft God API is owner-only regardless of cached access/admin privileges; responses cannot be publicly cached', async () => {
  const f = fixture(); const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.isAuthenticated = () => req.headers['x-user'] !== undefined;
    req.user = req.headers['x-user'] ? { id: req.headers['x-user'] } : null;
    req.session = { canDraftGod: true, isAdmin: true }; next(); });
  app.use('/draftgod', createDraftGodRouter(f.store));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const root = `http://127.0.0.1:${server.address().port}/draftgod`, owner = '76561198009485428';
  try {
    assert.equal(isDraftGodOwner(owner), true); assert.equal(isDraftGodOwner('invalid'), false);
    for (const [path, method] of [['', 'GET'], ['/context', 'POST'], ['/drafts','GET'], ['/drafts','POST'], ['/drafts/1','GET'], ['/drafts/1','PATCH'], ['/drafts/1','DELETE'], ['/heroes/1','PUT'], ['/meta/7.40c','PUT'], ['/players?search=Player','GET']]) {
      assert.equal((await fetch(root + path, { method })).status, 401);
      const denied = await fetch(root + path, { method, headers: { 'x-user': '76561198009485429' } });
      assert.equal(denied.status, 403); assert.equal(denied.headers.get('cache-control'), 'private, no-store');
    }
    const result = await fetch(root + '?seasonId=3', { headers: { 'x-user': owner } });
    assert.equal(result.status, 200); assert.equal((await result.json()).teams.length, 2);
    assert.equal((await fetch(root + '?seasonId=bad', { headers: { 'x-user': owner } })).status, 400);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); f.close(); }
});

test('public collection distinguishes success from failure without erasing prior successful sync', () => {
  const f = fixture(); try {
    recordPublicSync(f.pub, 1, true); const previous = f.pub.prepare('SELECT * FROM PublicPlayerSync WHERE PlayerId=1').get();
    recordPublicSync(f.pub, 1, false, 'FETCH_FAILED'); const failed = f.pub.prepare('SELECT * FROM PublicPlayerSync WHERE PlayerId=1').get();
    assert.equal(failed.LastSuccessAt, previous.LastSuccessAt); assert.equal(failed.ErrorCode, 'FETCH_FAILED');
  } finally { f.close(); }
});

test('private patch curation and boundary overrides are scoped, validated and reversible',()=>{
  const f=fixture();try{
    f.game(1,'2026-01-01');const context=f.store.context(f.config),patch=context.meta.current.key;
    f.store.saveHeroProfile(1,{roles:[1],tags:['late','physical'],patch});
    assert.equal(f.store.context(f.config).heroProfiles[1].patch,patch);
    const later={...f.config,asOf:'2026-01-10T11:00:00Z'};
    // A profile explicitly curated for this patch survives reopening; unrelated patches do not inherit it.
    assert.equal(f.store.context(later).heroProfiles[1].patch,patch);
    f.db.prepare('INSERT INTO DraftGodPatches VALUES (?,?,1,1,?,?,?)').run('test-next','2026-01-05T00:00:00Z','{}','fixture','2026-01-10T00:00:00Z');
    assert.equal(f.store.context(later).heroProfiles[1],undefined);
    f.store.saveHeroProfile(2,{roles:[1],tags:['damage']});
    assert.equal(f.store.context(f.config).heroProfiles[2],undefined);
    assert.throws(()=>f.store.saveHeroProfile(1,{roles:[1],tags:[],patch:'no-such-patch'}),{status:400});
    f.store.saveMetaOverride(patch,{heroId:1,transfer:0,note:'Mechanical reset'});
    assert.equal(f.store.context(f.config).meta.overrides[`${patch}:1`].transfer,0);
    assert.throws(()=>f.store.saveMetaOverride(patch,{heroId:1,transfer:2,note:'Invalid'}),{status:400});
    assert.throws(()=>f.store.saveMetaOverride(patch,{heroId:9999,transfer:0,note:'Invalid'}),{status:400});
    f.store.saveMetaOverride(patch,{heroId:1,transfer:null});
    assert.equal(f.store.context(f.config).meta.overrides[`${patch}:1`],undefined);
    assert.throws(()=>f.store.context({...f.config,metaMode:'all-time-wins'}),{status:400});
  }finally{f.close();}
});
