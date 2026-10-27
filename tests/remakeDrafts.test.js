import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ensureRemakeDraftSchema,normalizeRemakeDraft,archiveRemakeDraft,planRemakeDraftLink,linkRemakeDraft,
  linkMatchingRemakeDraft,heldRemakeDrafts,discardHeldRemakeDraft} from '../config/remakeDrafts.js';
import {deleteMatchRecords,cleanupOrphanMatchRecords} from '../config/matchMaintenance.js';
import {createAdminMatchRouter} from '../routes/adminMatchRoutes.js';

function fixture(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY,TeamRad INTEGER,TeamDire INTEGER,WinnerId INTEGER,Rehost INTEGER DEFAULT 0,StartTimeUtc INTEGER,Duration INTEGER);
    CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER,DatePlayed TEXT);
    CREATE TABLE MatchPlayer(MatchId INTEGER,PlayerId INTEGER,HeroId INTEGER);
    CREATE TABLE MatchTeamPlayer(MatchId INTEGER,PlayerId INTEGER,TeamId INTEGER);
    CREATE TABLE PickInfo(MatchId INTEGER,IsPick INTEGER,Hero_Id INTEGER,OrderNum INTEGER,Team INTEGER);
    CREATE TABLE SeriesMatch(MatchId INTEGER,SeriesId INTEGER);
    CREATE TABLE TeamInfo(TeamId INTEGER PRIMARY KEY,TeamName TEXT);
    CREATE TABLE LeagueSeasons(SeasonId INTEGER PRIMARY KEY,ExternalLeagueId INTEGER);
    INSERT INTO TeamInfo VALUES(10,'First'),(20,'Second');INSERT INTO LeagueSeasons VALUES(1,42),(2,43);`);
  ensureRemakeDraftSchema(db);
  const source={match_id:100,leagueid:42,game_mode:2,start_time:1792805000,radiant_team_id:10,dire_team_id:20,radiant_score:0,dire_score:0,
    picks_bans:Array.from({length:24},(_,order)=>({is_pick:order<10,hero_id:order+1,team:order<5?0:order<10?1:order%2,order}))};
  const target={match_id:200,leagueid:42,game_mode:1,start_time:1792805900,radiant_team_id:10,dire_team_id:20,radiant_score:8,dire_score:42,radiant_win:false,
    players:Array.from({length:10},(_,i)=>({account_id:1000+i,hero_id:i+1,player_slot:i<5?i:128+i-5}))};
  const seed=(data=target)=>{
    db.prepare('INSERT INTO MatchTeam VALUES(?,?,?,?,0,?,1800)').run(data.match_id,data.radiant_team_id,data.dire_team_id,data.radiant_win?data.radiant_team_id:data.dire_team_id,data.start_time);
    db.prepare('INSERT INTO MatchLeague VALUES(?,?,?)').run(data.match_id,data.leagueid,new Date(data.start_time*1000).toISOString());
    db.prepare('INSERT INTO SeriesMatch VALUES(?,1)').run(data.match_id);
    for(const p of data.players){
      db.prepare('INSERT INTO MatchPlayer VALUES(?,?,?)').run(data.match_id,p.account_id,p.hero_id);
      db.prepare('INSERT INTO MatchTeamPlayer VALUES(?,?,?)').run(data.match_id,p.account_id,p.player_slot<128?data.radiant_team_id:data.dire_team_id);
    }
  };
  return {db,source,target,seed};
}

test('held sources survive remake deletion and orphan cleanup; linking preserves only one played game and its results',()=>{
  const {db,source,target,seed}=fixture();try{
    seed();
    db.prepare('INSERT INTO MatchTeam VALUES(100,10,20,0,0,?,0)').run(source.start_time);
    db.prepare('INSERT INTO MatchLeague VALUES(100,42,NULL)').run();
    const archived=archiveRemakeDraft(db,{...source,chat:['private'],players:[{mmr:9999}]});
    deleteMatchRecords(db,100);cleanupOrphanMatchRecords(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM RemakeDraftSources').get().n,1);
    assert.equal(db.prepare('SELECT DraftJson FROM RemakeDraftSources').get().DraftJson.includes('private'),false);
    const before=db.prepare('SELECT * FROM MatchTeam').all();
    const result=linkRemakeDraft(db,archived,200,target);
    assert.equal(result.picks,10);assert.equal(result.bans,14);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM PickInfo WHERE MatchId=200').get().n,24);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchPlayer').get().n,10);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM SeriesMatch').get().n,1);
    assert.deepEqual(db.prepare('SELECT * FROM MatchTeam').all(),before);
    assert.deepEqual(heldRemakeDrafts(db,42),[]);
    assert.equal(linkRemakeDraft(db,archived,200,target).alreadyLinked,true);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM PickInfo').get().n,24);
    deleteMatchRecords(db,200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchDraftSources').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM RemakeDraftSources').get().n,1);
  }finally{db.close();}
});

test('exact team hero sets allow stand-ins and hero swaps, including Radiant/Dire reversal',()=>{
  const {db,source,target,seed}=fixture();try{
    [target.players[0].hero_id,target.players[1].hero_id]=[target.players[1].hero_id,target.players[0].hero_id];
    target.players[9].account_id=7777;
    [target.radiant_team_id,target.dire_team_id]=[target.dire_team_id,target.radiant_team_id];
    for(const p of target.players)p.player_slot=p.player_slot<128?p.player_slot+128:p.player_slot-128;
    seed();const result=linkRemakeDraft(db,normalizeRemakeDraft(source),200,target);
    assert.equal(result.sideSwapped,true);
    assert.equal(db.prepare('SELECT Team FROM PickInfo WHERE Hero_Id=1').get().Team,1);
    assert.equal(db.prepare('SELECT Team FROM PickInfo WHERE Hero_Id=24').get().Team,1-source.picks_bans[23].team);
  }finally{db.close();}
});

test('wrong heroes, teams, league, clock window, existing drafts and reused sources are rejected',()=>{
  for(const mutate of [
    f=>{f.target.players[0].hero_id=99;},f=>{f.target.radiant_team_id=30;},
    f=>{f.target.leagueid=43;},f=>{f.target.start_time=f.source.start_time+7201;},
    f=>{f.target.start_time=f.source.start_time;},f=>{f.target.players[0].account_id=null;},
    f=>{f.db.exec('UPDATE MatchTeam SET Rehost=1');},
    f=>{f.db.exec('INSERT INTO PickInfo VALUES(200,0,90,0,0)');},
  ]){
    const f=fixture();try{f.seed();mutate(f);assert.throws(()=>linkRemakeDraft(f.db,normalizeRemakeDraft(f.source),200,f.target));
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchDraftSources').get().n,0);
    }finally{f.db.close();}
  }
  const f=fixture();try{
    f.seed();const source=normalizeRemakeDraft(f.source);linkRemakeDraft(f.db,source,200,f.target);
    const next={...f.target,match_id:201};f.seed(next);
    assert.throws(()=>linkRemakeDraft(f.db,source,201,next),/already linked/);
  }finally{f.db.close();}
});

test('automatic linking waits on ambiguous sources and native draft data is never replaced',()=>{
  const {db,source,target,seed}=fixture();try{
    seed();archiveRemakeDraft(db,source);
    assert.equal(heldRemakeDrafts(db,42)[0].candidates[0].matchId,200);
    archiveRemakeDraft(db,{...source,match_id:101,start_time:source.start_time+30});
    assert.deepEqual(linkMatchingRemakeDraft(db,200,target),{status:'ambiguous',candidates:2});
    assert.equal(discardHeldRemakeDraft(db,101),1);
    assert.equal(archiveRemakeDraft(db,{...source,match_id:101,start_time:source.start_time+30}),null);
    assert.equal(db.prepare('SELECT DraftJson FROM RemakeDraftSources WHERE SourceMatchId=101').get().DraftJson,'[]');
    assert.equal(linkMatchingRemakeDraft(db,200,target).status,'linked');
    assert.equal(discardHeldRemakeDraft(db,100),0);
    assert.equal(linkMatchingRemakeDraft(db,200,target).status,'draft_present');
  }finally{db.close();}
});

test('invalid/incomplete draft responses are rejected and a failed link rolls back all inserted data',()=>{
  const {db,source,target,seed}=fixture();try{
    for(const data of [{...source,game_mode:1},{...source,radiant_score:1},{...source,picks_bans:source.picks_bans.slice(1)},
      {...source,picks_bans:source.picks_bans.map((row,i)=>({...row,hero_id:i===23?1:row.hero_id}))}])assert.throws(()=>normalizeRemakeDraft(data));
    seed();db.exec("CREATE TRIGGER reject_link BEFORE INSERT ON MatchDraftSources BEGIN SELECT RAISE(ABORT,'test failure'); END");
    assert.throws(()=>linkRemakeDraft(db,normalizeRemakeDraft(source),200,target),/test failure/);
    for(const table of ['PickInfo','MatchDraftSources','RemakeDraftSources'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  }finally{db.close();}
});

test('an unfinished draft is held for review and deletion but cannot be attached or matched automatically',()=>{
  const {db,source,target,seed}=fixture();try{
    seed();const incomplete={...source,picks_bans:source.picks_bans.slice(0,4)};
    const held=archiveRemakeDraft(db,incomplete);
    assert.equal(heldRemakeDrafts(db,42).length,1);
    assert.deepEqual(heldRemakeDrafts(db,42)[0].candidates,[]);
    assert.throws(()=>linkRemakeDraft(db,held,200,target),/incomplete/);
    assert.equal(linkMatchingRemakeDraft(db,200,target).status,'no_match');
    assert.equal(discardHeldRemakeDraft(db,100),1);
  }finally{db.close();}
});

test('explicit repair command previews without writes, applies idempotently and retains source provenance',async()=>{
  const f=fixture(),directory=mkdtempSync(join(tmpdir(),'lads-remake-'));
  try{
    f.seed();const path=join(directory,'LadsData.db');await f.db.backup(path);
    const sourcePath=join(directory,'source.json'),targetPath=join(directory,'target.json');
    writeFileSync(sourcePath,JSON.stringify(f.source));writeFileSync(targetPath,JSON.stringify(f.target));
    const args=['scripts/db/linkRemakeDraft.js',path,'--draft-match-id','100','--match-id','200','--draft-json',sourcePath,'--match-json',targetPath];
    assert.match(execFileSync(process.execPath,args,{encoding:'utf8'}),/"mode": "preview"/);
    let db=new Database(path,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM PickInfo').get().n,0);db.close();
    assert.match(execFileSync(process.execPath,[...args,'--apply'],{encoding:'utf8'}),/"bans": 14/);
    assert.match(execFileSync(process.execPath,[...args,'--apply'],{encoding:'utf8'}),/"alreadyLinked": true/);
    db=new Database(path,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM PickInfo').get().n,24);db.close();
  }finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
});

test('admin held-draft import/link/delete enforce access, exact matching, season scope and audit rollback',async()=>{
  const f=fixture(),audits=[];let server,failAudit=false;
  try{
    f.seed();const app=express();app.use(express.json());
    app.use('/matches',(req,res,next)=>{if(!req.get('x-admin'))return res.sendStatus(401);if(req.get('x-admin')!=='yes')return res.sendStatus(403);next();},
      createAdminMatchRouter({league:f.db,schedules:{audit:(type,message)=>{if(failAudit)throw Error('audit failed');audits.push({type,message});}},
        loadDraft:async id=>({...f.source,match_id:id})}));
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const call=(path,method='GET',body,admin='yes')=>fetch(`http://127.0.0.1:${server.address().port}/matches${path}`,{
      method,headers:{...(admin?{'x-admin':admin}:{}),'Content-Type':'application/json',Connection:'close'},...(body?{body:JSON.stringify(body)}:{})});
    for(const [path,method] of [['/held-drafts?seasonId=1','GET'],['/held-drafts/import','POST'],['/held-drafts/100/link','POST'],['/held-drafts/100','DELETE']]){
      assert.equal((await call(path,method,method==='GET'?null:{},null)).status,401);assert.equal((await call(path,method,method==='GET'?null:{},'no')).status,403);
    }
    assert.equal((await call('/held-drafts?seasonId=bad')).status,400);
    assert.equal((await call('/held-drafts/import','POST',{seasonId:2,sourceMatchId:100})).status,400);
    const imported=await call('/held-drafts/import','POST',{seasonId:1,sourceMatchId:100});assert.equal(imported.status,200);
    assert.deepEqual(await imported.json(),{held:false,matchId:200,sourceMatchId:100});
    assert.equal(audits[0].type,'Remake Draft Linked');
    assert.equal((await call('/held-drafts/100','DELETE')).status,404);
    archiveRemakeDraft(f.db,{...f.source,match_id:101});archiveRemakeDraft(f.db,{...f.source,match_id:102});
    assert.equal((await(await call('/held-drafts?seasonId=1')).json()).drafts.length,2);
    assert.deepEqual((await(await call('/held-drafts?seasonId=2')).json()).drafts,[]);
    assert.equal((await call('/held-drafts/101/link','POST',{matchId:200})).status,400);
    assert.equal((await call('/held-drafts/101','DELETE')).status,200);
    assert.equal((await call('/held-drafts/import','POST',{seasonId:1,sourceMatchId:101})).status,409);
    const next={...f.target,match_id:201};f.seed(next);
    failAudit=true;assert.equal((await call('/held-drafts/102/link','POST',{matchId:201})).status,500);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM PickInfo WHERE MatchId=201').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchDraftSources WHERE MatchId=201').get().n,0);
    failAudit=false;assert.equal((await call('/held-drafts/102/link','POST',{matchId:201})).status,200);
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}f.db.close();}
});
