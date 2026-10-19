import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {leagueGroupBoardRevision,saveLeagueGroupBoard,groupTeamKey} from '../config/leagueGroupBoard.js';
import {createLeagueGroupBoardRouter} from '../routes/leagueGroupBoardRoutes.js';

function fixture() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE LeagueInfo(LeagueId INTEGER PRIMARY KEY,LeagueName TEXT,Active INTEGER);
    CREATE TABLE GroupNames(LeagueId INTEGER,GroupId INTEGER,GroupName TEXT,PRIMARY KEY(LeagueId,GroupId));
    CREATE TABLE LeagueRosterEntries(EntryId INTEGER PRIMARY KEY AUTOINCREMENT,LeagueId INTEGER,GroupId INTEGER NOT NULL,
      DisplayName TEXT,TeamId INTEGER,TeamSubmissionId INTEGER,SortOrder INTEGER,UNIQUE(LeagueId,TeamId));
    CREATE UNIQUE INDEX group_team_name ON LeagueRosterEntries(LeagueId,GroupId,DisplayName COLLATE NOCASE);
    CREATE TABLE LeagueGroups(LeagueId INTEGER,TeamId INTEGER,GroupId INTEGER,PRIMARY KEY(LeagueId,TeamId));
    CREATE TABLE LeagueTeamNames(LeagueId INTEGER,TeamId INTEGER,DisplayName TEXT,PRIMARY KEY(LeagueId,TeamId));
    CREATE TABLE LeagueSeasons(SeasonId INTEGER PRIMARY KEY,ExternalLeagueId INTEGER,Status TEXT);
    CREATE TABLE SeasonGroups(GroupId INTEGER PRIMARY KEY AUTOINCREMENT,SeasonId INTEGER,GroupName TEXT COLLATE NOCASE,SortOrder INTEGER,UNIQUE(SeasonId,GroupName));
    CREATE TABLE SeasonTeams(TeamSubmissionId INTEGER PRIMARY KEY,SeasonId INTEGER,GroupId INTEGER,TeamName TEXT,ExternalTeamId INTEGER,UpdatedAt TEXT);
    CREATE TABLE SeasonTeamPlayers(TeamSubmissionId INTEGER,PlayerId INTEGER,MMR INTEGER);
    CREATE TABLE TeamRosterPlayers(TeamSubmissionId INTEGER,PlayerId INTEGER);
    CREATE TABLE TeamInfo(TeamId INTEGER PRIMARY KEY,TeamName TEXT);
    CREATE TABLE GroupResultOverrides(LeagueId INTEGER,GroupId INTEGER,TeamA INTEGER,TeamB INTEGER);
    CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER);
    CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER);
    CREATE TABLE Actions(Message TEXT);
    INSERT INTO LeagueInfo VALUES(100,'Current season',1),(200,'Other season',0);
    INSERT INTO LeagueSeasons VALUES(1,100,'active'),(2,200,'ended');
    INSERT INTO SeasonGroups VALUES(11,1,'A',1),(12,1,'B',2),(21,2,'Historical',1);
    INSERT INTO GroupNames VALUES(100,1,'A'),(100,2,'B'),(200,1,'Historical');
    INSERT INTO SeasonTeams VALUES(1,1,11,'Alpha',100,'before'),(2,1,12,'Beta',NULL,'before');
    INSERT INTO SeasonTeamPlayers VALUES(1,1,6000),(2,2,6500);INSERT INTO TeamRosterPlayers VALUES(1,1),(2,2);
    INSERT INTO LeagueRosterEntries VALUES(10,100,1,'Alpha',100,1,1),(20,100,2,'Beta',NULL,2,1),(90,200,1,'Historical team',900,NULL,1);
    INSERT INTO LeagueGroups VALUES(100,100,1),(100,300,1),(200,900,1);
    INSERT INTO LeagueTeamNames VALUES(100,100,'Alpha');
    INSERT INTO TeamInfo VALUES(100,'Dota name'),(300,'Legacy team'),(400,'Available team'),(500,'Another available team');
    INSERT INTO GroupResultOverrides VALUES(100,1,100,300);
    INSERT INTO MatchTeam VALUES(1,100,300,100),(2,400,500,400);INSERT INTO MatchLeague VALUES(1,100),(2,100);`);
  const getActiveLeague=()=>db.prepare('SELECT * FROM LeagueInfo WHERE Active=1 ORDER BY LeagueId DESC LIMIT 1').get();
  const getGroups=leagueId=>db.prepare('SELECT * FROM GroupNames WHERE LeagueId=? ORDER BY GroupId').all(leagueId).map(g=>({...g,
    teams:[...db.prepare('SELECT EntryId,TeamId,TeamSubmissionId,DisplayName TeamName,0 Wins FROM LeagueRosterEntries WHERE LeagueId=? AND GroupId=? ORDER BY SortOrder,EntryId').all(leagueId,g.GroupId),
      ...db.prepare(`SELECT lg.TeamId,t.TeamName,0 Wins FROM LeagueGroups lg LEFT JOIN TeamInfo t USING(TeamId)
        WHERE lg.LeagueId=? AND lg.GroupId=? AND NOT EXISTS(SELECT 1 FROM LeagueRosterEntries e WHERE e.LeagueId=lg.LeagueId AND e.TeamId=lg.TeamId)`).all(leagueId,g.GroupId)]}));
  const getAvailableTeams=leagueId=>db.prepare(`SELECT t.* FROM TeamInfo t WHERE t.TeamId IN(
    SELECT m.TeamRad FROM MatchTeam m JOIN MatchLeague l USING(MatchId) WHERE l.LeagueId=?
    UNION SELECT m.TeamDire FROM MatchTeam m JOIN MatchLeague l USING(MatchId) WHERE l.LeagueId=?)
    AND NOT EXISTS(SELECT 1 FROM LeagueGroups g WHERE g.LeagueId=? AND g.TeamId=t.TeamId)
    AND NOT EXISTS(SELECT 1 FROM LeagueRosterEntries e WHERE e.LeagueId=? AND e.TeamId=t.TeamId) ORDER BY t.TeamId`).all(leagueId,leagueId,leagueId,leagueId);
  const getUnregisteredTeams=leagueId=>db.prepare(`SELECT t.TeamSubmissionId,t.TeamName,t.ExternalTeamId AS TeamId,1 AS HasRoster
    FROM SeasonTeams t JOIN LeagueSeasons s ON s.SeasonId=t.SeasonId WHERE s.ExternalLeagueId=? AND s.Status='active' AND t.GroupId IS NULL
      AND NOT EXISTS(SELECT 1 FROM LeagueRosterEntries e WHERE e.LeagueId=? AND e.TeamSubmissionId=t.TeamSubmissionId)`).all(leagueId,leagueId);
  const readBoard=()=>{const league=getActiveLeague()||null;const board={league,groups:league?getGroups(league.LeagueId):[],availableTeams:league?getAvailableTeams(league.LeagueId):[],unregisteredTeams:league?getUnregisteredTeams(league.LeagueId):[]};
    return {...board,revision:leagueGroupBoardRevision(board)};};
  const options={readBoard,rebuild:()=>db.prepare('INSERT INTO Actions VALUES(?)').run('rebuild'),audit:(_type,message)=>db.prepare('INSERT INTO Actions VALUES(?)').run(message)};
  return {db,readBoard,options,routerOptions:{db,getActiveLeague,getGroups,getAvailableTeams,getUnregisteredTeams,rebuild:options.rebuild,audit:options.audit},close:()=>db.close()};
}
function draft(board) {return {leagueId:board.league.LeagueId,revision:board.revision,groups:board.groups.map(g=>({id:g.GroupId,name:g.GroupName})),
  teams:[...board.groups.flatMap(g=>g.teams.map(t=>({key:groupTeamKey(t),name:t.TeamName,teamId:t.TeamId??null,groupId:g.GroupId}))),
    ...board.availableTeams.map(t=>({key:groupTeamKey(t),name:t.TeamName,teamId:t.TeamId,groupId:null})),
    ...(board.unregisteredTeams||[]).map(t=>({key:`submission:${t.TeamSubmissionId}`,name:t.TeamName,teamId:t.TeamId,groupId:null}))]};}
const originalRows=db=>JSON.stringify(['MatchTeam','MatchLeague','SeasonTeamPlayers','TeamRosterPlayers'].map(t=>db.prepare(`SELECT * FROM ${t}`).all()));

test('one save moves signup and legacy teams, synchronizes season groups and preserves raw matches and rosters',()=>{
  const f=fixture();try {
    const before=originalRows(f.db),input=draft(f.readBoard());
    input.teams.find(t=>t.key==='entry:10').groupId=2;input.teams.find(t=>t.key==='team:300').groupId=2;
    saveLeagueGroupBoard(f.db,input,f.options);
    assert.equal(f.db.prepare('SELECT GroupId FROM LeagueRosterEntries WHERE EntryId=10').get().GroupId,2);
    assert.equal(f.db.prepare('SELECT GroupId FROM LeagueGroups WHERE LeagueId=100 AND TeamId=100').get().GroupId,2);
    assert.equal(f.db.prepare('SELECT GroupId FROM LeagueGroups WHERE LeagueId=100 AND TeamId=300').get().GroupId,2);
    assert.equal(f.db.prepare('SELECT GroupId FROM SeasonTeams WHERE TeamSubmissionId=1').get().GroupId,12);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM GroupResultOverrides').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM Actions').get().n,2,'one rebuild and one audit');
    assert.equal(originalRows(f.db),before);
    assert.equal(f.db.prepare('SELECT DisplayName FROM LeagueRosterEntries WHERE EntryId=90').get().DisplayName,'Historical team');
  }finally{f.close();}
});

test('new groups, named teams and team-ID links save together with public/season group alignment',()=>{
  const f=fixture();try {
    const input=draft(f.readBoard());input.groups.push({id:'new-group:c',name:'C'});
    Object.assign(input.teams.find(t=>t.key==='entry:20'),{groupId:'new-group:c',teamId:400,name:'Renamed Beta'});
    input.teams.push({key:'new-team:manual',name:'Named manual team',teamId:null,groupId:'new-group:c'});
    saveLeagueGroupBoard(f.db,input,f.options);
    const group=f.db.prepare("SELECT * FROM GroupNames WHERE LeagueId=100 AND GroupName='C'").get();assert.equal(group.GroupId,3);
    const seasonGroup=f.db.prepare("SELECT * FROM SeasonGroups WHERE SeasonId=1 AND GroupName='C'").get();assert.equal(seasonGroup.SortOrder,3);
    const team=f.db.prepare('SELECT * FROM SeasonTeams WHERE TeamSubmissionId=2').get();
    assert.equal(team.GroupId,seasonGroup.GroupId);assert.equal(team.ExternalTeamId,400);assert.equal(team.TeamName,'Renamed Beta');
    assert.equal(f.db.prepare('SELECT GroupId FROM LeagueGroups WHERE LeagueId=100 AND TeamId=400').get().GroupId,3);
    assert.equal(f.readBoard().availableTeams.some(t=>t.TeamId===400),false);
    assert.equal(f.db.prepare("SELECT DisplayName FROM LeagueRosterEntries WHERE TeamId IS NULL AND DisplayName='Named manual team'").get().DisplayName,'Named manual team');
  }finally{f.close();}
});

test('group names can swap atomically without violating the season uniqueness constraint',()=>{
  const f=fixture();try {
    const input=draft(f.readBoard());input.groups[0].name='B';input.groups[1].name='A';
    saveLeagueGroupBoard(f.db,input,f.options);
    assert.equal(f.db.prepare('SELECT GroupName FROM SeasonGroups WHERE GroupId=11').get().GroupName,'B');
    assert.equal(f.db.prepare('SELECT GroupName FROM SeasonGroups WHERE GroupId=12').get().GroupName,'A');
  }finally{f.close();}
});

test('unregistered roster teams stay pending until a group save publishes and links their existing identity',()=>{
  const f=fixture();try {
    const old=draft(f.readBoard());
    f.db.exec("INSERT INTO SeasonTeams VALUES(3,1,NULL,'New roster',NULL,'created'); INSERT INTO SeasonTeamPlayers VALUES(3,9,6000); INSERT INTO TeamRosterPlayers VALUES(3,9)");
    assert.throws(()=>saveLeagueGroupBoard(f.db,old,f.options),e=>e.status===409,'newly created teams invalidate older drafts');
    let input=draft(f.readBoard());input.groups[0].name='Renamed A';
    saveLeagueGroupBoard(f.db,input,f.options);
    assert.equal(f.readBoard().unregisteredTeams.length,1,'other group edits do not force all pending teams into groups');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM LeagueRosterEntries WHERE TeamSubmissionId=3').get().n,0);
    input=draft(f.readBoard());
    Object.assign(input.teams.find(t=>t.key==='submission:3'),{groupId:2,teamId:400});
    const original=originalRows(f.db);saveLeagueGroupBoard(f.db,input,f.options);
    const entry=f.db.prepare('SELECT * FROM LeagueRosterEntries WHERE TeamSubmissionId=3').get();
    assert.equal(entry.LeagueId,100);assert.equal(entry.GroupId,2);assert.equal(entry.TeamId,400);
    assert.equal(f.db.prepare('SELECT GroupId FROM SeasonTeams WHERE TeamSubmissionId=3').get().GroupId,12);
    assert.equal(f.db.prepare('SELECT ExternalTeamId FROM SeasonTeams WHERE TeamSubmissionId=3').get().ExternalTeamId,400);
    assert.equal(f.db.prepare('SELECT GroupId FROM LeagueGroups WHERE LeagueId=100 AND TeamId=400').get().GroupId,2);
    assert.equal(f.readBoard().unregisteredTeams.length,0);assert.equal(originalRows(f.db),original);
  }finally{f.close();}
});

test('pending-team publication rolls back with a failed save and cannot claim an ID without a group',()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO SeasonTeams VALUES(3,1,NULL,'Pending',NULL,'created')");
    let input=draft(f.readBoard());input.teams.find(t=>t.key==='submission:3').teamId=400;
    assert.throws(()=>saveLeagueGroupBoard(f.db,input,f.options),/before linking/);
    input=draft(f.readBoard());input.teams.find(t=>t.key==='submission:3').groupId=2;
    assert.throws(()=>saveLeagueGroupBoard(f.db,input,{...f.options,audit:()=>{throw Error('Failed audit');}}),/Failed audit/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM LeagueRosterEntries WHERE TeamSubmissionId=3').get().n,0);
    assert.equal(f.db.prepare('SELECT GroupId FROM SeasonTeams WHERE TeamSubmissionId=3').get().GroupId,null);
    assert.equal(f.readBoard().unregisteredTeams.length,1);
  }finally{f.close();}
});

test('stale revisions and changed active leagues reject saving without overwriting another admin',()=>{
  const f=fixture();try {
    const input=draft(f.readBoard());f.db.exec("UPDATE GroupNames SET GroupName='Changed by someone else' WHERE LeagueId=100 AND GroupId=1");
    assert.throws(()=>saveLeagueGroupBoard(f.db,input,f.options),e=>e.status===409);
    assert.equal(f.db.prepare('SELECT GroupName FROM GroupNames WHERE LeagueId=100 AND GroupId=1').get().GroupName,'Changed by someone else');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM Actions').get().n,0);
    const current=draft(f.readBoard());f.db.exec('UPDATE LeagueInfo SET Active=CASE WHEN LeagueId=200 THEN 1 ELSE 0 END');
    assert.throws(()=>saveLeagueGroupBoard(f.db,current,f.options),e=>e.status===409);
  }finally{f.close();}
});

test('standings and row presentation order do not invalidate the group revision',()=>{
  const f=fixture();try {
    const board=f.readBoard(),revision=board.revision;
    board.groups.reverse();for(const group of board.groups){group.teams.reverse();for(const team of group.teams){team.Wins=999;team.Score=1234;}}
    assert.equal(leagueGroupBoardRevision(board),revision);
  }finally{f.close();}
});

test('invalid or ambiguous drafts do not write data',()=>{
  for(const mutate of [
    d=>{d.groups[1].name='a';},d=>{d.groups.pop();},d=>{d.teams[0].groupId=999;},
    d=>{d.teams[0].groupId=null;},d=>{d.teams[0].teamId=999;},d=>{d.teams[0].name='Changed linked name';},
    d=>{d.teams=d.teams.filter(t=>t.key!=='entry:10');},d=>{d.teams.push({...d.teams[0]});},
    d=>{d.teams.push({key:'entry:90',name:'Historical team',teamId:900,groupId:1});},
    d=>{d.teams.find(t=>t.key==='team:400').groupId=1;d.teams.find(t=>t.key==='entry:20').teamId=400;},
  ]) {
    const f=fixture();try {
      const before=f.readBoard().revision,input=draft(f.readBoard());mutate(input);
      assert.throws(()=>saveLeagueGroupBoard(f.db,input,f.options));assert.equal(f.readBoard().revision,before);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM Actions').get().n,0);
    }finally{f.close();}
  }
});

test('a failure after writes rolls the complete group save back',()=>{
  const f=fixture();try {
    const before=f.readBoard().revision,input=draft(f.readBoard());input.groups[0].name='Renamed group';input.teams[0].groupId=2;
    assert.throws(()=>saveLeagueGroupBoard(f.db,input,{...f.options,audit:()=>{throw Error('Audit unavailable');}}),/Audit unavailable/);
    assert.equal(f.readBoard().revision,before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM Actions').get().n,0);
    assert.equal(f.db.prepare('SELECT GroupName FROM SeasonGroups WHERE GroupId=11').get().GroupName,'A');
  }finally{f.close();}
});

test('the board API exposes live revisions and returns stale-save conflicts',async()=>{
  const f=fixture(),app=express();app.use(express.json());
  app.use('/api/admin',(req,res,next)=>req.get('x-admin')==='yes'?next():res.status(403).json({error:'Admin access required'}));
  app.use('/api/admin',createLeagueGroupBoardRouter(f.routerOptions));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url=`http://127.0.0.1:${server.address().port}/api/admin/leagueSetup`;
  try {
    assert.equal((await fetch(url)).status,403);
    const response=await fetch(url,{headers:{'x-admin':'yes'}});assert.match(response.headers.get('Cache-Control'),/no-store/);
    const input=draft(await response.json());input.groups[0].name='Saved group';
    const send=()=>fetch(url,{method:'PUT',headers:{'x-admin':'yes','Content-Type':'application/json'},body:JSON.stringify(input)});
    const saved=await send();assert.equal(saved.status,200);assert.equal((await saved.json()).groups[0].GroupName,'Saved group');
    assert.equal((await send()).status,409);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close();}
});

