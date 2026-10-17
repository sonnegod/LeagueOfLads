import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { hostname } from 'node:os';
import { validateBackfillConfig, planWarehouseBackfill, runWarehouseBackfill } from '../../config/warehouseBackfill.js';
import { initializeWarehouse } from '../../config/warehouseIngestion.js';
import { captureWarehouseBaseline, compareWarehouseBaseline, validateWarehouse } from '../../config/warehouseValidation.js';
import { configureWarehouseConnection, checkpointWarehouse } from '../../config/warehouseConnection.js';

const [filename,batchFile,...args]=process.argv.slice(2);
if(!filename||!batchFile||args.some(a=>!['--apply','--no-backup','--repair-incomplete'].includes(a)))throw new Error(
  'Usage: node scripts/league/backfillWarehouse.js <existing-LadsData.db> <batch.json> [--apply] [--no-backup] [--repair-incomplete]');
const target=realpathSync(resolve(filename)),batchPath=resolve(batchFile),apply=args.includes('--apply');
const repairIncomplete=args.includes('--repair-incomplete');
const batch=JSON.parse(readFileSync(batchPath,'utf8'));
if(Object.keys(batch).some(key=>!['description','leagueIds'].includes(key)))throw new Error('Batch files support description and leagueIds only');
const settings=JSON.parse(readFileSync(new URL('./warehouseBackfill.json',import.meta.url),'utf8'));
const config=validateBackfillConfig({...settings,leagueIds:batch.leagueIds});
const statePath=target+'.warehouse-backfill.json',lockPath=target+'.warehouse-backfill.lock';
const day=new Date().toISOString().slice(0,10);
let state={format:1,database:target,day,requests:0,remainingDay:null,waitUntil:0};
if(existsSync(statePath)){
  const saved=JSON.parse(readFileSync(statePath,'utf8'));
  if(saved.format!==1||saved.database!==target||!/^\d{4}-\d{2}-\d{2}$/.test(saved.day)
    ||!Number.isSafeInteger(saved.requests)||saved.requests<0
    ||(saved.remainingDay!==null&&(!Number.isFinite(saved.remainingDay)))
    ||!Number.isFinite(saved.waitUntil))throw new Error('Invalid backfill ledger; refusing to reset request accounting');
  if(saved.day===day)state=saved;
}
let lockOwned=false;
if(apply){
  try{const fd=openSync(lockPath,'wx');lockOwned=true;
    try{writeFileSync(fd,JSON.stringify({pid:process.pid,host:hostname(),startedAt:new Date().toISOString(),batch:batchPath}));}finally{closeSync(fd);}
  }catch(error){if(error.code==='EEXIST')throw new Error(`Backfill lock exists: ${lockPath}. Verify the previous worker has stopped before removing a stale lock.`);throw error;}
}
let db,folder;
const controller=new AbortController();
const stop=()=>controller.abort();
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
  db=new Database(target,{fileMustExist:true,readonly:!apply});
  configureWarehouseConnection(db,{role:apply?'background':'readonly'});
  const plan=planWarehouseBackfill(db,config,{requestsUsed:state.requests,remainingDay:state.remainingDay,repairIncomplete});
  console.log(JSON.stringify({mode:apply?'apply':'preview',repairIncomplete,batch:basename(batchPath),description:batch.description,
    requestLedger:statePath,day,requestsUsed:state.requests,dailyRequestBudget:config.dailyRequestBudget,
    dailyReserve:config.dailyReserve,plannedMatchRequests:plan.plannedMatchRequests,reservedRequests:plan.reservedRequests,
    seasons:plan.seasons.map(({league,curatedMatches,eligibleMatches,excludedMatches,dataQualityNotes,selected,reason,retryAllowance})=>
      ({...league,curatedMatches,eligibleMatches,excludedMatches,dataQualityNotes,selected,retryAllowance,reason}))},null,2));
  const deferred=plan.seasons.some(s=>s.eligibleMatches&&!s.selected);
  if(deferred){console.log('Entire batch does not fit the remaining allowance. No imports started. Rerun on another day or adjust the batch files.');process.exitCode=2;}
  else if(apply&&plan.plannedMatchRequests){
    folder=resolve(dirname(target),'..','Logs','warehouse-backfill',basename(batchPath,'.json')+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid);
    mkdirSync(folder,{recursive:true});
    const json=(name,value)=>writeFileSync(join(folder,name),JSON.stringify(value,null,2));
    const log=event=>{const line=JSON.stringify({at:new Date().toISOString(),...event});console.log(line);
      // One JSON record per line makes waits and match IDs inspectable as the job runs.
      writeFileSync(join(folder,'events.jsonl'),line+'\n',{flag:'a'});};
    const saveState=value=>{
      const temporary=statePath+'.tmp-'+process.pid;
      writeFileSync(temporary,JSON.stringify(value,null,2));renameSync(temporary,statePath);
    };
    console.log(`Reports: ${folder}`);json('plan.json',plan);
    const baseline=captureWarehouseBaseline(db);json('baseline.json',baseline);
    if(!args.includes('--no-backup')){
      const backups=resolve(dirname(target),'..','backups','LadsData');mkdirSync(backups,{recursive:true});
      const backup=join(backups,'LadsData_before-edw-backfill-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db');
      await db.backup(backup);log({event:'backup',file:backup});
    }
    initializeWarehouse(db);saveState(state);
    const result=await runWarehouseBackfill(db,config,{state,saveState,log,signal:controller.signal,repairIncomplete,
      saveRepair:repair=>writeFileSync(join(folder,'repairs.jsonl'),JSON.stringify(repair)+'\n',{flag:'a'}),
      saveReport:report=>json('league-'+report.league.LeagueId+'.json',report)});
    const reconciliation=compareWarehouseBaseline(db,baseline,{repairs:result.repairs}),validation=validateWarehouse(db,{deep:true});
    const integrity=db.pragma('integrity_check'),foreignKeys=db.pragma('foreign_key_check');
    const checksPassed=reconciliation.unchanged&&validation.valid&&integrity.every(r=>r.integrity_check==='ok')&&!foreignKeys.length;
    const reviewRequired=result.totals.failed>0||validation.problems.length>0||result.reports.some(r=>r.validation.coverage.some(c=>c.status==='partial'));
    const summary={batch:batchPath,repairIncomplete,finishedAt:new Date().toISOString(),checksPassed,reviewRequired,...result,
      reconciliation,validation,integrity,foreignKeys,checkpoint:checkpointWarehouse(db)};
    json('summary.json',summary);
    json('repairs.json',result.repairs);
    const lines=['# '+basename(batchPath,'.json')+' validation','',`Stop: ${result.stopReason}`,'',
      `Requests this run: ${result.totals.requests}; ledger requests today: ${result.requestsToday}.`,
      `Imports: ${result.totals.ready} ready, ${result.totals.partial} partial, ${result.totals.failed} failed.`,
      `Minute-limit responses: ${result.totals.rateLimits}.`,
      `${repairIncomplete?'Protected data unchanged outside recorded repairs':'Original data unchanged'}: ${reconciliation.unchanged} (${reconciliation.checkedTables} tables checked).`,
      `Deep source mismatches: ${validation.sourceReconciliation?.mismatchCount??0}.`,
      `SQLite integrity: ${integrity.map(r=>r.integrity_check).join(', ')}. Foreign-key violations: ${foreignKeys.length}.`,'',
      '## More-complete match repairs','',
      ...(result.repairs.length?result.repairs.map(r=>`- Match ${r.matchId}: ${r.beforePlayers} → ${r.afterPlayers} players; ${r.beforeCells} → ${r.afterCells} populated source stat cells. Team IDs preserved. Winner ${r.previousWinner} → ${r.winner}.`):['No original match records repaired.']),
      'Exact before/after original rows are saved in repairs.json and appended to repairs.jsonl as repairs complete. Unrelated changes still fail validation.','',
      '## Match issues for review','',
      ...(validation.problems.length?validation.problems.map(p=>`- Match ${p.MatchId} (${p.Status}): ${p.Error||p.IssuesJson}`):['No match errors or source discrepancies recorded.']),
      'Individual match errors and unavailable source sections are recorded for review; they do not stop progression to the next season.','',
      '## Existing result notes','',
      ...(plan.seasons.flatMap(s=>s.dataQualityNotes).map(note=>`- Match ${note.matchId}: winner ${note.winnerId}, recorded teams ${note.teamRad} / ${note.teamDire}. ${result.repairs.some(r=>r.matchId===note.matchId)?'Result refreshed by a recorded repair.':'Enrichment allowed; original result preserved.'}`)),
      'These existing result references do not block enrichment or fail validation.','',
      '| Season | Requests | Ready | Partial | Failed | Validation |','| --- | ---: | ---: | ---: | ---: | --- |',
      ...result.reports.map(r=>`| ${r.league.LeagueName} | ${r.totals.requests} | ${r.totals.ready} | ${r.totals.partial} | ${r.totals.failed} | ${r.reconciliation.unchanged&&r.validation.valid?'Passed':'FAILED'} |`),'',
      'Review exclusions in plan.json and coverage/problems in each league report. Partial means some historical source sections were unavailable; inspect before deciding whether to retry.',
      'This command stops after the chosen batch. Run the next batch file manually on another day.'];
    writeFileSync(join(folder,'validation.md'),lines.join('\n')+'\n');
    log({event:'finished',checksPassed,reviewRequired,totals:result.totals,stopReason:result.stopReason,report:join(folder,'validation.md')});
    if(!checksPassed||result.totals.failed||validation.problems.length)process.exitCode=1;
    else if(result.stopReason!=='all selected seasons processed')process.exitCode=2;
  }
}catch(error){
  console.error(error);
  if(folder)writeFileSync(join(folder,'fatal-error.txt'),error.stack||error.message);
  process.exitCode=1;
}finally{
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  if(db?.open)db.close();
  if(lockOwned)unlinkSync(lockPath);
}
