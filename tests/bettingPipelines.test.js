import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
let bash=process.platform==='win32'?null:'/bin/bash';
if(!bash)try{const gitRoot=resolve(execFileSync('git',['--exec-path'],{encoding:'utf8',windowsHide:true}).trim(),'../../..');
  const candidate=join(gitRoot,'bin','bash.exe');if(existsSync(candidate))bash=candidate;}catch{}
const execute=promisify(execFile);

async function pipeline(script,{active='200',failure=''}={}) {
  const scratch=mkdtempSync(join(tmpdir(),'lads-pipeline-'));
  try {
    mkdirSync(join(scratch,'scripts','db'),{recursive:true});
    const slash=scratch.replaceAll('\\','/');
    writeFileSync(join(scratch,'node-shim.sh'),`#!/bin/bash
echo "$*" >> "$LEAGUE_OF_LADS_ROOT/calls.txt"
if [[ "$1" == */getActiveLeagueId.js ]]; then
  if [ "$ACTIVE_TEST_ID" = fail ]; then exit 1; fi
  echo "$ACTIVE_TEST_ID"
fi
if [[ "$1" == */"$FAILING_STEP" ]] && [ -n "$FAILING_STEP" ]; then exit 1; fi
`,{mode:0o755});
    writeFileSync(join(scratch,'scripts','db','backupDatabases.sh'),'#!/bin/bash\necho "backup $*" >> "$LEAGUE_OF_LADS_ROOT/calls.txt"\n');
    let failed=false;
    try {await execute(bash,[resolve(script).replaceAll('\\','/')],{windowsHide:true,env:{...process.env,
      LEAGUE_OF_LADS_ROOT:slash,LEAGUE_OF_LADS_NODE:`${slash}/node-shim.sh`,ACTIVE_TEST_ID:active,FAILING_STEP:failure}});}
    catch(error){if(error.code!==1)throw error;failed=true;}
    return {failed,calls:readFileSync(join(scratch,'calls.txt'),'utf8').trim().split('\n')};
  }finally{if(dirname(resolve(scratch))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');rmSync(scratch,{recursive:true,force:true});}
}

test('nightly failed ingestion still refreshes derived data and backs up, while the job reports failure',{skip:!bash},async()=>{
  const result=await pipeline('nightlyRun.sh',{failure:'currentLeagueData.js'});assert.equal(result.failed,true);
  assert.ok(result.calls.some(line=>line.includes('matchDetails.js')));assert.ok(result.calls.some(line=>line.endsWith('scripts/betting/run.js --refresh-analytics')));
  assert.equal(result.calls.at(-1),'backup');assert.equal(result.calls.some(line=>line.includes('recordLeagueCheck.js')),false);
});

test('failed active-league lookup cannot create a false successful inactive-source check',{skip:!bash},async()=>{
  const result=await pipeline('nightlyRun.sh',{active:'fail'});assert.equal(result.failed,true);
  assert.equal(result.calls.some(line=>line.includes('recordLeagueCheck.js')),false);assert.equal(result.calls.some(line=>line.includes('currentLeagueData.js')),false);
  assert.ok(result.calls.some(line=>line.endsWith('scripts/betting/run.js --refresh-analytics')));
});

test('between seasons the nightly pipeline checks sources and refreshes preseason without attempting league ingestion',{skip:!bash},async()=>{
  const result=await pipeline('nightlyRun.sh',{active:''});assert.equal(result.failed,false);
  assert.ok(result.calls.some(line=>line.includes('recordLeagueCheck.js')));assert.equal(result.calls.some(line=>line.includes('currentLeagueData.js')),false);
  assert.ok(result.calls.some(line=>line.endsWith('scripts/betting/run.js --refresh-analytics')));
});

test('public-source failure still triggers fallback repricing and keeps the cron result failed',{skip:!bash},async()=>{
  const result=await pipeline('generatePublicMatchData.sh',{failure:'generatePlayerInfo.js'});assert.equal(result.failed,true);
  assert.ok(result.calls.some(line=>line.includes('generateMatchInfo.js')));assert.ok(result.calls.at(-1).endsWith('scripts/betting/run.js --refresh-analytics'));
});
