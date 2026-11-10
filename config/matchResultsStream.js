// Public invalidations only. Job errors, leases and API usage stay in admin endpoints.
export function createMatchResultsStream(db) {
  const clients=new Set();let timer,revision=-1,ticks=0;
  const write=(res,event,data)=>{try{if(!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))res.destroy();}catch{res.destroy();}};
  function poll() {
    try {
      const next=db.prepare('SELECT Revision FROM MatchResultsState WHERE Id=1').get().Revision;
      if(next!==revision){revision=next;for(const res of clients)write(res,'results',{revision});}
      else if(++ticks%3===0)for(const res of clients)write(res,'heartbeat',{});
    }catch{for(const res of clients)res.end();}
  }
  return {subscribe(req,res) {
    if(clients.size>=250)return res.status(503).json({error:'Results updates are busy'});
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.socket?.setNoDelay(true);res.socket?.setTimeout(0);res.flushHeaders();
    clients.add(res);write(res,'results',{revision:db.prepare('SELECT Revision FROM MatchResultsState WHERE Id=1').get().Revision});
    res.once('close',()=>{clients.delete(res);if(!clients.size){clearInterval(timer);timer=null;}});
    if(!timer){revision=db.prepare('SELECT Revision FROM MatchResultsState WHERE Id=1').get().Revision;timer=setInterval(poll,5000);timer.unref?.();}
  },close(){clearInterval(timer);for(const res of clients)res.end();clients.clear();}};
}
