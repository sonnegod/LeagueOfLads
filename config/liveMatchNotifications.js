import net from 'node:net';
import {createHash} from 'node:crypto';
import {chmod,lstat,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const databaseDirectory=fileURLToPath(new URL('../db/',import.meta.url));
const projectKey=createHash('sha256').update(process.platform==='win32'?databaseDirectory.toLowerCase():databaseDirectory).digest('hex').slice(0,16);
export const LIVE_MATCH_SOCKET=process.platform==='win32'
  ? `\\\\.\\pipe\\leagueoflads-live-${projectKey}`
  : fileURLToPath(new URL('../db/live-updates.sock',import.meta.url));

// No TCP listener or public write endpoint: Unix socket permissions restrict the
// production channel to the user that runs the existing web and poller processes.
export async function startLiveMatchNotifications(onRefresh,{socketPath=LIVE_MATCH_SOCKET,onUnavailable=()=>{}}={}) {
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
    socket.on('error',()=>{});
    socket.setTimeout(1000,()=>socket.destroy());
    let message='',handled=false;
    socket.on('data',chunk=>{
      if(handled)return;
      message+=chunk.toString('utf8');
      if(message.length>64){handled=true;socket.destroy();return;}
      if(!message.includes('\n'))return;
      handled=true;
      if(message!=='refresh\n'){socket.end('error\n');return;}
      try{socket.end(onRefresh()===false?'error\n':'ok\n');}
      catch{socket.end('error\n');}
    });
  });
  server.maxConnections=32;
  const listen=()=>new Promise((resolve,reject)=>{
    function failed(error){server.removeListener('listening',ready);reject(error);}
    function ready(){server.removeListener('error',failed);resolve();}
    server.once('error',failed);server.once('listening',ready);
    server.listen(socketPath);
  });
  try{await listen();}
  catch(error) {
    if(error.code!=='EADDRINUSE'||process.platform==='win32')throw error;
    // After a crash, remove only a stale socket owned by this process user.
    // A running web process must never lose its notification channel.
    const active=await new Promise((resolve,reject)=>{
      const probe=net.createConnection(socketPath);
      probe.setTimeout(500,()=>{probe.destroy();resolve(true);});
      probe.once('connect',()=>{probe.destroy();resolve(true);});
      probe.once('error',err=>['ECONNREFUSED','ENOENT'].includes(err.code)?resolve(false):reject(err));
    });
    if(active)throw error;
    const stat=await lstat(socketPath).catch(err=>{if(err.code!=='ENOENT')throw err;return null;});
    if(stat) {
      if(!stat.isSocket()||stat.uid!==process.getuid())throw error;
      await unlink(socketPath);
    }
    await listen();
  }
  if(process.platform!=='win32') {
    try{await chmod(socketPath,0o600);}
    catch(error){server.close();throw error;}
  }
  server.on('error',onUnavailable);
  return {
    close:()=>new Promise(resolve=>{
      for(const socket of sockets)socket.destroy();
      server.close(resolve);
    }),
  };
}

export function notifyLiveMatchUpdate({socketPath=LIVE_MATCH_SOCKET,timeoutMs=1000}={}) {
  return new Promise(resolve=>{
    const socket=net.createConnection(socketPath);
    let settled=false,reply='';
    function finish(ok) {
      if(settled)return;
      settled=true;clearTimeout(timer);socket.destroy();resolve(ok);
    }
    const timer=setTimeout(()=>finish(false),timeoutMs);
    socket.on('error',()=>finish(false));
    socket.once('connect',()=>socket.write('refresh\n'));
    socket.on('data',chunk=>{
      reply+=chunk.toString('utf8');
      if(reply.includes('\n')||reply.length>64)finish(reply==='ok\n');
    });
    socket.once('end',()=>finish(false));
  });
}
