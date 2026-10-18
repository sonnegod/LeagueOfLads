import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import PlayerAwardsStore from '../config/playerAwards.js';
import { createPlayerAwardsRouter } from '../routes/playerAwardsRoutes.js';
import { ensureChampionshipRosterSchema } from '../config/championshipRoster.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE LeagueInfo (LeagueId INTEGER PRIMARY KEY, LeagueName TEXT, Active INTEGER);
    CREATE TABLE LeagueSeasons (SeasonId INTEGER PRIMARY KEY, ExternalLeagueId INTEGER,
      LeagueName TEXT, Status TEXT, ChampionTeamId INTEGER);
    CREATE TABLE HeroInfo (HeroId INTEGER PRIMARY KEY, HeroName TEXT);
    CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY, TeamRad INTEGER, TeamDire INTEGER, WinnerId INTEGER);
    CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY, LeagueId INTEGER);
    CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, HeroId INTEGER);
    CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);
    CREATE TABLE TeamInfo (TeamId INTEGER PRIMARY KEY, TeamName TEXT);
    CREATE TABLE LeagueTeamNames (LeagueId INTEGER, TeamId INTEGER, DisplayName TEXT);
    CREATE TABLE SeasonTeams (TeamSubmissionId INTEGER, SeasonId INTEGER, ExternalTeamId INTEGER);
    CREATE TABLE TeamRosterPlayers (TeamSubmissionId INTEGER, PlayerId INTEGER);
    INSERT INTO HeroInfo VALUES (1, 'Pudge'), (2, 'Invoker');`);
  ensureChampionshipRosterSchema(db);
  let matchId = 0;
  const league = (id, status = 'ended', champion = null) => {
    db.prepare('INSERT INTO LeagueInfo VALUES (?, ?, ?)').run(id, `Season ${id}`, Number(status === 'active'));
    db.prepare('INSERT INTO LeagueSeasons VALUES (?, ?, ?, ?, ?)').run(id, id, `Season ${id}`, status, champion);
  };
  const game = (leagueId, winner = 100, teams = [100, 200]) => {
    const id = ++matchId;
    db.prepare('INSERT INTO MatchLeague VALUES (?, ?)').run(id, leagueId);
    db.prepare('INSERT INTO MatchTeam VALUES (?, ?, ?, ?)').run(id, ...teams, winner);
    return id;
  };
  const appearance = (id, player, hero = 1, team = 100) => {
    db.prepare('INSERT INTO MatchPlayer VALUES (?, ?, ?)').run(id, player, hero);
    db.prepare('INSERT INTO MatchTeamPlayer VALUES (?, ?, ?)').run(id, player, team);
  };
  const games = (leagueId, player, total, wins, hero = 1) => {
    for (let i = 0; i < total; i++) appearance(game(leagueId, i < wins ? 100 : 200), player, hero);
  };
  return { db, league, game, appearance, games };
}

test('hero win rate awards require 10 games, share exact ties, and ignore duplicate/conflicting results', () => {
  const f = fixture();
  try {
    f.league(10);
    f.games(10, 1, 10, 8);
    f.games(10, 2, 30, 24);
    f.games(10, 3, 9, 9); // Unbeaten, but below the minimum.
    f.appearance(1, 1); // Repeated player and team rows must count only once.
    f.appearance(f.game(10, null), 1); // Incomplete result.
    f.appearance(f.game(10), 1, 1, 999); // Team is not a participant.
    const wrongSide = f.game(10);
    f.appearance(wrongSide, 1);
    f.db.prepare('INSERT INTO MatchTeamPlayer VALUES (?, 1, 200)').run(wrongSide);
    const wrongHero = f.game(10);
    f.appearance(wrongHero, 1);
    f.db.prepare('INSERT INTO MatchPlayer VALUES (?, 1, 2)').run(wrongHero);
    const store = new PlayerAwardsStore(f.db);
    const one = store.forPlayer(1).awards;
    const specialist = one.find(a => a.type === 'hero_specialist');
    assert.equal(specialist.games, 10);
    assert.equal(specialist.wins, 8);
    assert.equal(specialist.winRate, 80);
    assert.equal(specialist.shared, true);
    assert.equal(specialist.tiedPlayers, 2);
    assert.equal(specialist.provisional, false);
    assert.equal(specialist.minimumGames, 10);
    assert.equal(specialist.scope, 'all-time');
    assert.equal(one.some(a => a.scope === 'season'), false);
    assert.equal(store.forPlayer(2).awards.find(a => a.type === 'hero_loyalist').games, 30);
    for (const playerId of [1, 2, 3]) {
      assert.equal(store.forPlayer(playerId).awards.some(a => a.heroId && a.scope === 'season'), false);
    }
    assert.equal('seasonHeroGames' in store.forPlayer(1).criteria, false);
    assert.deepEqual(store.forPlayer(3).awards, []);
    assert.deepEqual(store.forPlayer(999).awards, []);
  } finally { f.db.close(); }
});

test('all-time records combine seasons and issue no seasonal stat awards', () => {
  const f = fixture();
  try {
    f.league(10);
    f.league(20, 'active');
    f.games(10, 1, 10, 8);
    f.games(20, 1, 10, 8);
    f.games(10, 2, 15, 11);
    f.games(10, 3, 1, 1);
    f.games(20, 3, 14, 14);
    const store = new PlayerAwardsStore(f.db);
    const one = store.forPlayer(1).awards;
    const veteran = one.find(a => a.type === 'veteran' && a.scope === 'all-time');
    assert.equal(veteran.games, 20);
    assert.equal(veteran.minimumGames, 0);
    assert.equal(veteran.leagueId, null);
    assert.equal(one.find(a => a.leagueId === 20 && a.type === 'hero_loyalist'), undefined);
    const two = store.forPlayer(2).awards;
    assert.equal(two.some(a => a.type === 'winningest' && a.scope === 'season'), false);
    assert.equal(two.some(a => a.type === 'veteran'), false);
    for (const playerId of [1, 2, 3]) {
      assert.equal(store.forPlayer(playerId).awards.some(a => a.scope === 'season'), false);
    }
    const three = store.forPlayer(3).awards;
    assert.equal(three.find(a => a.type === 'hero_specialist' && a.scope === 'all-time').games, 15);
    assert.equal(three.some(a => a.type === 'winningest'), false);
    assert.equal(one.find(a => a.type === 'winningest' && a.scope === 'all-time').winRate, 80);
    assert.equal(three.some(a => a.heroId && a.scope === 'season'), false);
    assert.equal(three.some(a => a.type === 'winningest' && a.leagueId === 20), false);
    const cache = store.cache;
    store.forPlayer(1);
    assert.equal(store.cache, cache);
    f.games(20, 1, 5, 5);
    store.forPlayer(1);
    assert.notEqual(store.cache, cache);
    assert.equal(store.forPlayer(1).awards.find(a => a.type === 'veteran').games, 25);
    for (const playerId of [1, 2, 3]) {
      assert.equal(store.forPlayer(playerId).awards.some(a => a.scope === 'season'), false);
    }
  } finally { f.db.close(); }
});

test('overall win rate requires 20 games while all-time most-played awards have no minimum', () => {
  const f = fixture();
  try {
    f.league(10);
    f.games(10, 1, 19, 19);
    f.games(10, 2, 1, 0, 2);
    const store = new PlayerAwardsStore(f.db);
    assert.equal(store.forPlayer(1).awards.some(a => a.type === 'winningest'), false);
    assert.equal(store.forPlayer(1).awards.find(a => a.type === 'veteran').games, 19);
    const loyalist = store.forPlayer(2).awards.find(a => a.type === 'hero_loyalist');
    assert.equal(loyalist.games, 1);
    assert.equal(loyalist.minimumGames, 0);
    assert.equal(store.forPlayer(2).awards.some(a => a.type === 'hero_specialist'), false);
    f.games(10, 1, 1, 0);
    const winningest = store.forPlayer(1).awards.find(a => a.type === 'winningest');
    assert.equal(winningest.games, 20);
    assert.equal(winningest.minimumGames, 20);
    assert.equal(winningest.winRate, 95);
  } finally { f.db.close(); }
});

test('champions require a recorded ended season, correct team, majority participation, and known roster membership', () => {
  const f = fixture();
  try {
    f.league(10, 'ended', 100);
    f.league(20, 'ended', 300);
    f.league(30, 'active', 400);
    f.league(40, 'ended', null);
    f.db.exec(`INSERT INTO TeamInfo VALUES (100, 'Champions'), (300, 'Legacy winners');
      INSERT INTO LeagueTeamNames VALUES (10, 100, 'Season champions');
      INSERT INTO SeasonTeams VALUES (1, 10, 100);
      INSERT INTO TeamRosterPlayers VALUES (1, 1), (1, 3), (1, 4);`);
    for (let i = 0; i < 10; i++) {
      const match = f.game(10);
      if (i < 6) f.appearance(match, 1);
      if (i < 8) f.appearance(match, 2); // Unrostered, even though present in most games.
      if (i < 5) f.appearance(match, 3); // Exactly half is insufficient.
      if (i < 6) f.appearance(match, 4, 1, 200); // Only played against the winners.
    }
    f.appearance(f.game(10, null), 1); // Does not increase the denominator.
    for (let i = 0; i < 8; i++) {
      const match = f.game(20, 300, [300, 400]);
      if (i < 5) f.appearance(match, 5, 1, 300);
      if (i < 4) f.appearance(match, 6, 1, 300);
    }
    f.appearance(f.game(30, 400, [400, 500]), 7, 1, 400);
    f.appearance(f.game(40, 500, [500, 600]), 8, 1, 500);
    const store = new PlayerAwardsStore(f.db);
    const champion = store.forPlayer(1).awards[0];
    assert.equal(champion.type, 'champion');
    assert.equal(champion.leagueId, 10);
    assert.equal(champion.teamName, 'Season champions');
    assert.equal(champion.games, 6);
    assert.equal(champion.teamGames, 10);
    assert.equal(champion.rosterSource, 'signup');
    for (const playerId of [2, 3, 4, 6, 7, 8]) {
      assert.equal(store.forPlayer(playerId).awards.some(a => a.type === 'champion'), false);
    }
    assert.equal(store.forPlayer(5).awards.find(a => a.type === 'champion').rosterSource, 'majority-lineup');
    f.db.prepare('UPDATE LeagueSeasons SET ChampionTeamId = 200 WHERE SeasonId = 10').run();
    assert.equal(store.forPlayer(1).awards.some(a => a.type === 'champion'), false);
  } finally { f.db.close(); }
});

test('player listings receive one trophy per championship, including lifetime wins under a league filter', () => {
  const f = fixture();
  try {
    f.league(10, 'ended', 100);
    f.league(20, 'ended', 300);
    for (let i = 0; i < 3; i++) {
      const first = f.game(10);
      f.appearance(first, 1);
      f.appearance(first, 2);
      f.appearance(f.game(20, 300, [300, 400]), 1, 1, 300);
    }
    const store = new PlayerAwardsStore(f.db);
    const players = [{ PlayerId: 1, PlayerName: 'Two titles', GamesPlayed: 6 },
      { PlayerId: 2, PlayerName: 'One title', GamesPlayed: 3 },
      { PlayerId: 3, PlayerName: 'No titles', GamesPlayed: 0 }];
    const result = store.withChampionships(players);
    assert.deepEqual(result.map(player => player.championships.length), [2, 1, 0]);
    assert.deepEqual(result[0].championships.map(award => award.leagueId), [20, 10]);
    assert.equal(result[0].championships[0].leagueName, 'Season 20');
    assert.equal(result[0].championships[0].type, 'champion');
    assert.deepEqual(Object.keys(result[0].championships[0]).sort(), ['id', 'leagueId', 'leagueName', 'type']);
    assert.equal(result[0].GamesPlayed, 6);
    assert.equal('championships' in players[0], false);
    assert.equal(store.withChampionships([players[0]])[0].championships.length, 2);
    f.db.prepare('UPDATE LeagueSeasons SET ChampionTeamId = 200 WHERE SeasonId = 10').run();
    assert.deepEqual(store.withChampionships(players).map(player => player.championships.length), [1, 0, 0]);
  } finally { f.db.close(); }
});

test('profile award API validates player IDs and serves empty collections without requiring login', async () => {
  const calls = [];
  const app = express();
  app.use('/api', createPlayerAwardsRouter(id => { calls.push(id); return { awards: [] }; },
    () => ({ awards: [], criteria: { allTimeHeroGames: 10, playerGames: 20 } })));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/player`;
  try {
    for (const id of ['0', '-1', 'abc', '123abc', '1.5', '9007199254740992']) {
      assert.equal((await fetch(`${base}/${id}/awards`)).status, 400);
    }
    const response = await fetch(`${base}/49219700/awards`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { awards: [] });
    assert.deepEqual(calls, [49219700]);
    const catalog = await fetch(`http://127.0.0.1:${server.address().port}/api/awards`);
    assert.equal(catalog.status, 200);
    assert.deepEqual(await catalog.json(), { awards: [], criteria: { allTimeHeroGames: 10, playerGames: 20 } });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('awards catalog groups all holders, agrees with profiles, and refreshes after corrections', () => {
  const f = fixture();
  try {
    f.db.exec(`CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY, PlayerName TEXT);
      INSERT INTO PlayerInfo VALUES (1,'Zulu'),(2,'Alpha'),(3,'Rookie');
      INSERT INTO TeamInfo VALUES (100,'Winners');`);
    f.league(10); f.games(10,1,10,8); f.games(10,2,10,8); f.games(10,3,1,1,2);
    f.league(20,'ended',100); const final=f.game(20); f.appearance(final,1); f.appearance(final,2);
    const store=new PlayerAwardsStore(f.db), catalog=store.catalog();
    const specialist=catalog.awards.find(a=>a.type==='hero_specialist'&&a.heroId===1);
    assert.equal(specialist.shared,true);
    assert.deepEqual(specialist.holders.map(p=>p.name),['Alpha','Zulu']);
    assert.deepEqual(specialist.holders.map(p=>p.games),[11,11]);
    assert.equal(catalog.awards.some(a=>a.type==='hero_specialist'&&a.heroId===2),false);
    assert.equal(catalog.awards.find(a=>a.type==='hero_loyalist'&&a.heroId===2).holders[0].playerId,3);
    const champion=catalog.awards.find(a=>a.type==='champion');
    assert.equal(champion.leagueId,20);assert.equal(champion.teamName,'Winners');
    assert.deepEqual(champion.holders.map(p=>p.playerId),[2,1]);
    assert.equal(champion.shared,false); // Teammates are not tied record holders.
    for(const a of store.forPlayer(1).awards){
      const group=catalog.awards.find(g=>g.id===a.id), holder=group.holders.find(p=>p.playerId===1);
      assert.equal(holder.games,a.games);assert.equal(holder.winRate,a.winRate);
    }
    assert.equal(store.catalog().awards,catalog.awards);
    f.db.exec(`UPDATE MatchTeam SET WinnerId=100 WHERE MatchId=(SELECT MIN(p.MatchId) FROM MatchPlayer p
      JOIN MatchTeam m ON m.MatchId=p.MatchId WHERE p.PlayerId=1 AND m.WinnerId=200)`);
    const revised=store.catalog().awards.find(a=>a.type==='hero_specialist'&&a.heroId===1);
    assert.equal(revised.shared,false);assert.deepEqual(revised.holders.map(p=>p.playerId),[1]);
    f.db.exec("UPDATE PlayerInfo SET PlayerName='Updated name' WHERE PlayerId=1");
    assert.equal(store.catalog().awards.find(a=>a.type==='hero_specialist'&&a.heroId===1).holders[0].name,'Updated name');
  } finally { f.db.close(); }
});

test('league record placements include three distinct results, preserve exact ties and apply eligibility', () => {
  const f = fixture();
  try {
    f.db.exec('CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY, PlayerName TEXT)');
    for (let id = 1; id <= 7; id++) f.db.prepare('INSERT INTO PlayerInfo VALUES (?, ?)').run(id, `Player ${id}`);
    f.league(10);
    for (const [id, games, wins] of [[1,20,18],[2,40,36],[3,20,16],[4,30,24],[5,20,14],[6,25,15],[7,19,19]]) f.games(10,id,games,wins);
    const store = new PlayerAwardsStore(f.db), awards = store.catalog().awards;
    const winningest = awards.find(a => a.type === 'winningest');
    assert.deepEqual(winningest.placements.map(p => ({ place:p.place, ids:p.holders.map(h => h.playerId) })), [
      {place:1,ids:[1,2]}, {place:2,ids:[3,4]}, {place:3,ids:[5]},
    ]);
    assert.deepEqual(winningest.holders.map(p => p.playerId), [1,2]);
    assert.equal(winningest.placements[1].holders[0].winRate, 80);
    assert.equal(store.forPlayer(3).awards.some(a => a.type === 'winningest'), false);
    assert.equal(store.forPlayer(7).awards.some(a => a.type === 'winningest'), false);
    const veteran = awards.find(a => a.type === 'veteran');
    assert.deepEqual(veteran.placements.map(p => p.holders.map(h => h.playerId)), [[2],[4],[6]]);
    assert.equal(awards.filter(a => a.heroId).some(a => a.placements), false);
  } finally { f.db.close(); }
});
