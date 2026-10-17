import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync,readdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeWarehouse } from '../config/warehouseIngestion.js';
import { captureWarehouseBaseline,compareWarehouseBaseline } from '../config/warehouseValidation.js';
import { validateBackfillConfig,planWarehouseBackfill,runWarehouseBackfill,openDotaLimits } from '../config/warehouseBackfill.js';

function fixture(groups=[[1,2],[3]]) {
  const db=new Database(':memory:');
  db.exec(readFileSync(new URL('../scripts/db/ladsData.schema.sql',import.meta.url),'utf8'));
  db.exec("INSERT INTO TeamInfo(TeamId,TeamName) VALUES(100,'Alpha'),(200,'Beta')");
  for(let p=1;p<=10;p++){
    db.prepare('INSERT INTO PlayerInfo(PlayerId,PlayerName) VALUES(?,?)').run(p,'Player '+p);
    db.prepare('INSERT INTO HeroInfo VALUES(?,?)').run(p,'Hero '+p);
  }
  groups.forEach((ids,index)=>{
    const leagueId=20+index;
    db.prepare('INSERT INTO LeagueInfo VALUES(?,?,0)').run(leagueId,'Season '+leagueId);
    for(const id of ids){
      db.prepare('INSERT INTO MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,SeriesId,Duration) VALUES(?,100,200,100,0,600)').run(id);
      db.prepare('INSERT INTO MatchLeague VALUES(?,?,NULL)').run(id,leagueId);
      for(let p=1;p<=10;p++)db.prepare('INSERT INTO MatchPlayer(MatchId,PlayerId,HeroId,Kills,Deaths,Assists,Lasthits,GPM,XPM) VALUES(?,?,?,3,2,4,100,500,600)').run(id,p,p);
    }
  });
  initializeWarehouse(db);return db;
}
const config=(changes={})=>({leagueIds:[20,21],dailyRequestBudget:10,dailyReserve:300,seasonRetryAllowance:1,
  requestDelayMs:2000,minuteCooldownMs:120000,minuteReserve:5,maxMinuteRetries:2,...changes});
const payload=id=>({match_id:id,start_time:1770862625,duration:600,version:22,radiant_win:true,
  radiant_team_id:900,dire_team_id:901,radiant_score:10,dire_score:5,radiant_gold_adv:[1000],radiant_xp_adv:[500],
  objectives:[],teamfights:[],players:Array.from({length:10},(_,i)=>({account_id:i+1,hero_id:i+1,
    player_slot:i<5?i:128+i-5,kills:3,denies:1,times:[0],gold_t:[0],xp_t:[0],lh_t:[0],purchase_log:[]}))});
function harness(db,settings=config(),responses=null){
  let clock=Date.parse('2026-10-16T12:00:00Z');
  const state={day:'2026-10-16',requests:0,remainingDay:null,waitUntil:0},calls=[],saved=[],events=[],reports=[];
  const options={state,now:()=>clock,sleep:async ms=>{clock+=ms;},
    saveState:value=>saved.push(structuredClone(value)),saveReport:r=>reports.push(r),log:e=>events.push(e),
    fetcher:async url=>{
      calls.push(url);assert.equal(saved.at(-1).requests,calls.length,'ledger written before each request');
      return responses?responses(url,calls.length):Response.json(payload(Number(url.split('/').at(-1))));
    }};
  return {state,calls,saved,events,reports,options,run:()=>runWarehouseBackfill(db,settings,options),now:()=>clock};
}

test('batch planning reserves retries and never splits a season or silently starts part of a file',async()=>{
  const db=fixture();
  try{
    const all=planWarehouseBackfill(db,config({dailyRequestBudget:5}));
    assert.deepEqual(all.seasons.map(s=>s.selected),[true,true]);assert.equal(all.reservedRequests,5);
    const small=planWarehouseBackfill(db,config({dailyRequestBudget:4}));
    assert.deepEqual(small.seasons.map(s=>s.selected),[true,false]);
    assert.equal(small.seasons[0].selectedMatchIds.length,2);
    const h=harness(db,config({dailyRequestBudget:4}));
    const result=await h.run();
    assert.equal(h.calls.length,0);assert.match(result.stopReason,/entire batch/);
    assert.deepEqual(planWarehouseBackfill(db,config(),{remainingDay:304}).seasons.map(s=>s.selected),[true,false]);
    assert.throws(()=>validateBackfillConfig(config({leagueIds:[20,20]})),/distinct/);
    assert.throws(()=>validateBackfillConfig(config({requestDelayMs:0})),/requestDelayMs/);
  }finally{db.close();}
});

