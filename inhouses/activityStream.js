// One lightweight public queue channel, with an optional private lobby chat on
// the same SSE connection. Database polling catches changes from other workers;
// local mutations notify subscribers immediately after their transaction commits.
export function createInhouseActivityStream(store, {intervalMs = 500, maxClients = 250} = {}) {
  const clients = new Set(), rooms = new Map();
  let timer = null, revision = -1, queue = null, fingerprint = '', lastHeartbeat = Date.now(), closed = false;
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  function write(res, value) {
    try {if (res.destroyed || res.writableEnded || !res.write(value)) res.destroy();}
    catch {res.destroy();}
  }
  function refreshQueue() {
    const next = store.revision();
    if (queue && revision === next) return false;
    queue = store.activitySummary(); revision = next;
    const nextFingerprint = JSON.stringify(queue);
    if (fingerprint === nextFingerprint) return false;
    fingerprint = nextFingerprint; return true;
  }
  function publish() {
    if (closed || !clients.size) return;
    try {
      if (refreshQueue()) {
        const value = frame('queue', queue);
        for (const client of clients) write(client.res, value);
      }
      for (const [id, room] of rooms) {
        const game = store.db.prepare('SELECT Status FROM InhouseGames WHERE InhouseId=?').get(id);
        if (!game) {for (const client of room.clients) client.res.end(); continue;}
        const latest = store.db.prepare('SELECT MAX(MessageId) id FROM InhouseChat WHERE InhouseId=?').get(id).id || 0;
        if (latest > room.cursor || game.Status !== room.status) {
          const messages = latest > room.cursor ? store.chatMessages(id, room.cursor) : [];
          if (messages.length) room.cursor = messages.at(-1).id;
          room.status = game.Status;
          const value = frame('chat', {inhouseId: id, status: room.status, messages});
          for (const client of room.clients) write(client.res, value);
        }
      }
      if (Date.now() - lastHeartbeat >= 15000) {
        lastHeartbeat = Date.now();
        const value = frame('heartbeat', {sentAt: Date.now()});
        for (const client of clients) write(client.res, value);
      }
    } catch {for (const client of clients) client.res.destroy();}
  }
  const unsubscribe = store.subscribe(publish);
  return {
    subscribe(req, res, {gameId = null, playerId = null} = {}) {
      if (closed || clients.size >= maxClients) return res.status(503).json({error: 'Inhouse live updates are busy'});
      const chat = gameId ? store.readChat(gameId, playerId) : null;
      // A new subscriber must not consume an unseen worker revision before
      // existing viewers have received it.
      if (clients.size) publish();
      refreshQueue();
      res.set({'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store, no-transform',
        'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
      res.socket?.setNoDelay(true); res.socket?.setTimeout(0); res.flushHeaders();
      const client = {res, gameId}; clients.add(client);
      if (chat) {
        if (!rooms.has(gameId)) rooms.set(gameId, {clients: new Set(), cursor: chat.messages.at(-1)?.id || 0, status: chat.status});
        rooms.get(gameId).clients.add(client);
      }
      res.once('close', () => {
        clients.delete(client);
        if (gameId && rooms.has(gameId)) {
          const room = rooms.get(gameId); room.clients.delete(client);
          if (!room.clients.size) rooms.delete(gameId);
        }
        if (!clients.size) {clearInterval(timer); timer = null;}
      });
      write(res, 'retry: 2000\n\n'); write(res, frame('queue', queue));
      // Reconnects hydrate the latest 100 lines. Clients merge by message ID,
      // avoiding duplicate lines without keeping an unbounded replay buffer.
      if (chat) write(res, frame('chat', chat));
      if (!timer && clients.size) {timer = setInterval(publish, intervalMs); timer.unref?.();}
    },
    close() {
      closed = true; unsubscribe(); clearInterval(timer); timer = null;
      for (const client of clients) client.res.end();
      clients.clear(); rooms.clear();
    },
  };
}
