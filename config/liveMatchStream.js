import {randomUUID} from 'node:crypto';

export function createLiveMatchStream(readMatches,{heartbeatMs=15000,maxClients=500}={}) {
  const clients=new Set();
  const instance=randomUUID();
  let available=false,closed=false,timer=null,sequence=0,cached=null,fingerprint=null,cachedAt=0;
  function frame(event,data) {
    return `id: ${instance}:${++sequence}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
  function write(res,message) {
    if(res.destroyed||res.writableEnded){clients.delete(res);return;}
    try {
      // Slow/disconnected viewers reconnect to the latest state; never queue an
      // unbounded stream of obsolete game states in the web process.
      if(!res.write(message)){clients.delete(res);res.destroy();}
    }catch{clients.delete(res);res.destroy();}
  }
  function broadcast(event,data) {
    const message=frame(event,data);
    for(const res of clients)write(res,message);
  }
  function publish() {
    if(closed)return false;
    try {
      const matches=readMatches();
      if(!Array.isArray(matches))throw Error('Invalid live match state');
      const nextFingerprint=JSON.stringify(matches.map(row=>[row.MatchId,row.SnapshotHash,row.LatestSnapshotId])
        .sort((a,b)=>Number(a[0])-Number(b[0])));
      cached={matches,count:matches.length,generatedAt:new Date().toISOString()};
      cachedAt=Date.now();
      if(nextFingerprint!==fingerprint){
        fingerprint=nextFingerprint;
        broadcast('state',cached);
      }else {
        broadcast('checked',{matches:matches.map(row=>({matchId:row.MatchId,lastUpdated:row.LastUpdated}))});
      }
      return true;
    }catch {
      broadcast('unavailable',{message:'Live updates are temporarily unavailable.'});
      return false;
    }
  }
  function subscribe(req,res) {
    if(closed||!available||clients.size>=maxClients) {
      res.set('Retry-After','5');
      return res.status(503).json({error:'Live stream is temporarily unavailable'});
    }
    if((!cached||Date.now()-cachedAt>1000)&&!publish()) {
      return res.status(503).json({error:'Live data is temporarily unavailable'});
    }
    res.status(200).set({
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-transform',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no',
    });
    res.socket?.setNoDelay(true);
    res.socket?.setTimeout(0);
    res.flushHeaders();
    clients.add(res);
    function remove() {
      clients.delete(res);
      req.removeListener('aborted',remove);
      if(!clients.size){clearInterval(timer);timer=null;}
    }
    res.once('close',remove);
    req.once('aborted',remove);
    write(res,'retry: 2000\n\n'+frame('state',cached));
    if(clients.size&&!timer) {
      timer=setInterval(()=>broadcast('heartbeat',{sentAt:new Date().toISOString()}),heartbeatMs);
      timer.unref?.();
    }
  }
  function setAvailable(value) {
    available=Boolean(value);
    if(!available) {
      broadcast('unavailable',{message:'Live updates are reconnecting.'});
      for(const res of clients)res.end();
      clients.clear();clearInterval(timer);timer=null;
    }
  }
  function close() {setAvailable(false);closed=true;}
  return {subscribe,publish,setAvailable,close,get clientCount(){return clients.size;}};
}