test('a batch imports only curated IDs, validates each complete season, and skips successes on rerun',async()=>{
  const db=fixture();
  try{
    db.exec("INSERT INTO TeamInfo(TeamId,TeamName) VALUES(300,'Former team ID'); UPDATE MatchTeam SET WinnerId=300 WHERE MatchId=1");
    const baseline=captureWarehouseBaseline(db),h=harness(db);
    const result=await h.run();
    assert.deepEqual(h.calls.map(url=>Number(url.split('/').at(-1))),[1,2,3]);
    assert.equal(result.totals.ready,3);assert.equal(result.reports.length,2);
    assert.equal(result.stopReason,'all selected seasons processed');
    for(const report of result.reports){assert.equal(report.reconciliation.unchanged,true);assert.equal(report.validation.valid,true);}
    assert.equal(result.reports[0].validation.dataQualityNotes.length,1);
    assert.equal(compareWarehouseBaseline(db,baseline).unchanged,true);
    const again=await h.run();assert.equal(again.totals.requests,0);assert.equal(h.calls.length,3);
  }finally{db.close();}
});

test('minute throttling waits for Retry-After, retries the same match and counts every request',async()=>{
  const db=fixture([[1]]);
  try{
    const h=harness(db,config({leagueIds:[20]}),(url,n)=>n===1?
      new Response('{"error":"minute rate limit exceeded"}',{status:429,headers:{'retry-after':'180','x-rate-limit-remaining-minute':'-1','x-rate-limit-remaining-day':'2999'}}):
      Response.json(payload(1),{headers:{'x-rate-limit-remaining-minute':'59','x-rate-limit-remaining-day':'2998'}}));
    const start=h.now(),r=await h.run();
    assert.deepEqual(h.calls,[h.calls[0],h.calls[0]]);assert.equal(h.state.requests,2);
    assert.ok(h.now()-start>=180000);assert.equal(r.totals.failed,0);assert.equal(r.totals.rateLimits,1);
    assert.equal(db.prepare('SELECT Status FROM MatchIngestionState').get().Status,'ready');
    assert.equal(openDotaLimits(new Headers({'retry-after':'Fri, 16 Oct 2026 12:02:00 GMT'}),start).retryAfterMs,120000);
  }finally{db.close();}
});

test('daily quota and authentication stops never mark an unattempted match as a bad source record',async()=>{
  for(const [status,message,headers,reason] of [
    [429,'{"error":"daily rate limit exceeded"}',{'x-rate-limit-remaining-day':'0'},/daily quota/],
    [403,'denied',{},/access error/]
  ]){
    const db=fixture([[1]]);
    try{
      const h=harness(db,config({leagueIds:[20]}),()=>new Response(message,{status,headers}));
      const r=await h.run();assert.equal(h.calls.length,1);assert.match(r.stopReason,reason);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchIngestionState').get().n,0);
    }finally{db.close();}
  }
});

test('remaining-day headers stop at the reserve, and exhausted minute retries save a restart cooldown',async()=>{
  const db=fixture([[1,2]]);
  try{
    const h=harness(db,config({leagueIds:[20]}),url=>Response.json(payload(Number(url.split('/').at(-1))),{headers:{'x-rate-limit-remaining-day':'300'}}));
    const r=await h.run();assert.equal(h.calls.length,1);assert.equal(r.totals.ready,1);assert.match(r.stopReason,/reserve/);
  }finally{db.close();}
  const retry=fixture([[1]]);
  try{
    const h=harness(retry,config({leagueIds:[20],maxMinuteRetries:0}),()=>new Response('minute rate limit exceeded',{status:429}));
    const r=await h.run();assert.equal(h.calls.length,1);assert.match(r.stopReason,/retry allowance/);
    assert.ok(h.state.waitUntil>h.now());assert.equal(h.state.requests,1);
    const saved=structuredClone(h.state),savedAt=h.now();
    const resume=harness(retry,config({leagueIds:[20]}));
    resume.options.state=saved;
    resume.options.fetcher=async url=>{assert.ok(resume.now()>=saved.waitUntil);return Response.json(payload(Number(url.split('/').at(-1))));};
    const done=await resume.run();assert.equal(done.totals.ready,1);assert.equal(saved.requests,2);
    assert.ok(resume.now()-savedAt>=120000);
  }finally{retry.close();}
});

test('interruption preserves completed IDs and original-data changes stop the batch before the next season',async()=>{
  const db=fixture();
  try{
    const controller=new AbortController(),h=harness(db);h.options.signal=controller.signal;
    h.options.log=e=>{if(e.event==='match')controller.abort();};
    const r=await h.run();assert.equal(h.calls.length,1);assert.equal(r.totals.ready,1);assert.equal(r.stopReason,'interrupted');
  }finally{db.close();}
  const changed=fixture([[1],[2]]);
  try{
    const h=harness(changed);
    h.options.log=e=>{if(e.event==='match')changed.exec('UPDATE MatchPlayer SET Kills=99 WHERE MatchId=1');};
    const r=await h.run();assert.equal(h.calls.length,1);assert.match(r.stopReason,/validation failed/);
    assert.equal(r.reports[0].reconciliation.unchanged,false);
  }finally{changed.close();}
});

