import 'dotenv/config';
import Database from 'better-sqlite3';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {withNightlyResultsOwnership} from '../../config/matchResultsOwnership.js';
import {configureWarehouseConnection} from '../../config/warehouseConnection.js';

const root=process.env.LEAGUE_OF_LADS_ROOT||fileURLToPath(new URL('../../',import.meta.url));
const db=new Database(resolve(root,'db/LadsData.db'),{fileMustExist:true});
const abort=new AbortController();let child;
function stopChild(signal='SIGTERM') {
  if(!child?.pid)return;
  try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
}
function stop(){abort.abort(new Error('Nightly run interrupted'));stopChild();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try {
  configureWarehouseConnection(db,{role:'background'});
  console.log(`${new Date().toISOString()} - Nightly requested match cleanup; waiting for the daytime worker to finish.`);
  process.exitCode=await withNightlyResultsOwnership(db,async({owner,assertOwnership})=>{
    console.log(`${new Date().toISOString()} - Nightly owns match cleanup. Daytime processing is paused.`);
    let ownershipError;
    const guard=setInterval(()=>{try{assertOwnership();}catch(error){ownershipError=error;stopChild();}},15000);
    try {
      const code=await new Promise((done,reject)=>{
        child=spawn('/bin/bash',[resolve(root,'nightlyRun.sh')],{cwd:root,stdio:'inherit',detached:process.platform!=='win32',windowsHide:true,
          env:{...process.env,LEAGUE_OF_LADS_ROOT:root,LEAGUE_NIGHTLY_OWNER:owner}});
        child.once('error',reject);child.once('close',(code,signal)=>done(signal?1:code??1));
      });
      if(ownershipError)throw ownershipError;
      return code;
    }finally{clearInterval(guard);child=null;}
  },{signal:abort.signal});
}catch(error){console.error('Nightly cleanup failed:',error.message);process.exitCode=1;}
finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);db.close();}
