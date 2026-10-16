import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import PlayerAwardsStore from '../config/playerAwards.js';
import { createPlayerAwardsRouter } from '../routes/playerAwardsRoutes.js';

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

test('hero awards are all-time only, require 15 games, share exact ties, and ignore duplicate/conflicting results', () => {
  const f = fixture();
  try {
    f.league(10);
    f.games(10, 1, 15, 12);
    f.games(10, 2, 30, 24);
    f.games(10, 3, 14, 14); // Unbeaten, but below the minimum.
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
    assert.equal(specialist.games, 15);
    assert.equal(specialist.wins, 12);
    assert.equal(specialist.winRate, 80);
    assert.equal(specialist.shared, true);
    assert.equal(specialist.tiedPlayers, 2);
    assert.equal(specialist.provisional, false);
    assert.equal(specialist.minimumGames, 15);
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

test('all-time records combine seasons, apply 15-game thresholds, and issue no seasonal stat awards', () => {
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
    assert.equal(veteran.minimumGames, 15);
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
    assert.equal(three.find(a => a.type === 'winningest' && a.scope === 'all-time').winRate, 100);
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

test('profile award API validates player IDs and serves empty collections without requiring login', async () => {
  const calls = [];
  const app = express();
  app.use('/api', createPlayerAwardsRouter(id => { calls.push(id); return { awards: [] }; }));
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
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
