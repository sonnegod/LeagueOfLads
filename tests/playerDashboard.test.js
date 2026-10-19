import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {getPlayerDashboard,changePlayerDisplayName,nextNameChangeAt} from '../config/playerDashboard.js';

function fixture() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT,LastDateChanged TEXT);
    CREATE TABLE MatchPlayer(MatchId INTEGER,PlayerId INTEGER,HeroId INTEGER,Winner INTEGER,Kills INTEGER,Deaths INTEGER,Assists INTEGER,GPM INTEGER,XPM INTEGER);
    CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER,DatePlayed TEXT);
    CREATE TABLE LeagueInfo(LeagueId INTEGER PRIMARY KEY,LeagueName TEXT,Active INTEGER);
    CREATE TABLE HeroInfo(HeroId INTEGER PRIMARY KEY,HeroName TEXT);
    CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,StartTimeUtc INTEGER);
    CREATE TABLE TeamRosterPlayers(TeamSubmissionId INTEGER,PlayerId INTEGER,Slot INTEGER);
    CREATE TABLE SeasonTeams(TeamSubmissionId INTEGER PRIMARY KEY,ExternalTeamId INTEGER,TeamName TEXT,SeasonId INTEGER);
    CREATE TABLE LeagueSeasons(SeasonId INTEGER PRIMARY KEY,ExternalLeagueId INTEGER,Status TEXT);
    CREATE TABLE LeagueRosterEntries(TeamSubmissionId INTEGER,LeagueId INTEGER,DisplayName TEXT);
    INSERT INTO PlayerInfo VALUES(1,'League Player',NULL),(2,'Other player','2026-10-01T00:00:00Z');
    INSERT INTO LeagueInfo VALUES(100,'Past season',0),(200,'Current season',1);
    INSERT INTO HeroInfo VALUES(1,'Hero One'),(2,'Hero Two');
    INSERT INTO LeagueSeasons VALUES(1,200,'active');
    INSERT INTO SeasonTeams VALUES(11,NULL,'Submitted team',1);
    INSERT INTO TeamRosterPlayers VALUES(11,1,0),(11,2,1);
    INSERT INTO LeagueRosterEntries VALUES(11,200,'Published team name');`);
  for(let i=1;i<=15;i++) {
    db.prepare('INSERT INTO MatchPlayer VALUES(?,1,?,?,?,?,?,?,?)').run(i,i<=10?1:2,i<=9?1:0,10,2,8,500,600);
    db.prepare('INSERT INTO MatchTeam VALUES(?,NULL)').run(i);
    db.prepare('INSERT INTO MatchLeague VALUES(?,?,?)').run(i,i<=10?100:200,'2026-10-01');
  }
  db.exec(`INSERT INTO MatchPlayer SELECT * FROM MatchPlayer WHERE MatchId=15;
    INSERT INTO MatchLeague SELECT * FROM MatchLeague WHERE MatchId=15;
    INSERT INTO MatchPlayer VALUES(999,1,1,1,99,0,99,999,999);
    INSERT INTO MatchPlayer VALUES(1,2,1,1,99,0,99,999,999);`);
  return db;
}

test('six recent games deduplicate raw rows, exclude orphans and keep the season record separate',()=>{
  const db=fixture();try {
    const data=getPlayerDashboard(db,1);
    assert.deepEqual(data.seasonSummary,{games:5,wins:0,losses:5,unknown:0});
    assert.deepEqual(data.recentMatches.map(m=>m.MatchId),[15,14,13,12,11,10]);
    assert.deepEqual(data.teams,[{TeamSubmissionId:11,TeamId:null,TeamName:'Published team name',
      players:[{PlayerId:1,PlayerName:'League Player'},{PlayerId:2,PlayerName:'Other player'}]}]);
    assert.deepEqual(data.heroForm.seasons.map(s=>s.LeagueId),[200,100]);
    assert.deepEqual(data.heroForm.heroes,[{HeroId:1,HeroName:'Hero One',games:10,wins:9,losses:1,winRate:90,kda:9}]);
    assert.equal('playerStats' in data,false);assert.equal(data.player.nextNameChangeAt,null);
  }finally{db.close();}
});

test('players without games and offseason dashboards keep truthful empty stats',()=>{
  const db=fixture();try {
    db.exec("UPDATE LeagueInfo SET Active=0;UPDATE LeagueSeasons SET Status='ended';DELETE FROM MatchPlayer");
    const data=getPlayerDashboard(db,1);
    assert.equal(data.currentLeague,null);assert.equal(data.seasonSummary,null);
    assert.deepEqual(data.recentMatches,[]);assert.deepEqual(data.teams,[]);
    assert.deepEqual(data.heroForm,{seasons:[],heroes:[]});
    const unknown=getPlayerDashboard(db,123);assert.equal(unknown.player,null);assert.deepEqual(unknown.recentMatches,[]);
  }finally{db.close();}
});

test('missing metrics and unknown outcomes stay unknown',()=>{
  const db=fixture();try {
    db.exec('UPDATE MatchPlayer SET Kills=NULL,Winner=NULL,GPM=NULL WHERE PlayerId=1');
    const data=getPlayerDashboard(db,1);
    assert.deepEqual(data.seasonSummary,{games:5,wins:0,losses:0,unknown:5});
    assert.equal(data.recentMatches[0].Kills,null);assert.equal(data.recentMatches[0].GPM,null);
    assert.equal(data.recentMatches[0].Winner,null);
    assert.deepEqual(data.heroForm.heroes,[]);
    db.exec('UPDATE MatchPlayer SET Winner=CASE WHEN MatchId<=9 THEN 1 ELSE 0 END WHERE PlayerId=1 AND HeroId=1');
    assert.equal(getPlayerDashboard(db,1).heroForm.heroes[0].kda,null);
    db.exec('UPDATE MatchPlayer SET Kills=0,Deaths=0,Assists=0 WHERE PlayerId=1 AND HeroId=1');
    assert.equal(getPlayerDashboard(db,1).heroForm.heroes[0].kda,0);
  }finally{db.close();}
});

test('hero form uses the two latest played seasons, a five-result minimum, winning records and a three-hero limit',()=>{
  const db=fixture();try {
    db.exec(`INSERT INTO LeagueInfo VALUES(50,'Too old',0),(300,'Upcoming empty season',0);
      INSERT INTO HeroInfo VALUES(3,'Old winning hero'),(4,'Small sample'),(5,'Winning hero'),
        (6,'Stronger winning hero'),(7,'Unknown outcomes'),(8,'Even record'),(9,'Losing hero'),(10,'Larger sample');`);
    let id=1000;
    const addGames=(hero,league,winners)=>{for(const winner of winners){id++;
      db.prepare('INSERT INTO MatchPlayer VALUES(?,1,?,?,10,2,8,500,600)').run(id,hero,winner);
      db.prepare('INSERT INTO MatchTeam VALUES(?,NULL)').run(id);
      db.prepare('INSERT INTO MatchLeague VALUES(?,?,NULL)').run(id,league);
    }};
    addGames(3,50,[1,1,1,1,1,1]);addGames(4,200,[1,1,1,1]);
    addGames(5,200,[1,1,1,0,0]);addGames(6,200,[1,1,1,1,0]);
    addGames(7,200,[1,1,1,1,null,null,null]);addGames(8,200,[1,1,1,0,0,0]);
    addGames(9,200,[1,1,0,0,0]);addGames(10,200,[1,1,1,1,1,1,0,0,0,0]);
    const data=getPlayerDashboard(db,1);
    assert.deepEqual(data.heroForm.seasons.map(s=>s.LeagueId),[200,100]);
    assert.deepEqual(data.heroForm.heroes.map(h=>h.HeroId),[1,6,10]);
    assert.equal(data.heroForm.heroes[2].games,10);assert.equal(data.heroForm.heroes[2].winRate,60);
    assert.deepEqual(getPlayerDashboard(db,999).heroForm.heroes,[]);
    // A player who last played three seasons ago does not get stale highlights.
    addGames(3,50,[1,1,1,1,1]);db.exec('UPDATE MatchPlayer SET PlayerId=2 WHERE MatchId>1000 AND HeroId=3');
    assert.deepEqual(getPlayerDashboard(db,2).heroForm.heroes,[]);
    addGames(4,300,[1]);
    assert.deepEqual(getPlayerDashboard(db,1).heroForm.seasons.map(s=>s.LeagueId),[300,200]);
    assert.equal(getPlayerDashboard(db,1).heroForm.heroes.some(h=>h.HeroId===1),false);
  }finally{db.close();}
});

test('a first name change works, respects a precise 30-day cooldown and leaves other accounts untouched',()=>{
  const db=fixture();try {
    const now=new Date('2026-10-19T12:00:00Z');
    const result=changePlayerDisplayName(db,1,'  New League Name  ',now);
    assert.equal(result.success,true);assert.equal(result.name,'New League Name');
    assert.equal(result.nextNameChangeAt,'2026-11-18T12:00:00.000Z');
    assert.equal(db.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=2').get().PlayerName,'Other player');
    assert.equal(changePlayerDisplayName(db,1,'Too soon',new Date('2026-11-18T11:59:59Z')).success,false);
    assert.equal(changePlayerDisplayName(db,1,'Available now',new Date(result.nextNameChangeAt)).success,true);
    assert.equal(nextNameChangeAt(null),null);assert.equal(nextNameChangeAt('bad date'),null);
    for(const name of ['',{},'x'.repeat(41)])assert.equal(changePlayerDisplayName(db,1,name,now).status,400);
    assert.equal(changePlayerDisplayName(db,999,'Unknown player',now).status,404);
  }finally{db.close();}
});
