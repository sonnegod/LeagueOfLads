import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import net from 'node:net';
import {mkdtemp,rm,stat,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import express from 'express';
import {createLiveMatchRouter} from '../routes/liveMatchRoutes.js';
import {createLiveMatchStream} from '../config/liveMatchStream.js';
import {startLiveMatchNotifications,notifyLiveMatchUpdate} from '../config/liveMatchNotifications.js';
import {pollLiveMatches} from '../pollLiveMatchData.js';

async function channelPath() {
  const directory=await mkdtemp(path.join(tmpdir(),'lads-live-'));
  return {directory,socketPath:process.platform==='win32'?`\\\\.\\pipe\\lads-live-test-${randomUUID()}`:path.join(directory,'live.sock')};
}
function row(hash='one',score=1) {
  return {MatchId:100,LeagueId:55,SnapshotHash:hash,LatestSnapshotId:score,RadiantScore:score,
    LastUpdated:new Date().toISOString(),LastChangedAt:new Date().toISOString(),Players:[],Draft:null};
}
async function sse(url) {
  const response=await fetch(url);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-accel-buffering'),'no');
  assert.match(response.headers.get('content-type'),/^text\/event-stream/);
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  async function read(type) {
    let timer;
    try {
      return await Promise.race([
        (async()=>{
          while(true) {
            let boundary;
            while((boundary=buffer.indexOf('\n\n'))>=0) {
              const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
              const event=frame.split('\n').find(line=>line.startsWith('event: '))?.slice(7);
              if(event===type)return JSON.parse(frame.split('\n').find(line=>line.startsWith('data: ')).slice(6));
            }
            const chunk=await reader.read();if(chunk.done)throw Error('Stream ended');
            buffer+=decoder.decode(chunk.value,{stream:true});
          }
        })(),
        new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Timed out waiting for '+type)),2000);}),
      ]);
    }finally{clearTimeout(timer);}
  }
  return {response,read,close:()=>reader.cancel()};
}

test('one private worker notification pushes committed state to every SSE viewer and reconnects to current state',async()=>{
  const {directory,socketPath}=await channelPath();
  let matches=[row()],reads=0;
  const router=createLiveMatchRouter({getLiveMatchCurrentStates:()=>{reads++;return matches;}});
  const app=express();app.use(router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const channel=await startLiveMatchNotifications(()=>router.liveUpdates.publish(),{socketPath});
  router.liveUpdates.setAvailable(true);
  const url=`http://127.0.0.1:${server.address().port}/liveMatches/stream`;
  const viewers=[];
  try {
    if(process.platform!=='win32')assert.equal((await stat(socketPath)).mode&0o777,0o600);
    viewers.push(await sse(url),await sse(url));
    for(const viewer of viewers)assert.equal((await viewer.read('state')).matches[0].RadiantScore,1);
    assert.equal(router.liveUpdates.clientCount,2);
    const before=reads;
    matches=[row('two',2)];
    assert.equal(await notifyLiveMatchUpdate({socketPath}),true);
    for(const viewer of viewers)assert.equal((await viewer.read('state')).matches[0].RadiantScore,2);
    assert.equal(reads,before+1,'One state read feeds all viewers');
    matches=[{...matches[0],LastUpdated:'2026-10-28T20:00:00Z'}];
    assert.equal(await notifyLiveMatchUpdate({socketPath}),true);
    for(const viewer of viewers) {
      const checked=await viewer.read('checked');assert.equal(checked.matches[0].lastUpdated,'2026-10-28T20:00:00Z');
      assert.equal(checked.matches[0].Players,undefined,'Unchanged source checks do not repeat player payloads');
    }
    viewers.push(await sse(url));
    assert.equal((await viewers[2].read('state')).matches[0].RadiantScore,2,'Reconnect receives the entire latest state');
    matches=[];assert.equal(await notifyLiveMatchUpdate({socketPath}),true);
    for(const viewer of viewers)assert.deepEqual((await viewer.read('state')).matches,[]);
  }finally {
    await Promise.all(viewers.map(viewer=>viewer.close()));
    router.liveUpdates.close();await channel.close();server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});
  }
});

