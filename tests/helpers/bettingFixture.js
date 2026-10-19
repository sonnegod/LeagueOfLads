import Database from 'better-sqlite3';
import { BettingStore } from '../../betting/store.js';
import { ScheduleStore } from '../../betting/scheduleStore.js';
import { migrateAnalytics } from '../../analytics/store.js';
const now=new Date('2026-10-13T12:00:00.000Z');

export function engineFixture() {
  const league=new Database(':memory:');const analytics=new Database(':memory:');const betting=new Database(':memory:');migrateAnalytics(analytics);
  league.exec(`CREATE TABLE LeagueSeasons (SeasonId INTEGER PRIMARY KEY,ExternalLeagueId INTEGER,LeagueName TEXT,Status TEXT,ChampionTeamId INTEGER);
    CREATE TABLE SeasonTeams (TeamSubmissionId INTEGER PRIMARY KEY,SeasonId INTEGER,ExternalTeamId INTEGER,TeamName TEXT,GroupId INTEGER,IsManual INTEGER);
    CREATE TABLE SeasonTeamPlayers (TeamSubmissionId INTEGER,PlayerId INTEGER,Slot INTEGER);
    CREATE TABLE SeasonLeagueRules (SeasonId INTEGER,UpperBracketTeams INTEGER,LowerBracketTeams INTEGER,EliminatedTeams INTEGER,HasTiebreaker INTEGER,TiebreakerPosition INTEGER);
    CREATE TABLE SeriesInfo (SeriesId INTEGER PRIMARY KEY,Team1 INTEGER,Team2 INTEGER,LeagueId INTEGER,Stage TEXT);
    CREATE TABLE SeriesMatch (SeriesId INTEGER,MatchId INTEGER);
    INSERT INTO LeagueSeasons VALUES (1,100,'Test league','active',NULL);
    INSERT INTO SeasonTeams VALUES (11,1,1011111,'A',1,0),(12,1,1022222,'B',1,0);
    INSERT INTO SeasonLeagueRules VALUES (1,1,1,0,0,NULL);`);
  const schedules=new ScheduleStore(league);const book=new BettingStore(betting,{now:()=>now});
  analytics.exec(`INSERT INTO AnalyticsRuns (RunId,StartedAtUtc,AsOfUtc,Version,Status) VALUES (1,'2026-10-13T12:00:00.000Z','2026-10-13T12:00:00.000Z',5,'complete');
    UPDATE AnalyticsState SET PublishedRunId=1;
    INSERT INTO SeasonFacts VALUES (1,1,100,'Test league','active','{"UpperBracketTeams":1,"LowerBracketTeams":1,"EliminatedTeams":0,"HasTiebreaker":false}',NULL,NULL);
    INSERT INTO TeamFacts VALUES (1,11,1,1011111,'A',1,0),(1,12,1,1022222,'B',1,0);
    INSERT INTO PrivateTeamFeatures VALUES (1,11,1,6000,5,1,'ready'),(1,12,1,6000,5,1,'ready');
    INSERT INTO TeamSeasonStats VALUES (1,1,11,'regular',50,25,25),(1,1,12,'regular',50,25,25);
    INSERT INTO SourceSnapshots VALUES (1,'match_history','2026-10-13T12:00:00.000Z','2026-10-13T11:00:00.000Z',1,'complete',0),
      (1,'match_details','2026-10-13T12:00:00.000Z','2026-10-13T11:00:00.000Z',1,'complete',0);`);
  for(let p=1;p<=10;p++) {
    const team=p<=5?11:12;analytics.prepare('INSERT INTO PlayerFacts VALUES (1,?,?)').run(p,`Player ${p}`);
    analytics.prepare("INSERT INTO RosterMembership VALUES (1,?,?,?,'2026-09-01T00:00:00.000Z',NULL,0,'finalized')").run(team,p,(p-1)%5);
    league.prepare('INSERT INTO SeasonTeamPlayers VALUES (?,?,?)').run(team,p,(p-1)%5);
  }
  for(let g=1;g<=50;g++) {
    const start=new Date(Date.parse('2026-10-01T00:00:00.000Z')+g*3600000).toISOString();const won=g%2;
    analytics.prepare("INSERT INTO MatchFacts VALUES (1,?,1,100,NULL,'regular',?,?,'api',2000,?,?)").run(g,start,start,won?1011111:1022222,start);
    analytics.prepare("INSERT INTO TeamGameFacts VALUES (1,?,11,12,1011111,?,'radiant')").run(g,won);
    analytics.prepare("INSERT INTO TeamGameFacts VALUES (1,?,12,11,1022222,?,'dire')").run(g,1-won);
    for(let p=1;p<=10;p++)analytics.prepare("INSERT INTO PlayerGameFacts VALUES (1,?,?,?,1,?,'rostered',10,5,15,200,500,600,10000,20000,1000,100)")
      .run(g,p,p<=5?11:12,p<=5?won:1-won);
  }
  return {league,analytics,betting,book,schedules,close(){league.close();analytics.close();betting.close();}};
}

export function preseasonFixture(groupSizes=[4,4]) {
  const f=engineFixture();
  f.league.exec("INSERT INTO LeagueSeasons VALUES(2,200,'Next season','signup_closed',NULL);INSERT INTO SeasonLeagueRules VALUES(2,2,2,0,0,NULL);");
  f.analytics.exec(`INSERT INTO SeasonFacts VALUES(1,2,200,'Next season','signup_closed','{"UpperBracketTeams":2,"LowerBracketTeams":2,"EliminatedTeams":0,"HasTiebreaker":false}',NULL,NULL);`);
  let key=21;
  for(let group=0;group<groupSizes.length;group++)for(let index=0;index<groupSizes[group];index++,key++) {
    f.league.prepare('INSERT INTO SeasonTeams VALUES(?,2,?,?,?,0)').run(key,2000000+key,`Team ${key}`,group+2);
    f.analytics.prepare('INSERT INTO TeamFacts VALUES(1,?,2,?,?,?,0)').run(key,2000000+key,`Team ${key}`,group+2);
    f.analytics.prepare("INSERT INTO PrivateTeamFeatures VALUES(1,?,2,6000,5,1,'ready')").run(key);
    for(let slot=0;slot<5;slot++) {
      const player=key*10+slot;
      f.league.prepare('INSERT INTO SeasonTeamPlayers VALUES(?,?,?)').run(key,player,slot);
      f.analytics.prepare('INSERT INTO PlayerFacts VALUES(1,?,?)').run(player,`Player ${player}`);
      f.analytics.prepare("INSERT INTO RosterMembership VALUES(1,?,?,?,'2026-10-13T01:00:00.000Z',NULL,0,'finalized')").run(key,player,slot);
    }
  }
  f.schedules.finalizeSetup(2,'group_round_robin','1',now);
  f.schedules.save(2,{team1Key:21,team2Key:22,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-17T01:00:00Z'},'1',now);
  return f;
}