test('isolated HTTP failures, invalid players, partial sources and source warnings do not stop the next season',async()=>{
  for(const kind of ['http','identity','partial','warning']){
    const db=fixture();
    try{
      const baseline=captureWarehouseBaseline(db);
      const h=harness(db,config(),url=>{
        const id=Number(url.split('/').at(-1)),data=payload(id);
        if(id===1){
          if(kind==='http')return new Response('temporary provider error',{status:500});
          if(kind==='identity')data.players[0].account_id=0;
          if(kind==='partial')delete data.version;
          if(kind==='warning')data.players[0].kills=99;
        }
        return Response.json(data);
      });
      const result=await h.run();
      assert.equal(h.calls.length,3,kind);assert.equal(result.reports.length,2,kind);
      assert.equal(result.stopReason,'all selected seasons processed',kind);
      assert.equal(db.prepare('SELECT Status FROM MatchIngestionState WHERE MatchId=3').get().Status,'ready',kind);
      assert.equal(compareWarehouseBaseline(db,baseline).unchanged,true,kind);
      if(kind==='http'||kind==='identity'){
        assert.equal(result.totals.failed,1);assert.equal(result.totals.ready,2);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchSourceResponses WHERE MatchId=1').get().n,0);
        assert.equal(result.reports[0].validation.problems.length,1);
      }else if(kind==='partial')assert.equal(result.totals.partial,1);
      else assert.equal(result.reports[0].validation.problems.length,1);
    }finally{db.close();}
  }
});

test('a deep source reconciliation failure still stops the next season',async()=>{
  const db=fixture([[1],[2]]);
  try{
    const h=harness(db);
    h.options.log=e=>{if(e.event==='match')db.exec('UPDATE MatchPlayerTimeline SET Gold=99 WHERE MatchId=1');};
    const result=await h.run();
    assert.equal(h.calls.length,1);assert.match(result.stopReason,/validation failed/);
    assert.equal(result.reports[0].reconciliation.unchanged,true);
    assert.ok(result.reports[0].validation.sourceReconciliation.mismatchCount>0);
  }finally{db.close();}
});

test('the runnable batch CLI previews without writes, saves reports and persists its request ledger across restarts',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'lads-backfill-cli-'));
  const root=join(folder,'workspace with spaces'),dbFolder=join(root,'db');
  mkdirSync(dbFolder,{recursive:true});
  const dbPath=join(dbFolder,'LadsData.db'),batchPath=join(root,'batch.json'),mockPath=join(root,'mock.mjs');
  const fixtureDb=fixture([[1]]);
  try{
    await fixtureDb.backup(dbPath);fixtureDb.close();
    writeFileSync(batchPath,JSON.stringify({description:'Offline test',leagueIds:[20]}));
    const requestLog=join(root,'requests.log');
    writeFileSync(mockPath,`import {appendFileSync} from 'node:fs';
      globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(requestLog)},'fetch\\n');return Response.json(${JSON.stringify(payload(1))});};`);
    const cli=fileURLToPath(new URL('../scripts/league/backfillWarehouse.js',import.meta.url));
    const run=flags=>spawnSync(process.execPath,['--import',pathToFileURL(mockPath).href,cli,dbPath,batchPath,...flags],{encoding:'utf8',timeout:10000});
    const before=run([]);assert.equal(before.status,0,before.stderr);
    assert.match(before.stdout,/"mode": "preview"/);
    assert.equal(existsSync(requestLog),false);assert.equal(existsSync(dbPath+'.warehouse-backfill.json'),false);
    assert.equal(existsSync(dbPath+'.warehouse-backfill.lock'),false);assert.equal(existsSync(join(root,'Logs')),false);
    const applied=run(['--apply','--no-backup']);assert.equal(applied.status,0,applied.stdout+applied.stderr);
    const state=JSON.parse(readFileSync(dbPath+'.warehouse-backfill.json','utf8'));assert.equal(state.requests,1);
    assert.equal(existsSync(dbPath+'.warehouse-backfill.lock'),false);assert.equal(existsSync(join(root,'backups')),false);
    const reports=join(root,'Logs','warehouse-backfill');assert.equal(readdirSync(reports).length,1);
    const resultFolder=join(reports,readdirSync(reports)[0]);
    assert.equal(existsSync(join(resultFolder,'validation.md')),true);
    const summary=JSON.parse(readFileSync(join(resultFolder,'summary.json'),'utf8'));
    assert.equal(summary.checksPassed,true);assert.equal(summary.totals.ready,1);
    const rerun=run(['--apply','--no-backup']);assert.equal(rerun.status,0,rerun.stdout+rerun.stderr);
    assert.equal(JSON.parse(readFileSync(dbPath+'.warehouse-backfill.json','utf8')).requests,1);
    assert.equal(readFileSync(requestLog,'utf8'),'fetch\n');
  }finally{
    if(fixtureDb.open)fixtureDb.close();
    const target=resolve(folder),temporary=resolve(tmpdir());
    if(!target.startsWith(temporary+sep)||!target.split(sep).at(-1).startsWith('lads-backfill-cli-'))throw new Error('Unsafe temp cleanup path');
    rmSync(target,{recursive:true,force:true});
  }
});