test('player previews are admin-only, scoped to saved current teams, and contain names without MMRs or uploads',async()=>{
  const f=fixture(),app=express(),calls=[];
  f.db.exec("INSERT INTO SeasonTeams VALUES(3,1,NULL,'Unregistered',NULL,'created')");
  app.use('/api/admin',(req,res,next)=>req.get('x-admin')==='yes'?next():res.status(403).end());
  app.use('/api/admin',createLeagueGroupBoardRouter({...f.routerOptions,getRoster:(leagueId,team)=>{
    calls.push([leagueId,team.TeamSubmissionId??team.TeamId]);
    return {players:[{PlayerId:1,PlayerName:Buffer.from('Player One'),MMR:6500,ScreenshotData:'private'}],pendingSlots:[{Slot:4}]};
  }}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url=`http://127.0.0.1:${server.address().port}/api/admin/leagueSetup/players?team=`;
  try {
    assert.equal((await fetch(url+'entry:10')).status,403);
    for(const key of ['entry:10','team:300','team:400','submission:3']) {
      const response=await fetch(url+key,{headers:{'x-admin':'yes'}});assert.equal(response.status,200);
      assert.match(response.headers.get('Cache-Control'),/no-store/);
      assert.deepEqual(await response.json(),{players:[{PlayerId:1,PlayerName:'Player One'},{PlayerId:null,PlayerName:'Player TBD'}]});
    }
    assert.deepEqual(calls,[[100,1],[100,300],[100,400],[100,3]]);
    for(const key of ['entry:90','submission:999','new-team:unsaved'])assert.equal((await fetch(url+key,{headers:{'x-admin':'yes'}})).status,404);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM Actions').get().n,0,'viewing rosters does not save or audit group edits');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close();}
});
