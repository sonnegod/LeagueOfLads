// Only access-list revisions (and external admin-role changes) fan out here.
// Bot heartbeats do not repeatedly reload the user directory.
export function createInhouseAccessStream(store, {intervalMs = 1000, maxClients = 250} = {}) {
  const clients = new Set();
  let timer = null, closed = false, lastHeartbeat = Date.now();
  const write = (res, event, data) => {
    try { if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) res.destroy(); }
    catch { res.destroy(); }
  };
  function publish() {
    if (closed || !clients.size) return;
    try {
      const version = store.access.version();
      for (const client of clients) {
        const permissions = store.access.permissions(client.playerId);
        if (client.version !== version || !permissions.canManage) {
          client.version = version;
          write(client.res, 'access', {version, permissions});
        }
        if (!permissions.canManage) client.res.end();
      }
      if (Date.now() - lastHeartbeat >= 15000) {
        lastHeartbeat = Date.now();
        for (const client of clients) write(client.res, 'heartbeat', {sentAt: lastHeartbeat});
      }
    } catch { for (const client of clients) client.res.destroy(); }
  }
  const unsubscribe = store.subscribe(publish);
  return {
    subscribe(req, res, playerId) {
      store.access.requireManager(playerId);
      if (closed || clients.size >= maxClients) return res.status(503).json({error: 'Inhouse management updates are busy'});
      res.set({'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
      res.socket?.setNoDelay(true); res.socket?.setTimeout(0); res.flushHeaders();
      const client = {res, playerId, version: store.access.version()};
      clients.add(client);
      res.once('close', () => { clients.delete(client); if (!clients.size) {clearInterval(timer); timer = null;} });
      res.write('retry: 2000\n\n');
      write(res, 'access', {version: client.version, permissions: store.access.permissions(playerId)});
      if (!timer) {timer = setInterval(publish, intervalMs); timer.unref?.();}
    },
    close() { closed = true; unsubscribe(); clearInterval(timer); for (const client of clients) client.res.end(); clients.clear(); },
  };
}
