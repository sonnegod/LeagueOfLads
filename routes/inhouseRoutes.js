import express from 'express';
import {requestAccountId} from './utility/requestAccountId.js';
import {fail, positiveId} from '../inhouses/store.js';
import {createInhouseActivityStream} from '../inhouses/activityStream.js';

const endpoint = fn => async (req, res) => {
  try {await fn(req, res);}
  catch (error) {
    if (res.headersSent) return res.end();
    if (error.status) return res.status(error.status).json({error: error.message});
    if (String(error.code).startsWith('SQLITE_BUSY')) return res.status(503).json({error: 'Inhouses are busy. Please try again.'});
    console.error('Inhouse request failed:', error.code || 'internal');
    return res.status(500).json({error: 'Unable to update inhouses. Please try again.'});
  }
};

// Revision checks are cheap and local. Both the web process and separate worker
// update the same revision in their transactions; one read fans out to viewers.
export function createInhouseStream(store, {intervalMs = 1000, maxClients = 250} = {}) {
  const clients = new Set();
  let timer = null, revision = -1, snapshot = null, pulses = 0;
  function write(res, data) {
    try {if (res.destroyed || res.writableEnded || !res.write(data)) res.destroy();}
    catch {res.destroy();}
  }
  function refresh() {
    const next = store.revision();
    if (next !== revision || !snapshot) {snapshot = store.snapshot(); revision = snapshot.revision; return true;}
    return false;
  }
  function stateFrame() {
    // Cached data may outlive its last viewer. Always timestamp a new delivery
    // now so reconnecting clients don't move deadline clocks into the past.
    return `id: ${revision}\nevent: state\ndata: ${JSON.stringify({...snapshot, serverNow: store.clock()})}\n\n`;
  }
  function poll() {
    try {
      if (refresh()) {const frame = stateFrame(); for (const res of clients) write(res, frame);}
      else if (++pulses % 15 === 0) for (const res of clients) write(res, ': heartbeat\n\n');
    } catch {for (const res of clients) res.destroy();}
  }
  return {
    subscribe(req, res) {
      if (clients.size >= maxClients) return res.status(503).json({error: 'Live inhouse updates are busy'});
      refresh();
      res.set({'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store, no-transform',
        'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
      res.socket?.setNoDelay(true); res.socket?.setTimeout(0); res.flushHeaders();
      clients.add(res);
      const remove = () => {clients.delete(res); if (!clients.size) {clearInterval(timer); timer = null;}};
      res.once('close', remove);
      write(res, 'retry: 2000\n\n'); write(res, stateFrame());
      if (!timer && clients.size) {timer = setInterval(poll, intervalMs); timer.unref?.();}
    },
    close() {clearInterval(timer); timer = null; for (const res of clients) res.end(); clients.clear();},
  };
}

export function createInhouseRoutes({store, api, requireAdmin, playerName = (id, req) => req.user?.displayName || `Player ${id}`,
  isOfficialTicket = () => false}) {
  const publicRoutes = express.Router(), adminRoutes = express.Router();
  const stream = createInhouseStream(store);
  const activity = createInhouseActivityStream(store);
  for (const router of [publicRoutes, adminRoutes]) router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) return res.status(415).json({error: 'Send application/json'});
    return next();
  });
  // Keep the entire player-facing API (including reads and SSE) private during
  // the admin preview. The application supplies its normal admin middleware.
  publicRoutes.use(requireAdmin);
  const signedIn = (req, res, next) => {
    const id = requestAccountId(req);
    if (!id || Number(id) > 4294967294) return res.status(401).json({error: 'Sign in with Steam to queue'});
    req.inhousePlayerId = Number(id);
    return next();
  };
  publicRoutes.get('/state', endpoint((req, res) => res.json(store.snapshot())));
  publicRoutes.get('/queue', endpoint((req, res) => res.json(store.queueSummary())));
  function activityRoom(req) {
    if (req.query.gameId === undefined) return {gameId: null, playerId: null};
    const playerId = requestAccountId(req);
    if (!playerId) fail('Sign in to view lobby chat', 401);
    return {gameId: positiveId(req.query.gameId, 'inhouse'), playerId: Number(playerId)};
  }
  publicRoutes.get('/activity', endpoint((req, res) => {
    const room = activityRoom(req);
    res.json({queue: store.activitySummary(), ...(room.gameId ? {chat: store.readChat(room.gameId, room.playerId)} : {})});
  }));
  publicRoutes.get('/activity/stream', endpoint((req, res) => activity.subscribe(req, res, activityRoom(req))));
  publicRoutes.get('/stream', endpoint((req, res) => stream.subscribe(req, res)));
  publicRoutes.get('/games', endpoint((req, res) => res.json({games: store.history(req.query.before === undefined ? undefined : positiveId(req.query.before, 'history cursor'))})));
  publicRoutes.get('/games/:id', endpoint((req, res) => res.json({game: store.game(positiveId(req.params.id))})));
  publicRoutes.get('/me', signedIn, endpoint((req, res) => res.json({player: store.profile(req.inhousePlayerId, playerName(req.inhousePlayerId, req))})));
  publicRoutes.put('/preferences', signedIn, endpoint((req, res) => res.json({player: store.preferences(req.inhousePlayerId, req.body || {}, playerName(req.inhousePlayerId, req))})));
  publicRoutes.post('/preferences/dismiss', signedIn, endpoint((req, res) => res.json({player: store.dismissPreferencesPrompt(req.inhousePlayerId, playerName(req.inhousePlayerId, req))})));
  publicRoutes.post('/queue', signedIn, endpoint((req, res) => res.json(store.join(req.inhousePlayerId, req.body || {}, playerName(req.inhousePlayerId, req)))));
  publicRoutes.delete('/queue', signedIn, endpoint((req, res) => res.json(store.leave(req.inhousePlayerId))));
  publicRoutes.post('/games/:id/ready', signedIn, endpoint((req, res) => res.json(store.ready(positiveId(req.params.id), req.inhousePlayerId))));
  publicRoutes.post('/games/:id/pick', signedIn, endpoint((req, res) => res.json(store.pick(positiveId(req.params.id), req.inhousePlayerId, req.body || {}))));
  publicRoutes.get('/games/:id/chat', signedIn, endpoint((req, res) => res.json(store.readChat(positiveId(req.params.id), req.inhousePlayerId))));
  publicRoutes.post('/games/:id/chat', signedIn, endpoint((req, res) => res.status(201).json(store.postChat(positiveId(req.params.id), req.inhousePlayerId, req.body || {}))));

  // The application mounts this router behind checkAdmin, before the general
  // league/betting mutation hook. Inhouse actions never request betting refresh.
  adminRoutes.get('/status', endpoint((req, res) => res.json({...store.snapshot(), audit: store.auditLog()})));
  adminRoutes.put('/settings', endpoint((req, res) => {
    if (isOfficialTicket(positiveId(req.body?.leagueId, 'inhouse ticket ID'))) fail('Use a dedicated inhouse ticket, separate from official league seasons');
    return res.json({settings: store.saveSettings(req.body || {})});
  }));
  adminRoutes.post('/games/:id/cancel', endpoint((req, res) => res.json(store.cancel(positiveId(req.params.id), req.body?.reason, requestAccountId(req)))));
  adminRoutes.post('/games/:id/link', endpoint(async (req, res) => {
    const id = positiveId(req.params.id), matchId = positiveId(req.body?.matchId, 'match');
    if (typeof req.body?.reason !== 'string' || !req.body.reason.trim()) fail('Enter a reason for correcting the match link');
    const match = await api.details(matchId);
    res.json(store.applyMatch(id, match, {correction: true, actorId: requestAccountId(req), reason: req.body.reason}));
  }));
  return {publicRoutes, adminRoutes, stream: {...stream, close() {stream.close(); activity.close();}}};
}