test('stream is unavailable until the private notification listener is ready, leaving HTTP fallback usable',async()=>{
  const router=createLiveMatchRouter({getLiveMatchCurrentStates:()=>[row()]});
  const app=express();app.use(router);const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/liveMatches/stream')).status,503);
    assert.equal((await(await fetch(base+'/liveMatches')).json()).matches.length,1);
  }finally{router.liveUpdates.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('worker notifies after saved changes and removals, including successful unchanged Steam polls',async()=>{
  const operations=[];
  const database={getActiveLeague:()=>[{LeagueId:55}],recordLiveMatchSnapshot:()=>{operations.push('save');return false;},
    pruneMissingLiveMatches:()=>{operations.push('prune');return 0;}};
  const fetchImpl=async()=>({ok:true,status:200,text:async()=>JSON.stringify({result:{games:[{match_id:100}]}})});
  await pollLiveMatches({database,apiKey:'test',fetchImpl,notify:async()=>{operations.push('notify');return true;}});
  assert.deepEqual(operations,['save','prune','notify']);
  operations.length=0;
  await pollLiveMatches({database,apiKey:'test',fetchImpl,notify:async()=>{operations.push('notify-failed');throw Error('Web server restarting');}});
  assert.deepEqual(operations,['save','prune','notify-failed'],'Push failure does not discard or fail ingestion');
});

test('local notification failures are bounded and unexpected messages cannot invoke a refresh',async()=>{
  const {directory,socketPath}=await channelPath();let refreshes=0;
  const channel=await startLiveMatchNotifications(()=>{refreshes++;},{socketPath});
  try {
    const reply=await new Promise((resolve,reject)=>{
      const socket=net.createConnection(socketPath);socket.on('error',reject);
      socket.once('connect',()=>socket.write('arbitrary content\n'));
      socket.once('data',chunk=>{socket.destroy();resolve(chunk.toString());});
    });
    assert.equal(reply,'error\n');assert.equal(refreshes,0);
    await assert.rejects(startLiveMatchNotifications(()=>{}, {socketPath}),{code:'EADDRINUSE'});
    assert.equal(await notifyLiveMatchUpdate({socketPath}),true,'A second startup cannot remove a running listener');
    assert.equal(refreshes,1);
  }finally{await channel.close();await rm(directory,{recursive:true,force:true});}
  assert.equal(await notifyLiveMatchUpdate({socketPath,timeoutMs:100}),false);
});

class FakeResponse extends EventEmitter {
  chunks=[];destroyed=false;writableEnded=false;backpressure=false;
  status(){return this;}set(){return this;}flushHeaders(){}json(value){this.jsonValue=value;return this;}
  write(chunk){this.chunks.push(chunk);return !this.backpressure;}
  destroy(){this.destroyed=true;this.emit('close');}
  end(){this.writableEnded=true;this.emit('close');}
}
test('heartbeats, disconnects, slow-viewer cleanup and temporary database errors retain bounded stream resources',async()=>{
  let fail=false;
  const hub=createLiveMatchStream(()=>{if(fail)throw Error('Busy');return [row()];},{heartbeatMs:5});
  hub.setAvailable(true);const req=new EventEmitter(),res=new FakeResponse();
  hub.subscribe(req,res);assert.equal(hub.clientCount,1);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(res.chunks.some(chunk=>chunk.includes('event: heartbeat')));
  fail=true;assert.equal(hub.publish(),false);
  assert.ok(res.chunks.at(-1).includes('event: unavailable'));
  fail=false;assert.equal(hub.publish(),true);
  assert.ok(res.chunks.at(-1).includes('event: checked'));
  res.backpressure=true;hub.publish();assert.equal(hub.clientCount,0);assert.equal(res.destroyed,true);
  const second=new FakeResponse();hub.subscribe(new EventEmitter(),second);hub.close();
  assert.equal(hub.clientCount,0);assert.equal(second.writableEnded,true);
});

test('Unix stale listener recovery never deletes ordinary files', {skip:process.platform==='win32'},async()=>{
  const {directory,socketPath}=await channelPath();
  try {
    await writeFile(socketPath,'preserve this file');
    await assert.rejects(startLiveMatchNotifications(()=>{}, {socketPath}));
    assert.equal(await readFile(socketPath,'utf8'),'preserve this file');
  }finally{await rm(directory,{recursive:true,force:true});}
});
