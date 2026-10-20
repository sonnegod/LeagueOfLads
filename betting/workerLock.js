import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {hostname} from 'node:os';

// PID plus Linux boot/start identity prevents a reused PID from retaining a
// crashed worker's lock. Unknown/older owner formats keep their lease policy.
function processIdentity(pid) {
  if(process.platform!=='linux')return null;
  try {
    const stat=readFileSync(`/proc/${pid}/stat`,'utf8');
    const started=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19];
    return `${readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()}:${started}`;
  }catch{return null;}
}

export function workerOwner() {
  return JSON.stringify({version:1,id:randomUUID(),host:hostname(),pid:process.pid,started:processIdentity(process.pid)});
}

export function workerOwnerAlive(owner) {
  let value;try{value=JSON.parse(owner);}catch{return null;}
  if(value?.version!==1||value.host!==hostname()||!Number.isSafeInteger(value.pid)||value.pid<=0)return null;
  try{process.kill(value.pid,0);}catch(error){return error.code==='ESRCH'?false:null;}
  const started=processIdentity(value.pid);
  return value.started&&started&&value.started!==started?false:true;
}

export const WORKER_BUSY_EXIT_CODE=75;
